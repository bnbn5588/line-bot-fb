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

// Define the Autonomous Database variables
const username = process.env.DB_USER;
const pwd = process.env.DB_PASS;
const dsn_name = process.env.DSN_NAME;
const encoding_name = "UTF-8";
const oracledb = require("oracledb");
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

function checkDateInput(indate) {
  const splited = indate.split("-");
  if (splited.length < 1) {
    return -1;
  }
  let date_pattern;
  if (splited.length === 3) {
    date_pattern = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
  } else if (splited.length === 2) {
    date_pattern = /^([0-9]{4})-([0-9]{2})$/;
  } else if (splited.length === 1) {
    date_pattern = /^([0-9]{4})$/;
  }

  const z = indate.match(date_pattern);
  if (z) {
    return z.length - 1;
  } else {
    return -1;
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
        wallet_id: wallet[0],
        wallet_name: wallet[1],
        timezone: wallet[2],
      };
    }
  } catch (error) {
    return -1;
  }
}

function getSqlQuery(oper, withnote = 1, datefmt = 3) {
  let db_datefmt = "";

  if (oper === "all" && withnote === 1) {
    return "SELECT TO_CHAR(fulldate,'YYYY-MM-DD hh24:mi:ss'), EXVALUE, note from expense where UNAME = :uname order by 1";
  }

  if (oper === "all" && withnote === 0) {
    return "SELECT TO_CHAR(fulldate,'YYYY-MM-DD hh24:mi:ss'), EXVALUE from expense where UNAME = :uname order by 1";
  }

  if (oper === "showday") {
    if (datefmt === 3) {
      db_datefmt = "YYYY-MM-DD";
    } else if (datefmt === 2) {
      db_datefmt = "YYYY-MM";
    } else if (datefmt === 1) {
      db_datefmt = "YYYY";
    }

    if (withnote === 1) {
      return `SELECT TO_CHAR(fulldate,'YYYY-MM-DD hh24:mi:ss'), EXVALUE, note from expense where UNAME = :uname and TO_CHAR(fulldate,'${db_datefmt}') = :jdate order by 1`;
    } else {
      return `SELECT TO_CHAR(fulldate,'YYYY-MM-DD hh24:mi:ss'), EXVALUE from expense where UNAME = :uname and TO_CHAR(fulldate,'${db_datefmt}') = :jdate order by 1`;
    }
  }

  if (oper === "sumday") {
    if (datefmt === 3) {
      db_datefmt = "YYYY-MM-DD";
    } else if (datefmt === 2) {
      db_datefmt = "YYYY-MM";
    } else if (datefmt === 1) {
      db_datefmt = "YYYY";
    }

    return `SELECT TO_CHAR(fulldate,'${db_datefmt}'), sum(EXVALUE) from expense where UNAME = :uname and WALLET_ID = :wallet_id and TO_CHAR(fulldate,'${db_datefmt}') = :jdate group by TO_CHAR(fulldate,'${db_datefmt}')`;
  }

  if (oper === "create") {
    return "insert into WALLET values(:uname, :wallet_id, :wallet_name, :tz)";
  }

  if (oper === "wallet") {
    return "SELECT wallet_id, wallet_name, timezone from wallet where UNAME = :uname ORDER BY 1";
  }

  if (oper === "change_wallet") {
    return "UPDATE dbuser1.users SET wallet_id = :wallet_id WHERE UNAME = :uname";
  }

  if (oper === "upsert_wallet") {
    return "MERGE INTO dbuser1.users u USING (SELECT :uname AS uname, :wallet_id AS wallet_id FROM dual) s ON (u.uname = s.uname) WHEN MATCHED THEN UPDATE SET u.wallet_id = s.wallet_id WHEN NOT MATCHED THEN INSERT (uname, wallet_id) VALUES (s.uname, s.wallet_id)";
  }

  if (oper === "sumall") {
    return "SELECT sum(EXVALUE), null as firstday from expense where UNAME = :uname and WALLET_ID = :wallet_id UNION SELECT null, TO_CHAR(min(fulldate),'YYYY-MM-DD') from expense where UNAME = :uname and WALLET_ID = :wallet_id";
  }

  if (oper === "search") {
    return "SELECT TO_CHAR(fulldate,'YYYY-MM-DD hh24:mi:ss'), EXVALUE, note from expense where UNAME = :uname and note like :keysearch order by 1";
  }

  if (oper === "sumbymonth") {
    return "select TO_CHAR(fulldate,'YYYY-MM'),sum(exvalue) from expense where UNAME = :uname and WALLET_ID = :wallet_id group by TO_CHAR(fulldate,'YYYY-MM') order by 1 asc";
  }

  if (oper === "sumthismonth") {
    return "select TO_CHAR(fulldate,'YYYY-MM'),sum(exvalue) from expense where UNAME = :uname and WALLET_ID = :wallet_id and TO_CHAR(fulldate,'YYYY-MM') = :tmonth group by TO_CHAR(fulldate,'YYYY-MM') order by 1 desc fetch first row only";
  }
}

async function sumDay(connection, userid, justdate, wallet_id) {
  let new_message = "";
  const datefmt = checkDateInput(justdate);
  if (datefmt < 0) {
    return "Only date format 'YYYY-[MM]-[DD]' is allowed";
  }
  const sql_select_with_param = getSqlQuery("sumday", 1, datefmt);
  const data_tuple = [userid, wallet_id, justdate];
  const records = await connection.execute(sql_select_with_param, data_tuple);

  if (records.rows.length === 0) {
    return `[${wallet_id}]` + "No records found on " + justdate;
  }

  for (let i = 0; i < records.rows.length; i++) {
    const row = records.rows[i];
    const newrec =
      `[${wallet_id}]` + "Total expense on " + row[0] + " = " + row[1];
    new_message += newrec;
    if (i === records.length - 1) {
      // If it's the last record, don't add a newline
    } else {
      new_message += "\n";
    }
  }
  return new_message;
}

