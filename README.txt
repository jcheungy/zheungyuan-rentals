FIX: renter analysis stuck pending

Root cause: the Custom GPT bridge required separate list/read/save calls for each contact. With ~391 pending contacts this can exceed a turn/tool-call budget.

Deploy:
1. Replace reader/server.js with this package's reader/server.js.
2. Let Railway redeploy whatsapp-reader.
3. In the Custom GPT Action, replace the schema with Zheungyuan_Custom_GPT_Action_OpenAPI_v2.3.yaml and keep the same Bearer authentication secret.
4. Add/replace the workflow instructions using Zheungyuan_Custom_GPT_Instructions_Batch_Patch_v2.3.txt.
5. Ask: Analyse every unreviewed CRM contact using the batch review workflow and continue until zero remain.

Verification:
/gpt/health should report crmVersion 2.3-batch-review (requires Bearer auth).
The new Action operations are getUnreviewedContactBatch and saveContactAnalysisBatch.
