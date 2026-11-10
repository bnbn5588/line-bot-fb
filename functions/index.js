/* eslint-disable linebreak-style */
/* eslint-disable object-curly-spacing */
/* eslint-disable spaced-comment */
/* eslint-disable quote-props */
/* eslint-disable comma-dangle */
/* eslint-disable indent */
/* eslint-disable operator-linebreak */
/* eslint-disable linebreak-style */
/* eslint-disable camelcase */
/* eslint-disable max-len */
/* eslint-disable require-jsdoc */
/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

/*
const {onRequest} = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
*/

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

const functions = require("firebase-functions/v1");
const axios = require("axios"); // Import axios for making HTTP requests
const crypto = require("crypto"); // Built-in — used to verify the LINE signature
// Import the moment-timezone library to work with time zones
const moment = require("moment-timezone");

// index.js or app.js
require("dotenv").config(); // Load .env file

const API_URL = process.env.API_URL;
const API_KEY = process.env.API_KEY;

const LINE_MESSAGING_API = "https://api.line.me/v2/bot/message";
const LINE_HEADER = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${process.env.LB_KEY}`,
};

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

// The LIFF web app (not secret). Card "แก้ไข" buttons open LIFF_URL?edit=<id>.
const LIFF_URL = process.env.LIFF_URL || "https://liff.line.me/2012532003-r80iatKj";

// Verify the X-Line-Signature header so only LINE can invoke this webhook.
// Fails closed: without LINE_CHANNEL_SECRET every request is rejected.
function isValidLineSignature(req) {
  if (!LINE_CHANNEL_SECRET) {
    console.error("LINE_CHANNEL_SECRET is not set — rejecting all webhook requests.");
    return false;
  }
  const signature = req.get("x-line-signature");
  if (!signature || !req.rawBody) {
    return false;
  }
  const expected = crypto
    .createHmac("sha256", LINE_CHANNEL_SECRET)
    .update(req.rawBody)
    .digest("base64");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Log an error without the request config: axios errors carry the URL (the
// Places URL contains G_API_KEY) and headers (LINE token, backend API key).
function safeError(error) {
  if (!error) return error;
  const status = error.response && error.response.status;
  const code = error.code;
  const apiMessage =
    error.response && error.response.data &&
    (error.response.data.message || error.response.data.error_message || error.response.data.status);
  return [error.name, code, status, apiMessage || error.message].filter(Boolean).join(" | ");
}

// Deployed to Singapore (asia-southeast1) — the closest GCP region to Thailand.
exports.LineBot = functions
  .region("asia-southeast1")
  .https.onRequest(async (req, res) => {
  // Reject anything that is not a signed request from LINE
  if (!isValidLineSignature(req)) {
    console.error("Invalid X-Line-Signature — rejecting request");
    res.status(401).send("Invalid signature");
    return;
  }

  // LINE sends an empty events array during webhook verification
  const events = (req.body && req.body.events) || [];

  // A single webhook can carry several events (e.g. messages sent in quick
  // succession). Handle them all, in order — previously only events[0] was
  // processed and the rest were silently dropped.
  for (const ev of events) {
    await handleEvent(ev);
  }

  // Always 200 so LINE does not redeliver the webhook. Redelivery would re-run
  // non-idempotent work (e.g. a /add insert that already succeeded) and
  // double-count transactions.
  res.status(200).send("OK");
});

async function handleEvent(ev) {
  if (!ev.replyToken) {
    return;
  }
  const isPostback = ev.type === "postback" && ev.postback;
  // Other non-message events (follow, unfollow, ...) are ignored
  if (!isPostback && (ev.type !== "message" || !ev.message)) {
    return;
  }

  // The handlers read event.events[0]; wrap this event in that shape.
  const single = { events: [ev] };

  let responseText;
  try {
    if (isPostback) {
      responseText = await handle_postback(ev);
    } else if (ev.message.type === "location") {
      responseText = await handle_location(single);
    } else if (ev.message.type === "text") {
      responseText = await handle_message(single);
    } else {
      return; // sticker, image, ... — not supported
    }
  } catch (error) {
    console.error("Error processing message:", safeError(error));
    return;
  }

  try {
    await reply(single, responseText);
  } catch (replyError) {
    console.error(
      "Error sending reply to LINE: ",
      safeError(replyError),
    );
  }
}

function getMRange(indate) {
  const splited = indate.split("-");
  const nyear = parseInt(splited[0]);
  const nmonth = parseInt(splited[1]);

  const firstDayOfMonth = new Date(nyear, nmonth - 1, 1);
  const lastDayOfMonth = new Date(nyear, nmonth, 0);
  const mrange = [firstDayOfMonth.getDate(), lastDayOfMonth.getDate()];

  return mrange;
}

// Turn a failed backend call into a message that is safe to show the user,
// instead of raw axios text like "Request failed with status code 404".
function apiErrorMessage(error, notFoundMessage) {
  const status = error && error.response && error.response.status;
  const apiMessage =
    error && error.response && error.response.data && error.response.data.message;
  console.error(
    "Backend API error:",
    status || "no response",
    apiMessage || (error && error.message),
  );
  if (status === 404) {
    return notFoundMessage || "No data found in this wallet yet.";
  }
  if (status === 400 && apiMessage) {
    return apiMessage;
  }
  return "Sorry, the service is temporarily unavailable. Please try again in a moment.";
}

// Parse an amount token such as "-120", "+1,500.50". Commas are only allowed
// as thousands separators. Returns the number, or null when invalid
// (previously "-1,000" was silently saved as -1 and "-120abc" as -120).
function parseAmount(token) {
  const pattern = /^[+-](\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/;
  if (!pattern.test(token)) {
    return null;
  }
  const value = Number(token.replace(/,/g, ""));
  if (!Number.isFinite(value) || value === 0 || Math.abs(value) >= 1e7) {
    return null;
  }
  return value;
}

const UNKNOWN_COMMAND_HINT = "Type 'help' to see all commands (ภาษาไทย: พิมพ์ 'ช่วยเหลือ').";

// Words that show the help text, and its language
const HELP_WORDS = { help: "en", "ช่วยเหลือ": "th", "วิธีใช้": "th", "คำสั่ง": "th" };

async function getHelpMessage(lang = "en") {
  return helpText(await fetchHelp(lang));
}

// Returns the user's current wallet, or null if they have none.
// Any other failure (backend down, timeout, 5xx) is thrown so the caller does
// not mistake an outage for "no wallet" and prompt the user to create another.
async function getWallet(userid) {
  try {
    const response = await axios.get(`${API_URL}/wallet`, {
      params: { userid },
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
      },
    });

    if (response.data.status === "success" && response.data.data.length > 0) {
      const wallet = response.data.data[0];

      return {
        wallet_id: String(wallet[0]),
        wallet_name: String(wallet[1]),
        timezone: String(wallet[2]),
      };
    }
    return null;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return null;
    }
    throw error;
  }
}

async function handle_message(event) {
  let res_message = "-";

  try {
    const msg_from_user = event.events[0].message.text.trim();
    const userid = event.events[0].source.userId;
    let extracted = msg_from_user.split(" ");
    const inst_from_user = extracted[0].toLowerCase();

    // Log the command, not the user's text (amounts and notes are personal data)
    const cmd = /^[+-]/.test(inst_from_user) ? "add" : inst_from_user.slice(0, 20);
    console.log("command:", cmd, "user:", "…" + String(userid).slice(-6));

    // Create Wallet
    if (inst_from_user === "create") {
      if (!extracted[1] || !extracted[2] || extracted.length > 3) {
        return (
          "Usage: create [wallet_name] [timezone]\n" +
          "For example, 'create main Asia/Bangkok'"
        );
      }
      try {
        const response = await axios.post(
          `${API_URL}/createWallet`,
          {
            uname: userid,
            wallet_name: extracted[1],
            timezone: extracted[2],
          },
          {
            headers: {
              "Content-Type": "application/json",
              "x-api-key": API_KEY,
            },
          },
        );
        res_message =
          `[${response.data.data.wallet_id}] ${response.data.data.wallet_name} created successfully!\n` +
          `[${response.data.data.wallet_id}] ${response.data.data.wallet_name} is your current wallet (${response.data.data.timezone})`;
        return res_message;
      } catch (error) {
        return apiErrorMessage(error);
      }
    }

    // Help does not need a wallet — new users must be able to see it.
    if (Object.hasOwn(HELP_WORDS, inst_from_user)) {
      // "help text" / "ช่วยเหลือ ข้อความ" still gives the plain-text version
      try {
        if (extracted.length === 1) {
          return await helpCarousel(HELP_WORDS[inst_from_user]);
        }
        return await getHelpMessage(HELP_WORDS[inst_from_user]);
      } catch (error) {
        return apiErrorMessage(error);
      }
    }

    let wallet;
    try {
      wallet = await getWallet(userid);
    } catch (error) {
      return apiErrorMessage(error);
    }

    if (!wallet) {
      res_message =
        "No wallet found, please create wallet\n\n" +
        "create [wallet_name] [timezone]\n" +
        "For example, 'create default_wallet Asia/Taipei'";
      return res_message;
    }
    const tz = wallet.timezone; // Use wallet's timezone
    const localDatetime = moment.tz(new Date(), tz);

    let justdate = localDatetime.format("YYYY-MM-DD");
    let justhour = localDatetime.format("HH:mm:ss");
    const this_year_n_month = localDatetime.format("YYYY-MM");
    let year_n_month = this_year_n_month;

    if (inst_from_user === "sumall") {
      try {
        const response = await axios.get(`${API_URL}/sumall`, {
          params: {
            uname: userid,
            wallet_id: wallet.wallet_id,
          },
          headers: {
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
          },
        });

        const record_sum = response.data.data.total_balance;
        const record_fristdate = response.data.data.first_date;
        res_message = `[${wallet.wallet_id}] Balance (income + expenses): ${record_sum} since ${record_fristdate}`;
      } catch (error) {
        res_message = apiErrorMessage(error);
      }
    } else if (inst_from_user === "sumbymonth") {
      try {
        const response = await axios.get(`${API_URL}/sumbymonth`, {
          params: {
            uname: userid,
            wallet_id: wallet.wallet_id,
          },
          headers: {
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
          },
        });

        res_message = `[${wallet.wallet_id}] Monthly Balance (income + expenses)\n`;
        for (const row of response.data.data.monthlyExpenses) {
          const newrec = `${row.month}: ${row.totalExpense}`;
          res_message += newrec + "\n";
        }
      } catch (error) {
        res_message = apiErrorMessage(error);
      }
    } else if (inst_from_user === "sumbynote") {
      try {
        const params = {
          uname: userid,
          wallet_id: wallet.wallet_id,
        };

        if (extracted[1]) {
          if (extracted[1] == "-m" && !extracted[2]) {
            params.month = year_n_month;
          } else if (extracted[1] == "-m" && extracted[2]) {
            params.month = extracted[2];
          } else {
            res_message = "Invalid argument found";
            return res_message;
          }
        }

        const response = await axios.get(`${API_URL}/sumbynote`, {
          params: params,
          headers: {
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
          },
        });

        if (!response.data.data) {
          return "No data found";
        }
        res_message = `[${wallet.wallet_id}] Total by Note\n`;
        for (const row of response.data.data.groupedExpenses) {
          const newrec = `${row.note} (${row.count}): ${row.totalExpense}`;
          res_message += newrec + "\n";
        }
      } catch (error) {
        res_message = apiErrorMessage(
          error,
          extracted[1] === "-m"
            ? `No data found in this wallet for ${extracted[2] || year_n_month}.`
            : undefined,
        );
      }
    } else if (inst_from_user === "avgbymonth") {
      try {
        const response = await axios.get(`${API_URL}/sumbymonth`, {
          params: {
            uname: userid,
            wallet_id: wallet.wallet_id,
          },
          headers: {
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
          },
        });

        res_message = `[${wallet.wallet_id}] Average Daily Balance (income + expenses)\n`;
        for (const row of response.data.data.monthlyExpenses) {
          const month_range = getMRange(row.month);
          const num_days =
            row.month === this_year_n_month
              ? localDatetime.date()
              : month_range[1];
          const newrec = `${row.month}: ${(
            row.totalExpense / num_days
          ).toFixed(2)}`;
          res_message += newrec + "\n";
        }
      } catch (error) {
        res_message = apiErrorMessage(error);
      }
    } else if (inst_from_user === "wallet" && extracted.length == 1) {
      try {
        const response = await axios.get(`${API_URL}/wallets`, {
          params: { userid },
          headers: {
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
          },
        });

        res_message = "List of your Wallet \n";
        for (const row of response.data.data) {
          let newrec;
          if (row.wallet_id == wallet.wallet_id) {
            newrec = `*[${row.wallet_id}]: ${row.wallet_name}(tz: ${row.timezone})`;
          } else {
            newrec = `[${row.wallet_id}]: ${row.wallet_name}(tz: ${row.timezone})`;
          }
          res_message += newrec + "\n";
        }
      } catch (error) {
        res_message = apiErrorMessage(error);
      }
    } else if (inst_from_user === "wallet" && extracted.length == 2) {
      try {
        const response = await axios.post(
          `${API_URL}/changeWallet`,
          {
            uname: userid,
            wallet_id: extracted[1],
          },
          {
            headers: {
              "Content-Type": "application/json",
              "x-api-key": API_KEY,
            },
          },
        );
        if (response.data.message) {
          res_message = response.data.message;
        } else {
          res_message = `[${response.data.data.new_wallet_id}] ${response.data.data.new_wallet_name} is your current wallet (${response.data.data.new_wallet_tz})`;
        }
      } catch (error) {
        res_message = apiErrorMessage(error);
      }
    } else if (
      inst_from_user.startsWith("+") ||
      inst_from_user.startsWith("-")
    ) {
      const amount = parseAmount(inst_from_user);
      if (amount === null) {
        return (
          `Invalid amount '${extracted[0]}'.\n` +
          "Use '-' for expense or '+' for income, e.g. '-120 lunch' or '+1,500.50 salary'"
        );
      }

      const get_date = msg_from_user.split("-d ");
      const get_hour = msg_from_user.split("-h ");

      if (get_date.length >= 2) {
        const extracted_date = get_date[1].split("-h")[0].trim();
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(extracted_date) ||
          !moment(extracted_date, "YYYY-MM-DD", true).isValid()
        ) {
          return `Invalid date '${extracted_date}'. Use YYYY-MM-DD, e.g. -d 2026-03-15`;
        }
        justdate = extracted_date;
        year_n_month = extracted_date.slice(0, 7);
      }
      if (get_hour.length >= 2) {
        const extracted_hour = get_hour[1].split("-d")[0].trim();
        // Accept HH:mm as well as HH:mm:ss (the API needs seconds)
        const hourMatch = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/.exec(
          extracted_hour,
        );
        if (!hourMatch) {
          return `Invalid time '${extracted_hour}'. Use HH:mm, e.g. -h 14:30`;
        }
        justhour = `${hourMatch[1]}:${hourMatch[2]}:${hourMatch[4] || "00"}`;
      }

      const targetdate = `${justdate} ${justhour}`;

      // The note is everything after the amount. Strip the -d / -h flag
      // segments first so they don't leak into the description.
      const note_source = msg_from_user.split("-d ")[0].split("-h ")[0].trim();
      extracted = note_source.split(" ");
      const note = extracted.slice(1).join(" ").trim();

      if (!note) {
        return (
          "A note is required. Add a short description after the amount.\n" +
          "For example, '-120 lunch' or '+500 salary'"
        );
      }

      try {
        const response = await axios.post(
          `${API_URL}/add`,
          {
            uname: userid,
            wallet_id: wallet.wallet_id,
            exvalue: String(amount),
            targetdate: targetdate,
            detail: note,
          },
          {
            headers: {
              "Content-Type": "application/json",
              "x-api-key": API_KEY,
            },
          },
        );

        let num_days = 0;
        if (year_n_month === this_year_n_month) {
          num_days = localDatetime.date();
        } else {
          const month_range = getMRange(year_n_month);
          num_days = month_range[1];
        }

        const d = response.data.data;
        if (d.id && d.category) {
          // New backend: reply with a card that has category / edit / delete buttons
          res_message = {
            messages: [recordCard(d, { wallet, time: justhour, avg: d.sum_month / num_days })],
          };
        } else {
          const res_message1 = `[${d.wallet_id}] Balance on ${d.targetdate} = ${d.sum_day}`;
          let res_message2 = `\n\n**This Month (income + expenses)**\n`;
          res_message2 += "Total = " + d.sum_month + "\n";
          res_message2 += "Avg./day = " + (d.sum_month / num_days).toFixed(2);
          res_message = res_message1 + res_message2;
        }
      } catch (error) {
        res_message = apiErrorMessage(error);
      }
    } else {
      res_message = `Unknown command '${extracted[0]}'. ${UNKNOWN_COMMAND_HINT}`;
    }
  } catch (err) {
    console.error("handle_message failed:", safeError(err));
    // Must stay a string — reply() sends this straight to LINE as message text.
    res_message = "Sorry, something went wrong. Please try again.";
  }

  return res_message;
  //reply(event, res_message);
}

async function handle_location(event) {
  const latitude = event.events[0].message.latitude;
  const longitude = event.events[0].message.longitude;
  // Make a nearby search request to Google Places API

  const apiKey = process.env.G_API_KEY;
  if (!apiKey) {
    console.error("G_API_KEY is not set");
    return "Location feature is not configured. Please contact the admin.";
  }
  const radius = 1000; // Radius in meters (adjust as needed)
  const type = "restaurant"; // Type of places you want to search for (e.g., restaurant, cafe, etc.)
  let nextPageToken = null; // Initialize nextPageToken to null
  const places = []; // Open/confirmed places
  const fallbackPlaces = []; // Operational places with no hours data

  // Loop until either we have retrieved 50 places or there are no more pages
  while (places.length < 50) {
    // Construct the API URL with the appropriate parameters
    let apiUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${latitude},${longitude}&radius=${radius}&type=${type}&key=${apiKey}`;

    // Append nextPageToken if it exists
    if (nextPageToken) {
      apiUrl += `&pagetoken=${nextPageToken}`;
    }

    try {
      const response = await axios.get(apiUrl);

      // Extract places from the response
      const results = response.data.results;

      for (const place of results) {
        const placeId = place.place_id;
        const businessStatus = place.business_status;
        const rating = place.rating;
        const opening_hours = place.opening_hours;

        const openNow = opening_hours && opening_hours.open_now;

        if (businessStatus === "OPERATIONAL") {
          if (openNow === true) {
            places.push({ placeId, rating });
          } else if (openNow === undefined) {
            // No hours data — keep as fallback in case all others are closed
            fallbackPlaces.push({ placeId, rating });
          }
          // openNow === false means confirmed closed — skip entirely
        }
      }

      // Check if there is a next page token
      nextPageToken = response.data.next_page_token;

      if (!nextPageToken) {
        break;
      }
      // Google requires a short delay before the next_page_token becomes valid
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      console.error("Error fetching nearby places:", safeError(error));
      return "Error fetching nearby places. Please try again later.";
    }
  }

  let usingFallback = false;
  if (places.length === 0 && fallbackPlaces.length === 0) {
    return "No restaurants found nearby. Try sharing a different location.";
  }
  if (places.length === 0) {
    places.push(...fallbackPlaces);
    usingFallback = true;
  }

  // Weight by rating. Places with no rating (common for small/new restaurants)
  // get a neutral weight — an undefined rating used to make totalWeight NaN,
  // so nothing was ever selected and the user got an error.
  const UNRATED_WEIGHT = 2.5;
  const weightOf = (place) =>
    typeof place.rating === "number" && place.rating > 0
      ? place.rating
      : UNRATED_WEIGHT;
  const totalWeight = places.reduce((acc, place) => acc + weightOf(place), 0);

  // Generate a random number between 0 and the total weight
  const randomWeight = Math.random() * totalWeight;

  // Iterate over places and find the randomly selected place
  let cumulativeWeight = 0;
  let selectedPlace = places[places.length - 1]; // guard against float rounding
  for (const place of places) {
    cumulativeWeight += weightOf(place);
    if (cumulativeWeight >= randomWeight) {
      selectedPlace = place;
      break;
    }
  }

  // Print the selected place
  console.log("Randomly selected place:", selectedPlace && selectedPlace.name);
  /*
    // Process the places or build a response text
    let responseText = `Nearby places for user`;

    for (let i = 0; i < places.length; i++) {
      const place = places[i];
      responseText += `\n${i + 1}. Place ID: ${place.placeId}, Rating: ${place.rating}`;
    }
    */
  try {
    // Fetch place details using the selected place's place ID
    const placeDetails = await fetchPlaceDetails(selectedPlace.placeId, apiKey);

    // Construct Google Maps link using place details
    const googleMapsLink = placeDetails.googleMapsUri;
    const name = placeDetails.displayName.text;
    const note = usingFallback
      ? "\n(Hours unavailable — may not be open right now)"
      : "";
    const responseText = `Randomly selected place: ${name}\nGoogle Maps link: ${googleMapsLink}${note}`;

    // Return the response text containing the selected place and the Google Maps link
    return responseText;
  } catch (error) {
    // Handle error fetching place details
    return "Error fetching place details. Please try again later.";
  }
}

