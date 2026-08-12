# 張園 Zheungyuan Rentals — Starter

A separate Railway project for:
1. A landlord-facing village-house rental brand.
2. A WhatsApp Web reader that builds a structured renter-demand database.

## Railway layout

Create two Railway services from the same GitHub repository:

- `web` — Root Directory: `/web`
- `reader` — Root Directory: `/reader`

Both services use the same Railway PostgreSQL `DATABASE_URL`.

### Reader persistence
For the easiest WhatsApp Web login persistence, attach a Railway Volume to the `reader`
service and mount it at:

`/app/.wwebjs_auth`

Without a persistent volume, you may need to scan the QR code again after redeploy/restart.

## Environment variables

### web
- `DATABASE_URL` — Railway Postgres reference
- `ADMIN_KEY` — any long private string

### reader
- `DATABASE_URL` — Railway Postgres reference
- `READER_PORT=3001`
- `WA_CLIENT_ID=zheungyuan-rentals`
- `WA_AUTH_PATH=/app/.wwebjs_auth`

## First deployment

1. Push this repo to GitHub.
2. In the existing Railway project, add a service from GitHub and set Root Directory to `/web`.
3. Add a second service from the same repo and set Root Directory to `/reader`.
4. Give both services access to the Postgres `DATABASE_URL`.
5. Open the `web` deployment URL.
6. Open the `reader` deployment URL + `/qr` and scan the QR code.
7. Once WhatsApp is connected, call `/sync/chats` on the reader to ingest chat metadata.

## Important
`whatsapp-web.js` is unofficial and relies on WhatsApp Web. Treat it as a prototype.
Avoid bulk messaging or aggressive automation. This starter reads data; it does not send messages.
