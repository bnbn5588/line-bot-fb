# LINE Bot — Firebase Functions Webhook

A **Firebase Cloud Functions** webhook for a LINE Official Account that provides personal expense tracking and restaurant discovery via location sharing.

---

## Architecture

```
LINE OA User
    │
    ▼ (HTTPS POST)
Firebase Function: LineBot
    ├── Text message  ──► Backend REST API (expense tracking)
    └── Location msg  ──► Google Places API (restaurant picker)
                               │
                               ▼
                        LINE Messaging API (reply)
```

---

## Features

### Expense Tracker (text commands)

| Command | Description | Example |
|---|---|---|
| `create [name] [timezone]` | Create a new wallet | `create my_wallet Asia/Bangkok` |
| `help` | List all available commands | `help` |
| `sumall` | Total balance across all time | `sumall` |
| `sumbymonth` | Monthly expense breakdown | `sumbymonth` |
| `sumbynote` | All-time expenses grouped by note | `sumbynote` |
| `sumbynote -m` | This month's expenses by note | `sumbynote -m` |
| `sumbynote -m [YYYY-MM]` | Specific month's expenses by note | `sumbynote -m 2024-03` |
| `avgbymonth` | Average daily expense per month | `avgbymonth` |
| `wallet` | List all wallets (`*` = active) | `wallet` |
| `wallet [id]` | Switch active wallet | `wallet 3` |
| `+[amount] [note]` | Add income | `+500 salary` |
| `-[amount] [note]` | Add expense | `-120 lunch` |
| `+/-[amount] [note] -d [YYYY-MM-DD]` | Record with specific date | `-80 coffee -d 2024-03-15` |
| `+/-[amount] [note] -h [HH:mm:ss]` | Record with specific time | `-80 coffee -h 14:30:00` |

### Restaurant Picker (location message)

Share your location in the LINE chat and the bot will:
1. Search for open restaurants within 1 km using Google Places
2. Pick one at random (weighted by rating — higher-rated places have a better chance)
3. Reply with the restaurant name and a Google Maps link

---

## Prerequisites

- [Node.js 20](https://nodejs.org/)
- [Firebase CLI](https://firebase.google.com/docs/cli) (`npm install -g firebase-tools`)
- A [LINE Developer account](https://developers.line.biz/) with a Messaging API channel
- A [Google Cloud project](https://console.cloud.google.com/) with the **Places API** enabled
- A running backend REST API (see [Backend API](#backend-api) below)

---

## Project Structure

```
bot-javascript/
├── functions/
│   ├── index.js        # Main webhook handler (all bot logic lives here)
│   ├── .env            # Local environment variables (never commit this)
│   └── package.json
└── README.md
```

---

## Environment Variables

Create `functions/.env` with the following keys (never commit real values to git):

```env
LB_KEY=<LINE channel access token>
API_URL=<Base URL of your backend REST API>
API_KEY=<x-api-key header value for your backend>
G_API_KEY=<Google Places API key>
```

> **Warning:** The `.env` file contains secrets. Make sure it is listed in `.gitignore`.

For production deployments, use [Firebase Secret Manager](https://firebase.google.com/docs/functions/config-env#secret-manager) instead of `.env` files.

---

## Local Development

```bash
cd functions
npm install

# Start the Firebase emulator
npm run serve
```

Use a tunneling tool (e.g. [ngrok](https://ngrok.com/)) to expose the local emulator and set the tunnel URL as your LINE webhook URL.

---

## Deployment

```bash
cd functions

# Deploy only the Cloud Functions
npm run deploy
```

After deploying, set the Firebase Function URL as your LINE OA webhook URL:

```
https://<region>-<project-id>.cloudfunctions.net/LineBot
```

Enable **"Use webhook"** in the LINE Developer Console and verify the connection.

---

## Backend API

This webhook delegates all expense data to an external REST API. The expected endpoints are:

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/wallet` | Get active wallet for a user |
| `GET` | `/wallets` | List all wallets for a user |
| `POST` | `/createWallet` | Create a new wallet |
| `POST` | `/changeWallet` | Switch the active wallet |
| `POST` | `/add` | Add an income or expense record |
| `GET` | `/sumall` | Total balance across all time |
| `GET` | `/sumbymonth` | Monthly totals |
| `GET` | `/sumbynote` | Totals grouped by note/category |
| `GET` | `/help` | List of available commands |

All requests include an `x-api-key` header for authentication.

---

## Useful Commands

```bash
npm run serve    # Start local emulator
npm run deploy   # Deploy to Firebase
npm run logs     # Tail function logs
npm run lint     # Run ESLint
```