// Function to fetch place details using place ID
async function fetchPlaceDetails(placeId, apiKey) {
  try {
    const response = await axios.get(
      `https://places.googleapis.com/v1/places/${placeId}`,
      {
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "id,displayName,googleMapsUri",
        },
      },
    );
    return response.data;
  } catch (error) {
    console.error("Error fetching place details:", safeError(error));
    throw error;
  }
}

// LINE rejects the whole reply if any text message is over 5000 characters,
// and a reply may hold at most 5 messages. Split long text on line breaks.
const LINE_MAX_TEXT = 5000;
const LINE_MAX_MESSAGES = 5;

function splitForLine(text) {
  const chunks = [];
  let current = "";
  for (const line of String(text).split("\n")) {
    // A single line longer than the limit is hard-cut
    for (let i = 0; i < Math.max(line.length, 1); i += LINE_MAX_TEXT) {
      const piece = line.slice(i, i + LINE_MAX_TEXT);
      const candidate = current === "" ? piece : current + "\n" + piece;
      if (candidate.length > LINE_MAX_TEXT) {
        chunks.push(current);
        current = piece;
      } else {
        current = candidate;
      }
    }
  }
  chunks.push(current);

  if (chunks.length > LINE_MAX_MESSAGES) {
    const kept = chunks.slice(0, LINE_MAX_MESSAGES);
    const note = "\n… (truncated — too long for LINE)";
    kept[LINE_MAX_MESSAGES - 1] =
      kept[LINE_MAX_MESSAGES - 1].slice(0, LINE_MAX_TEXT - note.length) + note;
    return kept;
  }
  return chunks.map((c) => (c === "" ? "-" : c));
}

