# Setup — 張園 Rental CRM Custom GPT

This version does **not** use the OpenAI API. The AI reasoning happens inside
your private Custom GPT in ChatGPT. Railway only exposes a small protected CRM
bridge.

## 1. Deploy the repository update

Replace/add the files from this package:

- `reader/server.js`
- `web/app/page.js`
- `web/app/styles.css`
- `web/app/admin/page.js`
- `web/public/images/zheungyuan/village-house-exterior.webp`
- `web/public/images/zheungyuan/village-house-living-room.webp`
- `web/public/images/zheungyuan/village-house-kitchen.webp`
- `web/public/images/zheungyuan/village-house-staircase.webp`

`web/app/layout.js` is included for completeness but is unchanged from the
premium homepage version.

Do **not** change:
- reader Dockerfile
- whatsapp-web.js patch files
- Railway volume
- WhatsApp linked device

## 2. Add one Railway secret

In the `whatsapp-reader` Railway service:

Variables -> New Variable

Name:
`READER_GPT_KEY`

Value:
Choose a long private random password/token (32+ characters is sensible).

Do not put this value into GitHub.

Redeploy the reader.

## 3. Test the reader itself

The WhatsApp reader homepage should still show:
- Connected
- Preview prospects
- Import prospects

It will also show:
`Custom GPT bridge — Configured`

The GPT endpoints work from Postgres and do not need WhatsApp to be actively
syncing at the moment the GPT reads stored records.

## 4. Create the private Custom GPT

Create a new GPT in ChatGPT.

Suggested name:
`張園 Rental CRM`

Suggested description:
`Private CRM assistant for analysing village-house rental enquiries, structuring renter demand and preparing future property matches.`

Set visibility/sharing to:
`Only me`

Paste the full contents of `CUSTOM_GPT_INSTRUCTIONS.md` into Instructions.

Suggested conversation starters:
- `Analyse the next 10 renter leads`
- `What renter demand do we currently have?`
- `Show me active prospects`
- `Which prospect records need human review?`

## 5. Add the Action

In the GPT editor, open Actions and create a new action.

Authentication:
- Type: API Key
- Auth type: Bearer
- Secret/value: the exact same value as Railway `READER_GPT_KEY`

Schema:
Paste the full contents of:
`custom-gpt-action-openapi.yaml`

The schema is already pointed at:
`https://whatsapp-reader-production-e4bf.up.railway.app`

## 6. Test in GPT Preview

First ask:
`Check the Zheungyuan CRM connection.`

The GPT should call `checkZheungyuanCRM`.

Then ask:
`Show me the next 5 unreviewed prospects without analysing them.`

Finally:
`Analyse the next 3 leads and save the results.`

After that, open the 張園 `/admin` dashboard. Those records should show:
- requirement summaries
- budgets
- area
- bedrooms/floor
- garden/rooftop/pets/parking
- active/historical/closed status
- GPT confidence

## Important

The uploaded rooftop reference photo with the repeated phone-number watermark is
intentionally NOT used on the public site. The four clean real property photos
are used instead.

This update does not add an OpenAI API key or API billing.
