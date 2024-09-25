console.log("Welcome to Programiz!");

// Import the moment-timezone library to work with time zones
const moment = require("moment-timezone");

// Define the time zone variable
const tz = "Asia/Taipei"; // Replace this with your intended time zone

const localDatetime = moment.tz(new Date(), tz);
const targetdate = localDatetime.format("YYYY-MM-DD HH:mm:ss");
const justdate = localDatetime.format("YYYY-MM-DD");
const justhour = localDatetime.format("HH:mm:ss");
const this_year_n_month = localDatetime.format("YYYY-MM");
const year_n_month = this_year_n_month;
console.log(targetdate);

function getMRange(indate) {
  const splited = indate.split("-");
  const nyear = parseInt(splited[0]);
  const nmonth = parseInt(splited[1]);

  const firstDayOfMonth = new Date(nyear, nmonth - 1, 1);
  const lastDayOfMonth = new Date(nyear, nmonth, 0);
  const mrange = [firstDayOfMonth.getDate(), lastDayOfMonth.getDate()];

  return mrange;
}

console.log(getMRange("2023-05"));
// Define the Autonomous Database variables
const username = process.env.DB_USER;
const pwd = process.env.DB_PASS;
const dsn_name = process.env.DSN_NAME;
const encoding_name = "UTF-8";
const oracledb = require("oracledb");

async function run() {
  let connection;
  try {
    connection = await oracledb.getConnection({
      user: username,
      password: pwd,
      connectString: dsn_name,
      encoding: encoding_name,
    });

    const cur = connection.execute;
    console.log("Successfully connected to Oracle Database");
    sql_select_with_param =
      "SELECT sum(EXVALUE), null as firstday from expense where UNAME = :uname UNION SELECT null, TO_CHAR(min(fulldate),'YYYY-MM-DD') from expense where UNAME = :uname";
    userid = "0";
    data_tuple = [userid, userid];
    const records = await connection.execute(sql_select_with_param, data_tuple);
    const record_sum = records.rows[0][0];
    const record_fristdate = records.rows[1][1];
    let res_message = `Total Expense: ${record_sum} starting from ${record_fristdate}`;
    console.log(records.rows.length);

    db_datefmt = "YYYY-MM-DD";
    date2 = "2023-01-10";
    sql2 =
      "select TO_CHAR(fulldate,'YYYY-MM'),sum(exvalue) from expense where UNAME = :uname and TO_CHAR(fulldate,'YYYY-MM') = :tmonth group by TO_CHAR(fulldate,'YYYY-MM') order by 1 desc fetch first row only";
    let year_n_month = "2023-01";
    data_tuple2 = [userid, year_n_month];
    const records2 = await connection.execute(sql2, data_tuple2);
    console.log(records2.rows.length);
    res_message = "Total Monthly Expense \n";
    for (const row of records2.rows) {
      const newrec = "Total = " + row[1] + "\n";
      res_message += newrec + "\n";
    }
    let res_message2 = "\n\n**Expense Report This Month**\n";
    res_message2 += "Total = " + records2.rows[0][1] + "\n";
    console.log(res_message2);
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
}

run();
