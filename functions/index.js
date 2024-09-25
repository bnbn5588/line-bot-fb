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

// index.js or app.js
require("dotenv").config(); // Load .env file

// Import the moment-timezone library to work with time zones
const moment = require("moment-timezone");
// Define the time zone variable
const tz = "Asia/Taipei"; // Replace this with your intended time zone

// Define the Autonomous Database variables
const username = process.env.DB_USER;
const pwd = process.env.DB_PASS;
const dsn_name = process.env.DSN_NAME;
const encoding_name = "UTF-8";
const oracledb = require("oracledb");

const LINE_MESSAGING_API = "https://api.line.me/v2/bot/message";
const LINE_HEADER = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${process.env.LB_KEY}`,
};

exports.LineBot = functions.https.onRequest(async (req, res) => {
  // console.log(req.body.events[0].message.type);
  const userId = req.body.events[0].source.userId;
  if (req.body.events[0].message.type === "location") {
    const responseText = await handle_location(req.body);
    reply(req.body, responseText);
  } else if (req.body.events[0].message.type == "text") {
    // console.log(userId);
    const responseText = await handle_message(req.body, userId);
    reply(req.body, responseText);
  } else return;
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

    return `SELECT TO_CHAR(fulldate,'${db_datefmt}'), sum(EXVALUE) from expense where UNAME = :uname and TO_CHAR(fulldate,'${db_datefmt}') = :jdate group by TO_CHAR(fulldate,'${db_datefmt}')`;
  }

  if (oper === "sumall") {
    return "SELECT sum(EXVALUE), null as firstday from expense where UNAME = :uname UNION SELECT null, TO_CHAR(min(fulldate),'YYYY-MM-DD') from expense where UNAME = :uname";
  }

  if (oper === "search") {
    return "SELECT TO_CHAR(fulldate,'YYYY-MM-DD hh24:mi:ss'), EXVALUE, note from expense where UNAME = :uname and note like :keysearch order by 1";
  }

  if (oper === "sumbymonth") {
    return "select TO_CHAR(fulldate,'YYYY-MM'),sum(exvalue) from expense where UNAME = :uname group by TO_CHAR(fulldate,'YYYY-MM') order by 1 asc";
  }

  if (oper === "sumthismonth") {
    return "select TO_CHAR(fulldate,'YYYY-MM'),sum(exvalue) from expense where UNAME = :uname and TO_CHAR(fulldate,'YYYY-MM') = :tmonth group by TO_CHAR(fulldate,'YYYY-MM') order by 1 desc fetch first row only";
  }
}

async function allDay(cur, userid, justdate, noteflag = 1) {
  let new_message = "";
  const datefmt = checkDateInput(justdate);

  if (datefmt < 0) {
    return "Only date format 'YYYY-[MM]-[DD]' is allowed";
  }

  const sql_select_with_param = getSqlQuery("showday", noteflag, datefmt);
  const data_tuple = [userid, justdate];

  try {
    await cur.execute(sql_select_with_param, data_tuple);
    const records = await cur.fetchall();

    if (records.length === 0) {
      return "no records found on " + justdate;
    }

    for (const row of records) {
      const newrec =
        noteflag === 1
          ? `${row[0]}, ${row[1]} ${row[2]}`
          : `${row[0]}, ${row[1]}`;

      new_message += newrec;

      if (row !== records[records.length - 1]) {
        new_message += "\n";
      }
    }

    return new_message;
  } catch (error) {
    // Handle any error that may occur during database operation
    console.error(error);
    return "An error occurred while fetching records.";
  }
}

async function sumDay(connection, userid, justdate) {
  let new_message = "";
  const datefmt = checkDateInput(justdate);
  if (datefmt < 0) {
    return "Only date format 'YYYY-[MM]-[DD]' is allowed";
  }
  const sql_select_with_param = getSqlQuery("sumday", 1, datefmt);
  const data_tuple = [userid, justdate];
  const records = await connection.execute(sql_select_with_param, data_tuple);

  if (records.rows.length === 0) {
    return "No records found on " + justdate;
  }

  for (let i = 0; i < records.rows.length; i++) {
    const row = records.rows[i];
    const newrec = "Total expense on " + row[0] + " = " + row[1];
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
    const localDatetime = moment.tz(new Date(), tz);
    const userid = event.events[0].source.userId;
    const targetdate = localDatetime.format("YYYY-MM-DD HH:mm:ss");
    let justdate = localDatetime.format("YYYY-MM-DD");
    let justhour = localDatetime.format("HH:mm:ss");
    const this_year_n_month = localDatetime.format("YYYY-MM");
    let year_n_month = this_year_n_month;

    let extracted = msg_from_user.split(" ");
    const inst_from_user = extracted[0].toLowerCase();

    console.log(inst_from_user);

    if (inst_from_user.toLowerCase() === "help") {
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
      res_message = await sumDay(connection, userid, targetdate);
    } else if (inst_from_user === "sumall") {
      const sql_select_with_param = getSqlQuery("sumall");
      const data_tuple = [userid, userid];
      const records = await connection.execute(
        sql_select_with_param,
        data_tuple
      );
      const record_sum = records.rows[0][0];
      const record_fristdate = records.rows[1][1];
      res_message = `Total Expense: ${record_sum} starting from ${record_fristdate}`;
    } else if (inst_from_user === "sumbymonth") {
      const sql_select_with_param = getSqlQuery("sumbymonth", 0);
      const data_tuple = [userid];
      const records = await connection.execute(
        sql_select_with_param,
        data_tuple
      );
      res_message = "Total Monthly Expense \n";
      for (const row of records.rows) {
        const newrec = `${row[0]}: Total Expense = ${row[1]}`;
        res_message += newrec + "\n";
      }
    } else if (inst_from_user === "avgbymonth") {
      const sql_select_with_param = getSqlQuery("sumbymonth", 0);
      const data_tuple = [userid];
      const records = await connection.execute(
        sql_select_with_param,
        data_tuple
      );
      res_message = "Average Daily Expense \n";
      for (const row of records.rows) {
        const month_range = getMRange(row[0]);
        const num_days =
          row[0] === this_year_n_month
            ? parseInt(localDatetime.toISOString().slice(8, 10))
            : month_range[1];
        const newrec = `${row[0]}: Avg. Expense = ${(row[1] / num_days).toFixed(
          2
        )}`;
        res_message += newrec + "\n";
      }
    } else if (
      inst_from_user.startsWith("+") ||
      inst_from_user.startsWith("-")
    ) {
      // Send message to user.
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

      const targetdate = justdate + " " + justhour;

      let note = "";
      if (extracted.length > 1) {
        note = extracted.slice(1).join(" ");
      }

      const sql_insert_with_param =
        "INSERT INTO expense(UNAME,EXVALUE,FULLDATE,NOTE) VALUES (:uname,:val,TO_DATE(:fulldate,'YYYY-MM-DD hh24:mi:ss'),:note)";
      const data_tuple1 = [userid, inst_from_user, targetdate, note];
      const insert_result = await connection.execute(
        sql_insert_with_param,
        data_tuple1
      );
      let res_message1 = await sumDay(connection, userid, justdate);

      const sql_select_with_param = getSqlQuery("sumthismonth", 0);
      const data_tuple2 = [userid, year_n_month];
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

      let res_message2 = "\n\n**Expense Report This Month**\n";
      res_message2 += "Total = " + records.rows[0][1] + "\n";
      res_message2 += "Avg.  = " + (records.rows[0][1] / num_days).toFixed(2);
      connection.commit();
      res_message = res_message1 + res_message2;
    }
  } catch (err) {
    console.error(err);
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
  let places = []; // Array to store all places

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