// response: a string (sent as text, split if long) or { messages: [...],
// quickReply? }. The quick-reply buttons go on the last message.
const reply = (bodyResponse, response) => {
  const messages =
    response && typeof response === "object" && Array.isArray(response.messages)
      ? response.messages.slice(0, LINE_MAX_MESSAGES)
      : splitForLine(response).map((text) => ({ type: "text", text }));
  const qr = (response && response.quickReply) || defaultQuickReply();
  if (qr && messages.length) {
    messages[messages.length - 1] = { ...messages[messages.length - 1], quickReply: qr };
  }
  return axios.post(
    `${LINE_MESSAGING_API}/reply`,
    {
      replyToken: bodyResponse.events[0].replyToken,
      messages,
    },
    { headers: LINE_HEADER },
  );
};

// ---------- chat UI: quick reply, record card, postback buttons

// Shortcut buttons above the keyboard (shown under the bot's latest reply).
function defaultQuickReply() {
  const msg = (label, text) => ({ type: "action", action: { type: "message", label, text } });
  return {
    items: [
      msg("📊 ยอดรวม", "sumall"),
      msg("📅 รายเดือน", "sumbymonth"),
      msg("🏷️ โน้ตเดือนนี้", "sumbynote -m"),
      msg("👛 กระเป๋า", "wallet"),
      { type: "action", action: { type: "uri", label: "🌐 เปิดเว็บ", uri: LIFF_URL } },
      { type: "action", action: { type: "location", label: "📍 สุ่มร้านอาหาร" } },
      msg("❓ วิธีใช้", "ช่วยเหลือ"),
    ],
  };
}