async function handle_message(event) {
  let res_message = "-";
  let connection;
  try {
    connection = await oracledb.getConnection({
      user: username,
      password: pwd,
      connectString: dsn_name,
      encoding: encoding_name,
    });
    console.log("Successfully connected to Oracle Database");

    const msg_from_user = event.events[0].message.text;
    const userid = event.events[0].source.userId;
    let extracted = msg_from_user.split(" ");
    const inst_from_user = extracted[0].toLowerCase();

    console.log(inst_from_user);

    // Create Wallet
    if (inst_from_user === "create") {
      const sql_select_with_param =
        "SELECT max(wallet_id) from wallet where UNAME = :uname";
      const data_tuple = [userid];
      const records = await connection.execute(
        sql_select_with_param,
        data_tuple
      );

      // Validate the timezone
      if (!moment.tz.zone(extracted[2])) {
        return "Invalid timezone provided. Please provide a valid timezone.";
      }

      let new_wallet_id;
      if (records.rows[0][0] === null) {
        // No wallet found, so start with wallet_id = 1
        new_wallet_id = 0;
      } else {
        // If a wallet was found, increment the max wallet_id by 1
        new_wallet_id = records.rows[0][0] + 1;
      }

      const sql_insert_with_param = getSqlQuery("create");
      const data_tuple1 = [userid, new_wallet_id, extracted[1], extracted[2]];
      const insert_result = await connection.execute(
        sql_insert_with_param,
        data_tuple1
      );

      // Check if the insertion was successful
      if (insert_result.rowsAffected > 0) {
        // Upsert operation
        const sql_upsert_with_param = `
          MERGE INTO dbuser1.users u
          USING (SELECT :uname AS uname, :wallet_id AS wallet_id FROM dual) s
          ON (u.uname = s.uname)
          WHEN MATCHED THEN
              UPDATE SET u.wallet_id = s.wallet_id
          WHEN NOT MATCHED THEN
              INSERT (uname, wallet_id)
              VALUES (s.uname, s.wallet_id)
      `;
        const data_tuple_upsert = [userid, new_wallet_id];
        await connection.execute(sql_upsert_with_param, data_tuple_upsert);

        await connection.commit();

        res_message =
          `[${new_wallet_id}] ${extracted[1]} created successfully!\n` +
          `[${new_wallet_id}] ${extracted[1]} is your current wallet (${extracted[2]})`;
        return res_message;
      } else {
        return "Failed to create wallet.";
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
      res_message =
        "Available commands are listed below: \n\n" +
        "1. {+,-}10000 [detail]: add expense or income which detail is an optional\n" +
        "For example, -1200 taxi meter | +1000\n\n" +
        "2. show {YYYY-[MM]-[DD]} [-n]: list transaction on specified date (MM,DD can be omitted)\n" +
        "For example, show 2022-09 | show 2022-09-01\n\n" +
        "3. sum {YYYY-[MM]-[DD]}: sum all expense on specified date (MM,DD can be omitted)\n" +
        "For example, sum 2022 | sum 2022-08\n\n" +
        "4. showall [-n]: show all transaction. include -n to ignore detail\n\n" +
        "5. sumall: sum all expense from starting date";
    } else if (inst_from_user === "sum" && extracted.length === 2) {
      // Expect date to be 'YYYY-MM-DD' format only
      const targetdate = extracted[1];
      res_message = await sumDay(connection, userid, targetdate, wallet[0]);
    } else if (inst_from_user === "sumall") {
      try {
        const response = await axios.get(`${API_URL}/sumall`, {
          params: {
            userid: userid,
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
            userid: userid,
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
    } else if (inst_from_user === "avgbymonth") {
      try {
        const response = await axios.get(`${API_URL}/sumbymonth`, {
          params: {
            userid: userid,
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

      const sql_insert_with_param =
        "INSERT INTO expense(UNAME,EXVALUE,FULLDATE,NOTE,WALLET_ID) VALUES (:uname,:val,TO_DATE(:targetdate, 'YYYY-MM-DD HH24:MI:SS'),:note,:WALLET_ID)";
      const data_tuple1 = [
        userid,
        inst_from_user,
        targetdate,
        note,
        parseInt(wallet.wallet_id),
      ];
      await connection.execute(sql_insert_with_param, data_tuple1);

      const res_message1 = await sumDay(
        connection,
        userid,
        justdate,
        wallet.wallet_id
      );

      const sql_select_with_param = getSqlQuery("sumthismonth", 0);
      const data_tuple2 = [userid, wallet.wallet_id, year_n_month];
      const records = await connection.execute(
        sql_select_with_param,
        data_tuple2
      );
      let num_days = 0;
      if (year_n_month === this_year_n_month) {
        num_days = parseInt(localDatetime.toISOString().slice(8, 10));
      } else {
        const month_range = getMRange(year_n_month);
        num_days = month_range[1];
      }

      let res_message2 = `\n\n**Expense Report This Month**\n`;
      res_message2 += "Total = " + records.rows[0][1] + "\n";
      res_message2 += "Avg.  = " + (records.rows[0][1] / num_days).toFixed(2);
      connection.commit();
      res_message = res_message1 + res_message2;
    }
  } catch (err) {
    console.error(err);
    res_message = err;
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error(err);
      }
    }
  }

  return res_message;
  //reply(event, res_message);
}

async function handle_location(event) {
  const latitude = event.events[0].message.latitude;
  const longitude = event.events[0].message.longitude;
  // Make a nearby search request to Google Places API

  const apiKey = process.env.API_KEY;
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
