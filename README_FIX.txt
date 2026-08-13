FIX FOR RAILWAY BUILD ERROR: Cannot resolve ../../lib/db

Cause:
The new nested admin pages were one directory deeper than the previous admin page,
so their relative imports pointed at web/app/lib/db instead of web/lib/db.

Replace these files:
- web/app/admin/page.js
- web/app/admin/renters/page.js
- web/app/admin/landlords/page.js
- web/app/admin/properties/page.js
- web/app/admin/agents/page.js
- web/app/admin/matches/page.js

Correct imports:
- web/app/admin/page.js -> ../../lib/db
- nested pages under web/app/admin/<section>/page.js -> ../../../lib/db

No reader/WhatsApp changes are required for this specific build failure.