const fmtMoney = (v, signed = true) => {
  const n = Number(v) || 0;
  const s = Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n < 0 ? "−" + s : (signed && n > 0 ? "+" : "") + s;
};
// LINE limits: label 20 chars, postback data 300 chars, text 2000 in a flex text
const clip = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + "…" : String(t));

function kv(label, value) {
  return {
    type: "box", layout: "horizontal", contents: [
      { type: "text", text: label, size: "sm", color: "#77766f", flex: 0 },
      { type: "text", text: value, size: "sm", color: "#0b0b0b", align: "end" },
    ],
  };
}

// Card shown after a record is saved.
function recordCard(d, { wallet, time, avg }) {
  const cat = d.category;
  const isIncome = Number(d.exvalue) > 0;
  const kind = isIncome ? "i" : "e";
  const walletName = wallet && wallet.wallet_name ? `[${wallet.wallet_id}] ${wallet.wallet_name}` : `[${d.wallet_id}]`;
  return {
    type: "flex",
    altText: clip(`บันทึก ${fmtMoney(d.exvalue)} ${d.detail} (${cat.icon} ${cat.label})`, 400),
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "16px",
        contents: [
          { type: "text", text: `${cat.icon} ${cat.label}`, size: "xs", color: "#52514e" },
          { type: "text", text: clip(d.detail, 200), weight: "bold", size: "md", wrap: true, color: "#0b0b0b" },
          { type: "text", text: fmtMoney(d.exvalue), weight: "bold", size: "xxl", color: isIncome ? "#256abf" : "#d03b3b" },
          { type: "separator", margin: "md" },
          { type: "box", layout: "vertical", spacing: "xs", margin: "md", contents: [
            kv("วันที่", `${d.targetdate} ${String(time || "").slice(0, 5)}`.trim()),
            kv("ยอดวันนี้", fmtMoney(d.sum_day)),
            kv("ยอดเดือนนี้", fmtMoney(d.sum_month)),
            kv("เฉลี่ย/วัน", Number.isFinite(avg) ? fmtMoney(avg.toFixed(2)) : "-"),
            kv("กระเป๋า", clip(walletName, 40)),
          ] },
        ],
      },
      // Two rows: three buttons side by side are too narrow for Thai labels
      footer: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "8px",
        contents: [
          { type: "button", style: "secondary", height: "sm",
            action: { type: "postback", label: "🏷️ เปลี่ยนหมวด", data: `a=cat&id=${d.id}&k=${kind}` } },
          { type: "box", layout: "horizontal", spacing: "sm", contents: [
            { type: "button", style: "secondary", height: "sm",
              action: { type: "uri", label: "✏️ แก้ไข", uri: `${LIFF_URL}?edit=${d.id}` } },
            { type: "button", style: "secondary", height: "sm", color: "#f6d5d5",
              action: { type: "postback", label: "🗑️ ลบ", data: `a=del&id=${d.id}`, displayText: "ลบรายการนี้" } },
          ] },
        ],
      },
    },
  };
}

