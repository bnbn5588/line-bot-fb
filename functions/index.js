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
const request = require("request-promise");
const axios = require("axios"); // Import axios for making HTTP requests
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

exports.LineBot = functions.https.onRequest(async (req, res) => {
  const userId = req.body.events[0].source.userId;

  try {
    if (req.body.events[0].message.type === "location") {
      const responseText = await handle_location(req.body);
      await reply(req.body, responseText);
    } else if (req.body.events[0].message.type === "text") {
      const responseText = await handle_message(req.body, userId);
      await reply(req.body, responseText);
    } else {
      res.status(200).send("Event type not supported");
      return;
    }

    // Send a success response to Line after processing
    res.status(200).send("Message processed successfully");
  } catch (error) {
    console.error("Error processing message: ", error);
    res.status(500).send("Error processing message");
  }
});

function getMRange(indate) {
  const splited = indate.split("-");
  const nyear = parseInt(splited[0]);
  const nmonth = parseInt(splited[1]);

  const firstDayOfMonth = new Date(nyear, nmonth - 1, 1);
  const lastDayOfMonth = new Date(nyear, nmonth, 0);
  const mrange = [firstDayOfMonth.getDate(), lastDayOfMonth.getDate()];

  return mrange;
}

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
  } catch (error) {
    return -1;
  }
}

async function handle_message(event) {
  let res_message = "-";

  try {
    const msg_from_user = event.events[0].message.text.trim();
    const userid = event.events[0].source.userId;
    let extracted = msg_from_user.split(" ");
    const inst_from_user = extracted[0].toLowerCase();

    console.log(inst_from_user);

    // Create Wallet
    if (inst_from_user === "create") {
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
          }
        );
        res_message =
          `[${response.data.data.wallet_id}] ${response.data.data.wallet_name} created successfully!\n` +
          `[${response.data.data.wallet_id}] ${response.data.data.wallet_name} is your current wallet (${response.data.data.timezone})`;
        return res_message;
      } catch (error) {
        res_message = error.message;
      }
    }

    const wallet = await getWallet(userid);

    if (wallet == -1) {
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

    if (inst_from_user === "help") {
      try {
        const response = await axios.get(`${API_URL}/help`, {
          headers: {
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
          },
        });

        let count = 1;
        res_message = "";
        for (const row of response.data.data.commands) {
          const newrec = `${count}). ${row.name}\n- ${row.description}\n>> ${row.command}`;
          res_message += newrec + "\n";
          count = count + 1;
        }
      } catch (error) {
        res_message = error.message;
      }
    } else if (inst_from_user === "sumall") {
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
        res_message = `[${wallet.wallet_id}] Total Expense: ${record_sum} starting from ${record_fristdate}`;
      } catch (error) {
        res_message = error.message;
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

        res_message = `[${wallet.wallet_id}] Total Monthly Expense \n`;
        for (const row of response.data.data.monthlyExpenses) {
          const newrec = `${row.month}: Expense = ${row.totalExpense}`;
          res_message += newrec + "\n";
        }
      } catch (error) {
        res_message = error.message;
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
        res_message = `[${wallet.wallet_id}] Grouped Expenses \n`;
        for (const row of response.data.data.groupedExpenses) {
          const newrec = `${row.note} (${row.count}): ${row.totalExpense}`;
          res_message += newrec + "\n";
        }
      } catch (error) {
        res_message = error.message;
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

        res_message = `[${wallet.wallet_id}] Average Daily Expense \n`;
        for (const row of response.data.data.monthlyExpenses) {
          const month_range = getMRange(row.month);
          const num_days =
            row.month === this_year_n_month
              ? parseInt(localDatetime.toISOString().slice(8, 10))
              : month_range[1];
          const newrec = `${row.month}: Avg. Expense = ${(
            row.totalExpense / num_days
          ).toFixed(2)}`;
          res_message += newrec + "\n";
        }
      } catch (error) {
        res_message = error.message;
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
        res_message = error.message;
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
          }
        );
        if (response.data.message) {
          res_message = response.data.message;
        } else {
          res_message = `[${response.data.data.new_wallet_id}] ${response.data.data.new_wallet_name} is your current wallet (${response.data.data.new_wallet_tz})`;
        }
      } catch (error) {
        res_message = error.message;
      }
    } else if (
      inst_from_user.startsWith("+") ||
      inst_from_user.startsWith("-")
    ) {
      const get_date = msg_from_user.split("-d ");
      const get_hour = msg_from_user.split("-h ");
      extracted = get_date[0].split(" ");

      if (get_date.length >= 2) {
        const extracted_date = get_date[1].split("-h")[0].trim();
        justdate = extracted_date;
        year_n_month = extracted_date.slice(0, 7);
      }
      if (get_hour.length >= 2) {
        const extracted_hour = get_hour[1].split("-d")[0].trim();
        justhour = extracted_hour;
      }

      const targetdate = `${justdate} ${justhour}`;
      let note = "";
      if (extracted.length > 1) {
        note = extracted.slice(1).join(" ");
      }

      try {
        const response = await axios.post(
          `${API_URL}/add`,
          {
            uname: userid,
            wallet_id: wallet.wallet_id,
            exvalue: inst_from_user,
            targetdate: targetdate,
            detail: note,
          },
          {
            headers: {
              "Content-Type": "application/json",
              "x-api-key": API_KEY,
            },
          }
        );

        let num_days = 0;
        if (year_n_month === this_year_n_month) {
          num_days = parseInt(localDatetime.toISOString().slice(8, 10));
        } else {
          const month_range = getMRange(year_n_month);
          num_days = month_range[1];
        }

        const res_message1 = `[${response.data.data.wallet_id}] Balance on ${response.data.data.targetdate} = ${response.data.data.sum_day}`;
        let res_message2 = `\n\n**Expense Report This Month**\n`;
        res_message2 += "Total = " + response.data.data.sum_month + "\n";
        res_message2 +=
          "Avg.  = " + (response.data.data.sum_month / num_days).toFixed(2);

        res_message = res_message1 + res_message2;
      } catch (error) {
        console.error(error);
        res_message = error.message;
      }
    }
  } catch (err) {
    console.error(err);
    res_message = err;
  }

  return res_message;
  //reply(event, res_message);
}

