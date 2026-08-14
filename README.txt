ZHEUNGYUAN v2.4 — ALL CONTACTS + SUMMARY-ONLY GPT

Replace these repo files:
1. reader/server.js
2. web/app/admin/renters/page.js

Then update the Custom GPT Action schema with:
Zheungyuan_Custom_GPT_Action_OpenAPI_v2.4.yaml

Replace the Custom GPT instructions with:
Zheungyuan_Custom_GPT_Instructions_v2.4.txt

Result:
- all imported contacts stay visible/searchable in the table
- GPT only summarizes chats and extracts renter requirements
- GPT no longer has classification-write actions in its schema
- new WhatsApp messages automatically mark a contact for re-summary