// ---------- help: content comes from the backend (/api/help?lang=),
// this file only draws it. Edit the text in linebot-backend/components/help.js.
const C = { ink: "#0b0b0b", sub: "#52514e", muted: "#77766f", code: "#256abf" };

async function fetchHelp(lang) {
  const r = await axios.get(`${API_URL}/help`, {
    params: { lang },
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
  });
  return r.data.data;
}

function helpRow([cmd, desc, example], eg) {
  const box = [
    { type: "text", text: String(cmd), size: "sm", weight: "bold", color: C.code, wrap: true },
    { type: "text", text: String(desc), size: "sm", color: C.ink, wrap: true },
  ];
  if (example) box.push({ type: "text", text: `${eg}  ${example}`, size: "xs", color: C.muted, wrap: true });
  return { type: "box", layout: "vertical", spacing: "xs", contents: box };
}

function helpButtons(buttons) {
  let firstLink = true;
  return (buttons || []).slice(0, 6).map((b) => {
    if (b.uri) {
      const primary = firstLink;
      firstLink = false;
      return { type: "button", style: primary ? "primary" : "secondary", height: "sm", ...(primary ? { color: "#256abf" } : {}),
        action: { type: "uri", label: clip(b.label, 20), uri: b.uri } };
    }
    return { type: "button", style: "secondary", height: "sm",
      action: { type: "message", label: clip(b.label, 20), text: String(b.text) } };
  });
}