async function handle_location(event) {
  const latitude = event.events[0].message.latitude;
  const longitude = event.events[0].message.longitude;
  // Make a nearby search request to Google Places API

  const apiKey = process.env.G_API_KEY;
  const radius = 1000; // Radius in meters (adjust as needed)
  const type = "restaurant"; // Type of places you want to search for (e.g., restaurant, cafe, etc.)
  let nextPageToken = null; // Initialize nextPageToken to null
  const places = []; // Array to store all places

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

        // Check if opening_hours is defined before accessing open_now
        const openNow = opening_hours && opening_hours.open_now;

        if (
          typeof openNow !== "undefined" &&
          businessStatus === "OPERATIONAL"
        ) {
          // Create an object for each place containing place ID and rating
          places.push({ placeId, rating });
        } else {
          console.log(`Place with ID ${placeId} is currently closed.`);
        }
      }

      // Check if there is a next page token
      nextPageToken = response.data.next_page_token;

      if (!nextPageToken) {
        break;
      }
    } catch (error) {
      console.error("Error fetching nearby places:", error);
      return "Error fetching nearby places. Please try again later.";
    }
  }

  // Calculate total weight based on ratings
  const totalWeight = places.reduce((acc, place) => acc + place.rating, 0);

  // Generate a random number between 0 and the total weight
  const randomWeight = Math.random() * totalWeight;

  // Iterate over places and find the randomly selected place
  let cumulativeWeight = 0;
  let selectedPlace;
  for (const place of places) {
    cumulativeWeight += place.rating;
    if (cumulativeWeight >= randomWeight) {
      selectedPlace = place;
      break;
    }
  }

  // Print the selected place
  console.log("Randomly selected place:", selectedPlace);
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
    // Prepare the response text with the Google Maps link and place name
    const responseText = `Randomly selected place: ${name}\nGoogle Maps link: ${googleMapsLink}`;

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
      `https://places.googleapis.com/v1/places/${placeId}?fields=id,displayName,googleMapsUri&key=${apiKey}`
    );
    //console.log(response)
    return response.data; // Return place details
  } catch (error) {
    console.error("Error fetching place details:", error);
    throw error; // Throw error for handling at the caller level
  }
}

const reply = (bodyResponse, responseText) => {
  //console.log("responseText:", responseText);
  return request({
    method: "POST",
    uri: `${LINE_MESSAGING_API}/reply`,
    headers: LINE_HEADER,
    body: JSON.stringify({
      replyToken: bodyResponse.events[0].replyToken,
      messages: [
        {
          type: "text",
          text: responseText, // Use the response text received as an argument
        },
      ],
    }),
  });
};