function helpBubble(card, eg) {
  const body = [
    ...(card.rows || []).map((r) => helpRow(r, eg)),
    ...(card.lines || []).map((t) => ({ type: "text", text: String(t), size: "sm", color: C.sub, wrap: true })),
  ];
  if (card.note) body.push({ type: "text", text: String(card.note), size: "xs", color: C.muted, wrap: true });
  if (!body.length) body.push({ type: "text", text: " ", size: "xs" });
  const footer = helpButtons(card.buttons);
  return {
    type: "bubble", size: "kilo",
    header: { type: "box", layout: "vertical", paddingBottom: "4px",
      contents: [{ type: "text", text: String(card.title), weight: "bold", size: "md", color: C.ink, wrap: true }] },
    body: { type: "box", layout: "vertical", spacing: "md", paddingTop: "4px", contents: body },
    ...(footer.length ? { footer: { type: "box", layout: "vertical", spacing: "sm", paddingTop: "0px", contents: footer } } : {}),
  };
}

async function helpCarousel(lang) {
  const h = await fetchHelp(lang);
  if (!Array.isArray(h.cards) || !h.cards.length) {
    return helpText(h); // backend without cards: plain text
  }
  return {
    messages: [{
      type: "flex",
      altText: clip(h.alt || h.title || "Help", 400),
      contents: { type: "carousel", contents: h.cards.slice(0, 12).map((c) => helpBubble(c, h.eg || "e.g.")) },
    }],
  };
}

// Plain-text version built from the same cards
function helpText(h) {
  if (!Array.isArray(h.cards)) {
    return (h.commands || []).map((row, i) => `${i + 1}). ${row.name}\n- ${row.description}\n>> ${row.command}`).join("\n");
  }
  const other = h.lang === "th" ? "English: type 'help'" : "ภาษาไทย: พิมพ์ 'ช่วยเหลือ'";
  const out = [`📖 ${h.title} (${other})`];
  for (const c of h.cards) {
    out.push("", c.title);
    for (const [cmd, desc, ex] of c.rows || []) out.push(`• ${cmd} — ${desc}${ex ? ` (${h.eg} ${ex})` : ""}`);
    for (const t of c.lines || []) out.push(`• ${t}`);
    for (const b of c.buttons || []) out.push(b.uri ? `• ${b.label}: ${b.uri}` : `• ${b.label}: ${b.text}`);
    if (c.note) out.push(`  ${c.note}`);
  }
  return out.join("\n");
}

let categoryCache = null;
async function getCategories() {
  if (categoryCache) return categoryCache;
  const r = await axios.get(`${API_URL}/categories`, { headers: { "x-api-key": API_KEY } });
  categoryCache = r.data.data;
  return categoryCache;
}

// Buttons on the card. Who pressed it comes from the signed event, so a
// forwarded or old card can never touch someone else's record (the backend
// also checks that the record belongs to this user).
async function handle_postback(ev) {
  const userid = ev.source && ev.source.userId;
  const p = new URLSearchParams(String(ev.postback.data || ""));
  const action = p.get("a");
  const id = p.get("id");
  if (!userid || !/^\d{1,15}$/.test(id || "")) {
    return "This button is no longer valid.";
  }
  const headers = { "Content-Type": "application/json", "x-api-key": API_KEY };
  console.log("postback:", action, "user:", "…" + String(userid).slice(-6));

  try {
    if (action === "cat") {
      const kind = p.get("k") === "i" ? "income" : "expense";
      const cats = (await getCategories()).filter((c) => c.kind === kind).slice(0, 13);
      return {
        messages: [{ type: "text", text: "เลือกหมวดใหม่สำหรับรายการนี้ 👇" }],
        quickReply: {
          items: cats.map((c) => ({
            type: "action",
            action: {
              type: "postback",
              label: clip(`${c.icon} ${c.label}`, 20),
              data: `a=setcat&id=${id}&c=${c.key}`,
              displayText: `หมวด: ${c.icon} ${c.label}`,
            },
          })),
        },
      };
    }

    if (action === "setcat") {
      const r = await axios.post(`${API_URL}/setCategory`, { uname: userid, id, category: p.get("c") }, { headers });
      const d = r.data.data;
      return `✅ เปลี่ยนหมวดเป็น ${d.category.icon} ${d.category.label} แล้ว\n"${clip(d.note, 60)}" ครั้งต่อไปจะใช้หมวดนี้ให้อัตโนมัติ`;
    }

    if (action === "del") {
      return {
        messages: [{
          type: "template",
          altText: "ยืนยันการลบรายการ",
          template: {
            type: "confirm",
            text: "ลบรายการนี้ใช่ไหม? ลบแล้วกู้คืนไม่ได้",
            actions: [
              { type: "postback", label: "ลบ", data: `a=delok&id=${id}`, displayText: "ยืนยันลบ" },
              { type: "postback", label: "ยกเลิก", data: `a=cancel&id=${id}`, displayText: "ยกเลิก" },
            ],
          },
        }],
      };
    }

    if (action === "delok") {
      const r = await axios.post(`${API_URL}/deleteRecord`, { uname: userid, id }, { headers });
      const d = r.data.data;
      return `🗑️ ลบแล้ว: ${fmtMoney(d.exvalue)} ${clip(d.note, 60)} (${d.datetime})`;
    }

    if (action === "cancel") {
      return "ไม่ได้ลบ 👍";
    }
  } catch (error) {
    const status = error && error.response && error.response.status;
    if (status === 404) {
      return "ไม่พบรายการนี้แล้ว (อาจถูกลบไปแล้ว)";
    }
    return apiErrorMessage(error);
  }
  return "This button is no longer valid.";
}
