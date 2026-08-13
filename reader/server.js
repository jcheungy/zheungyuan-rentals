const express = require("express");
const QRCode = require("qrcode");
const pg = require("pg");
const fs = require("fs");
const path = require("path");
const { Client, LocalAuth } = require("whatsapp-web.js");

const app = express();
app.use(express.json({ limit: "4mb" }));

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : undefined
});

let qrDataUrl = null;
let waReady = false;

let syncState = {
  running: false,
  lastSync: null,
  chatsSeen: 0,
  messagesSaved: 0
};

let bulkImportState = {
  running: false,
  mode: null,
  startedAt: null,
  completedAt: null,
  chatsScanned: 0,
  matchingChatsFound: 0,
  contactsProcessed: 0,
  messagesRead: 0,
  newMessagesSaved: 0,
  currentContact: null,
  error: null
};

let discoveryImportState = {
  running: false,
  startedAt: null,
  completedAt: null,
  chatsScanned: 0,
  directChatsFound: 0,
  contactsProcessed: 0,
  messagesRead: 0,
  newMessagesSaved: 0,
  currentContact: null,
  error: null
};

let historySyncState = {
  running: false,
  phase: null,
  startedAt: null,
  completedAt: null,
  directChatsFound: 0,
  chatsProcessed: 0,
  historyRequestsAttempted: 0,
  historyRequestsSucceeded: 0,
  historyRequestsUnavailable: 0,
  historyRequestErrors: 0,
  messagesRead: 0,
  newMessagesSaved: 0,
  secondPassMessagesRead: 0,
  secondPassNewMessagesSaved: 0,
  currentContact: null,
  error: null
};

const authPath = process.env.WA_AUTH_PATH || "./.wwebjs_auth";
const clientId = process.env.WA_CLIENT_ID || "zheungyuan-rentals";
const gptKey = process.env.READER_GPT_KEY || "";

const PROSPECT_LABELS = ["To organise viewing", "Viewings -"];
const TENANT_LABELS = ["Tenants"];
const AGENT_LABELS = ["Agents"];
const LANDLORD_LABELS = ["Landlords", "Landlord", "Owners", "Property owners"];

const DEFAULT_CRM_LABELS = [
  ...PROSPECT_LABELS,
  ...TENANT_LABELS,
  ...AGENT_LABELS,
  ...LANDLORD_LABELS
];

const EXTRA_CRM_LABELS = String(process.env.CRM_EXTRA_LABELS || "")
  .split(",")
  .map(x => x.trim())
  .filter(Boolean);

const CRM_IMPORT_LABELS = [...new Set([
  ...DEFAULT_CRM_LABELS,
  ...EXTRA_CRM_LABELS
])];

function clearStaleChromiumLocks() {
  const lockNames = new Set([
    "SingletonLock",
    "SingletonSocket",
    "SingletonCookie"
  ]);

  const roots = [
    authPath,
    path.join(authPath, `session-${clientId}`)
  ];

  function walk(dir, depth = 0) {
    if (depth > 3) return;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.warn(`Could not inspect ${dir}:`, err.message);
      }
      return;
    }

    for (const entry of entries) {
      const target = path.join(dir, entry.name);

      if (lockNames.has(entry.name)) {
        try {
          fs.unlinkSync(target);
          console.log(`Removed stale Chromium lock: ${target}`);
        } catch (err) {
          if (err.code !== "ENOENT") {
            console.warn(
              `Could not remove stale Chromium lock ${target}:`,
              err.message
            );
          }
        }
        continue;
      }

      if (entry.isDirectory()) walk(target, depth + 1);
    }
  }

  for (const root of roots) walk(root);
}

clearStaleChromiumLocks();

const client = new Client({
  authStrategy: new LocalAuth({
    clientId,
    dataPath: authPath
  }),
  puppeteer: {
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage"
    ]
  }
});

client.on("qr", async qr => {
  qrDataUrl = await QRCode.toDataURL(qr);
  waReady = false;
  console.log("WhatsApp QR generated");
});

client.on("authenticated", () =>
  console.log("WhatsApp authenticated")
);

client.on("ready", () => {
  waReady = true;
  qrDataUrl = null;
  console.log("WhatsApp ready");
});

client.on("disconnected", reason => {
  waReady = false;
  console.log("WhatsApp disconnected:", reason);
});

async function ensureSchema() {
  const sql = `
  CREATE TABLE IF NOT EXISTS renters (
    id BIGSERIAL PRIMARY KEY,
    whatsapp_chat_id TEXT UNIQUE NOT NULL,
    display_name TEXT,
    phone TEXT,
    first_enquiry_at TIMESTAMPTZ,
    last_message_at TIMESTAMPTZ,

    area_wanted TEXT,
    budget_min INTEGER,
    budget_max INTEGER,
    bedrooms INTEGER,
    preferred_floor TEXT,
    wants_garden BOOLEAN,
    wants_rooftop BOOLEAN,
    pets_required BOOLEAN,
    pet_details TEXT,
    parking_needed BOOLEAN,
    move_in_date DATE,
    occupants TEXT,
    source_property TEXT,
    requirement_summary TEXT,

    status TEXT NOT NULL DEFAULT 'unknown',
    contact_type TEXT NOT NULL DEFAULT 'unknown',

    contact_summary TEXT,
    relationship_status TEXT,
    classification_confidence DOUBLE PRECISION,
    classification_updated_at TIMESTAMPTZ,

    analysis_confidence DOUBLE PRECISION,
    analysis_notes TEXT,
    analysis_source TEXT,
    analysis_updated_at TIMESTAMPTZ,

    labels JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id BIGSERIAL PRIMARY KEY,
    whatsapp_message_id TEXT UNIQUE NOT NULL,
    whatsapp_chat_id TEXT NOT NULL,
    renter_id BIGINT REFERENCES renters(id) ON DELETE SET NULL,
    direction TEXT NOT NULL,
    sender_name TEXT,
    body TEXT,
    message_type TEXT,
    message_at TIMESTAMPTZ,
    raw JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS properties (
    id BIGSERIAL PRIMARY KEY,
    owner_contact_id BIGINT REFERENCES renters(id) ON DELETE SET NULL,
    source_contact_id BIGINT REFERENCES renters(id) ON DELETE SET NULL,
    title TEXT,
    area TEXT,
    village TEXT,
    address_text TEXT,
    asking_rent INTEGER,
    floor TEXT,
    bedrooms INTEGER,
    size_sqft INTEGER,
    has_garden BOOLEAN,
    has_rooftop BOOLEAN,
    pets_allowed BOOLEAN,
    parking_spaces INTEGER,
    availability_text TEXT,
    available_from DATE,
    status TEXT NOT NULL DEFAULT 'unknown',
    property_summary TEXT,
    source_notes TEXT,
    analysis_confidence DOUBLE PRECISION,
    analysis_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS property_matches (
    id BIGSERIAL PRIMARY KEY,
    property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    renter_id BIGINT NOT NULL REFERENCES renters(id) ON DELETE CASCADE,
    demand_type TEXT NOT NULL DEFAULT 'historical',
    match_score INTEGER NOT NULL DEFAULT 0,
    reasons TEXT,
    status TEXT NOT NULL DEFAULT 'suggested',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(property_id, renter_id)
  );

  ALTER TABLE renters
    ADD COLUMN IF NOT EXISTS contact_type TEXT NOT NULL DEFAULT 'unknown';
  ALTER TABLE renters
    ADD COLUMN IF NOT EXISTS contact_summary TEXT;
  ALTER TABLE renters
    ADD COLUMN IF NOT EXISTS relationship_status TEXT;
  ALTER TABLE renters
    ADD COLUMN IF NOT EXISTS classification_confidence DOUBLE PRECISION;
  ALTER TABLE renters
    ADD COLUMN IF NOT EXISTS classification_updated_at TIMESTAMPTZ;
  ALTER TABLE renters
    ADD COLUMN IF NOT EXISTS analysis_confidence DOUBLE PRECISION;
  ALTER TABLE renters
    ADD COLUMN IF NOT EXISTS analysis_notes TEXT;
  ALTER TABLE renters
    ADD COLUMN IF NOT EXISTS analysis_source TEXT;
  ALTER TABLE renters
    ADD COLUMN IF NOT EXISTS analysis_updated_at TIMESTAMPTZ;

  UPDATE renters
  SET contact_type = 'existing_tenant',
      updated_at = NOW()
  WHERE contact_type = 'unknown'
    AND labels ? 'Tenants';
  `;

  await pool.query(sql);
}

function phoneFromChatId(id) {
  const m = String(id || "").match(/^(\d+)@/);
  return m ? m[1] : null;
}

async function withDetachedFrameRetry(fn, retries = 2) {
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = String(err && (err.message || err));
      const transient =
        msg.includes("detached Frame") ||
        msg.includes("Execution context was destroyed") ||
        msg.includes("Target closed");

      if (!transient || attempt === retries) throw err;

      console.warn(
        `WhatsApp frame changed; retrying (${attempt + 1}/${retries})...`
      );
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  throw lastErr;
}

function normaliseLabels(labels = []) {
  return labels
    .map(x => String(x || "").trim().toLowerCase())
    .filter(Boolean);
}

function inferTypeFromLabels(labels = []) {
  const names = normaliseLabels(labels);

  if (TENANT_LABELS.some(x => names.includes(x.toLowerCase()))) {
    return "existing_tenant";
  }

  if (LANDLORD_LABELS.some(x => names.includes(x.toLowerCase()))) {
    return "landlord";
  }

  if (AGENT_LABELS.some(x => names.includes(x.toLowerCase()))) {
    return "agent";
  }

  if (PROSPECT_LABELS.some(x => names.includes(x.toLowerCase()))) {
    return "renter_prospect";
  }

  return "unknown";
}

function isCrmLabelled(labels = []) {
  const names = normaliseLabels(labels);
  const allowed = new Set(
    CRM_IMPORT_LABELS.map(x => x.toLowerCase())
  );
  return names.some(name => allowed.has(name));
}

async function upsertContact(chat, labels = [], suggestedType = "unknown") {
  const chatId = chat.id._serialized;

  let contact = null;
  try {
    contact = await withDetachedFrameRetry(
      () => chat.getContact(),
      1
    );
  } catch {}

  const displayName =
    chat.name ||
    (contact && (contact.pushname || contact.name)) ||
    null;

  const phone = phoneFromChatId(chatId);

  const { rows } = await pool.query(`
    INSERT INTO renters
      (whatsapp_chat_id, display_name, phone, labels, contact_type)
    VALUES ($1,$2,$3,$4::jsonb,$5)
    ON CONFLICT (whatsapp_chat_id) DO UPDATE SET
      display_name = COALESCE(EXCLUDED.display_name, renters.display_name),
      phone = COALESCE(EXCLUDED.phone, renters.phone),
      labels = EXCLUDED.labels,
      contact_type = CASE
        WHEN renters.classification_updated_at IS NOT NULL
          THEN renters.contact_type
        WHEN EXCLUDED.contact_type = 'unknown'
          THEN renters.contact_type
        ELSE EXCLUDED.contact_type
      END,
      updated_at = NOW()
    RETURNING id
  `, [
    chatId,
    displayName,
    phone,
    JSON.stringify(labels),
    suggestedType
  ]);

  return rows[0].id;
}

async function saveMessage(chatId, contactId, message) {
  const ts = message.timestamp
    ? new Date(message.timestamp * 1000)
    : new Date();

  const direction = message.fromMe ? "outbound" : "inbound";

  const serializedId =
    message.id && message.id._serialized
      ? message.id._serialized
      : `${chatId}:${message.timestamp}:${direction}`;

  const result = await pool.query(`
    INSERT INTO whatsapp_messages
      (whatsapp_message_id, whatsapp_chat_id, renter_id,
       direction, sender_name, body, message_type, message_at, raw)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
    ON CONFLICT (whatsapp_message_id) DO NOTHING
  `, [
    serializedId,
    chatId,
    contactId,
    direction,
    null,
    message.body || "",
    message.type || "unknown",
    ts,
    JSON.stringify({
      from: message.from,
      to: message.to,
      fromMe: message.fromMe,
      type: message.type,
      timestamp: message.timestamp
    })
  ]);

  return result.rowCount;
}

async function updateContactDates(contactId) {
  await pool.query(`
    UPDATE renters r SET
      first_enquiry_at = x.first_at,
      last_message_at = x.last_at,
      updated_at = NOW()
    FROM (
      SELECT renter_id,
             MIN(message_at) first_at,
             MAX(message_at) last_at
      FROM whatsapp_messages
      WHERE renter_id=$1
      GROUP BY renter_id
    ) x
    WHERE r.id=x.renter_id
  `, [contactId]);
}

function requireGptAuth(req, res, next) {
  if (!gptKey) {
    return res.status(503).json({
      ok: false,
      error: "Custom GPT bridge is not configured"
    });
  }

  const auth = String(req.headers.authorization || "");
  if (auth !== `Bearer ${gptKey}`) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized"
    });
  }

  next();
}

function nullableString(value, maxLength = 3000) {
  if (value === null || value === undefined || value === "") return null;
  return String(value).trim().slice(0, maxLength) || null;
}

function nullableInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function nullableBoolean(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function nullableDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const s = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function nullableConfidence(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function validContactType(value) {
  const allowed = new Set([
    "renter_prospect",
    "existing_tenant",
    "landlord",
    "agent",
    "other_rental_contact",
    "unrelated",
    "unknown"
  ]);
  const v = String(value || "unknown").trim().toLowerCase();
  return allowed.has(v) ? v : null;
}

function validRenterStatus(value) {
  const allowed = new Set([
    "active",
    "historical",
    "closed",
    "unknown",
    "not_prospect"
  ]);
  const v = String(value || "unknown").trim().toLowerCase();
  return allowed.has(v) ? v : null;
}

async function getContactMessages(contactId, limit = 500, offset = 0) {
  const totalResult = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM whatsapp_messages
    WHERE renter_id=$1
  `, [contactId]);

  const total = totalResult.rows[0].count;

  const messagesResult = await pool.query(`
    SELECT direction, body, message_type, message_at, id
    FROM whatsapp_messages
    WHERE renter_id=$1
    ORDER BY message_at ASC NULLS FIRST, id ASC
    LIMIT $2 OFFSET $3
  `, [contactId, limit, offset]);

  return {
    total,
    messages: messagesResult.rows,
    hasMore: offset + messagesResult.rows.length < total
  };
}

/* ---------------- GPT CRM API ---------------- */

app.get("/gpt/health", requireGptAuth, async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      ok: true,
      service: "zheungyuan-rental-crm",
      gptBridge: true,
      crmVersion: "2.3-batch-review"
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: String(err && (err.message || err))
    });
  }
});

app.get("/gpt/overview", requireGptAuth, async (req, res) => {
  try {
    const contacts = await pool.query(`
      SELECT
        COUNT(*)::int total,
        COUNT(*) FILTER (WHERE contact_type='renter_prospect')::int renters,
        COUNT(*) FILTER (WHERE contact_type='existing_tenant')::int tenants,
        COUNT(*) FILTER (WHERE contact_type='landlord')::int landlords,
        COUNT(*) FILTER (WHERE contact_type='agent')::int agents,
        COUNT(*) FILTER (WHERE classification_updated_at IS NULL)::int unreviewed,
        COUNT(*) FILTER (WHERE classification_updated_at IS NOT NULL)::int reviewed
      FROM renters
      WHERE contact_type <> 'unrelated'
    `);

    const messages = await pool.query(`
      SELECT COUNT(*)::int count FROM whatsapp_messages
    `);

    const properties = await pool.query(`
      SELECT
        COUNT(*)::int total,
        COUNT(*) FILTER (WHERE status='available')::int available
      FROM properties
    `);

    const matches = await pool.query(`
      SELECT COUNT(*)::int count FROM property_matches
    `);

    res.json({
      ok: true,
      contacts: contacts.rows[0],
      messages: messages.rows[0].count,
      properties: properties.rows[0],
      matches: matches.rows[0].count
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: String(err && (err.message || err))
    });
  }
});

app.get("/gpt/contacts", requireGptAuth, async (req, res) => {
  const limit = Math.max(
    1,
    Math.min(Number(req.query.limit || 100), 250)
  );

  const analysis = String(req.query.analysis || "all")
    .trim()
    .toLowerCase();

  const type = nullableString(req.query.type, 50);

  const where = [];
  const values = [];

  if (analysis === "unreviewed") {
    where.push("classification_updated_at IS NULL");
  } else if (analysis === "analysed" || analysis === "analyzed") {
    where.push("classification_updated_at IS NOT NULL");
  }

  if (type) {
    values.push(type);
    where.push(`contact_type=$${values.length}`);
  }

  values.push(limit);
  const limitPos = values.length;

  try {
    const { rows } = await pool.query(`
      SELECT
        r.id,
        r.display_name,
        r.phone,
        r.contact_type,
        r.contact_summary,
        r.relationship_status,
        r.status,
        r.first_enquiry_at,
        r.last_message_at,
        r.labels,
        r.classification_confidence,
        r.classification_updated_at,
        r.requirement_summary,
        r.area_wanted,
        r.budget_min,
        r.budget_max,
        r.preferred_floor,
        r.pets_required,
        r.parking_needed,
        r.analysis_updated_at,
        (
          SELECT COUNT(*)::int
          FROM whatsapp_messages wm
          WHERE wm.renter_id=r.id
        ) message_count
      FROM renters r
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY
        r.classification_updated_at ASC NULLS FIRST,
        r.last_message_at DESC NULLS LAST,
        r.id DESC
      LIMIT $${limitPos}
    `, values);

    res.json({
      ok: true,
      count: rows.length,
      analysis,
      contacts: rows
    });
  } catch (err) {
    console.error("GPT contacts list failed:", err);
    res.status(500).json({
      ok: false,
      error: String(err && (err.message || err))
    });
  }
});

app.get(
  "/gpt/contacts/:id/conversation",
  requireGptAuth,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({
        ok: false,
        error: "Invalid contact id"
      });
    }

    const limit = Math.max(
      20,
      Math.min(Number(req.query.limit || 500), 500)
    );
    const offset = Math.max(0, Number(req.query.offset || 0));

    try {
      const contactResult = await pool.query(`
        SELECT *
        FROM renters
        WHERE id=$1
      `, [id]);

      if (!contactResult.rows.length) {
        return res.status(404).json({
          ok: false,
          error: "Contact not found"
        });
      }

      const result = await getContactMessages(id, limit, offset);

      res.json({
        ok: true,
        contact: contactResult.rows[0],
        totalMessages: result.total,
        offset,
        returned: result.messages.length,
        hasMore: result.hasMore,
        nextOffset: result.hasMore
          ? offset + result.messages.length
          : null,
        messages: result.messages
      });
    } catch (err) {
      console.error("GPT contact conversation failed:", err);
      res.status(500).json({
        ok: false,
        error: String(err && (err.message || err))
      });
    }
  }
);

app.post(
  "/gpt/contacts/:id/analysis",
  requireGptAuth,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({
        ok: false,
        error: "Invalid contact id"
      });
    }

    const body = req.body || {};
    const contactType = validContactType(body.contact_type);

    if (!contactType) {
      return res.status(400).json({
        ok: false,
        error: "Invalid contact_type"
      });
    }

    const renterStatus = validRenterStatus(body.status || "unknown");
    if (!renterStatus) {
      return res.status(400).json({
        ok: false,
        error: "Invalid renter status"
      });
    }

    const data = {
      contact_summary: nullableString(body.contact_summary, 4000),
      relationship_status:
        nullableString(body.relationship_status, 200),
      classification_confidence:
        nullableConfidence(body.classification_confidence),

      area_wanted: nullableString(body.area_wanted, 500),
      budget_min: nullableInteger(body.budget_min),
      budget_max: nullableInteger(body.budget_max),
      bedrooms: nullableInteger(body.bedrooms),
      preferred_floor: nullableString(body.preferred_floor, 100),
      wants_garden: nullableBoolean(body.wants_garden),
      wants_rooftop: nullableBoolean(body.wants_rooftop),
      pets_required: nullableBoolean(body.pets_required),
      pet_details: nullableString(body.pet_details, 500),
      parking_needed: nullableBoolean(body.parking_needed),
      move_in_date: nullableDate(body.move_in_date),
      occupants: nullableString(body.occupants, 500),
      source_property: nullableString(body.source_property, 800),
      requirement_summary:
        nullableString(body.requirement_summary, 3000),
      status: renterStatus,
      analysis_confidence:
        nullableConfidence(body.analysis_confidence),
      analysis_notes: nullableString(body.analysis_notes, 3000)
    };

    if (
      data.budget_min != null &&
      data.budget_max != null &&
      data.budget_min > data.budget_max
    ) {
      return res.status(400).json({
        ok: false,
        error: "budget_min cannot exceed budget_max"
      });
    }

    try {
      const { rows } = await pool.query(`
        UPDATE renters SET
          contact_type=$2,
          contact_summary=$3,
          relationship_status=$4,
          classification_confidence=$5,
          classification_updated_at=NOW(),

          area_wanted=$6,
          budget_min=$7,
          budget_max=$8,
          bedrooms=$9,
          preferred_floor=$10,
          wants_garden=$11,
          wants_rooftop=$12,
          pets_required=$13,
          pet_details=$14,
          parking_needed=$15,
          move_in_date=$16,
          occupants=$17,
          source_property=$18,
          requirement_summary=$19,
          status=$20,
          analysis_confidence=$21,
          analysis_notes=$22,
          analysis_source='custom_gpt',
          analysis_updated_at=NOW(),
          updated_at=NOW()
        WHERE id=$1
        RETURNING *
      `, [
        id,
        contactType,
        data.contact_summary,
        data.relationship_status,
        data.classification_confidence,
        data.area_wanted,
        data.budget_min,
        data.budget_max,
        data.bedrooms,
        data.preferred_floor,
        data.wants_garden,
        data.wants_rooftop,
        data.pets_required,
        data.pet_details,
        data.parking_needed,
        data.move_in_date,
        data.occupants,
        data.source_property,
        data.requirement_summary,
        data.status,
        data.analysis_confidence,
        data.analysis_notes
      ]);

      if (!rows.length) {
        return res.status(404).json({
          ok: false,
          error: "Contact not found"
        });
      }

      res.json({
        ok: true,
        contact: rows[0]
      });
    } catch (err) {
      console.error("GPT contact analysis save failed:", err);
      res.status(500).json({
        ok: false,
        error: String(err && (err.message || err))
      });
    }
  }
);


/* ---------------- GPT BATCH REVIEW API ----------------
 *
 * The original per-contact workflow required 2+ Action calls per contact.
 * With ~400 imported contacts that can exceed a Custom GPT turn/tool budget
 * long before the CRM is fully classified. These endpoints intentionally
 * return many unreviewed contacts WITH their stored messages in one call and
 * save many analyses in one call.
 */

app.get("/gpt/review-batch", requireGptAuth, async (req, res) => {
  const limit = Math.max(
    1,
    Math.min(Number(req.query.limit || 50), 50)
  );

  try {
    const remainingResult = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM renters
      WHERE classification_updated_at IS NULL
    `);

    const contactsResult = await pool.query(`
      SELECT
        r.id,
        r.display_name,
        r.phone,
        r.contact_type,
        r.status,
        r.labels,
        r.first_enquiry_at,
        r.last_message_at,
        r.contact_summary,
        r.relationship_status,
        r.requirement_summary,
        r.area_wanted,
        r.budget_min,
        r.budget_max,
        r.bedrooms,
        r.preferred_floor,
        r.wants_garden,
        r.wants_rooftop,
        r.pets_required,
        r.pet_details,
        r.parking_needed,
        r.move_in_date,
        r.occupants,
        r.source_property,
        r.classification_confidence,
        r.analysis_confidence,
        r.analysis_notes,
        (
          SELECT COUNT(*)::int
          FROM whatsapp_messages wm
          WHERE wm.renter_id=r.id
        ) AS message_count
      FROM renters r
      WHERE r.classification_updated_at IS NULL
      ORDER BY
        r.last_message_at DESC NULLS LAST,
        r.id DESC
      LIMIT $1
    `, [limit]);

    const contacts = [];

    for (const contact of contactsResult.rows) {
      const messagesResult = await pool.query(`
        SELECT direction, body, message_type, message_at, id
        FROM whatsapp_messages
        WHERE renter_id=$1
        ORDER BY message_at ASC NULLS FIRST, id ASC
      `, [contact.id]);

      contacts.push({
        ...contact,
        messages: messagesResult.rows
      });
    }

    res.json({
      ok: true,
      count: contacts.length,
      remainingBefore: remainingResult.rows[0].count,
      contacts
    });
  } catch (err) {
    console.error("GPT review batch failed:", err);
    res.status(500).json({
      ok: false,
      error: String(err && (err.message || err))
    });
  }
});

app.post("/gpt/review-batch", requireGptAuth, async (req, res) => {
  const body = req.body || {};
  const analyses = Array.isArray(body.analyses)
    ? body.analyses
    : [];

  if (!analyses.length || analyses.length > 50) {
    return res.status(400).json({
      ok: false,
      error: "analyses must contain between 1 and 50 items"
    });
  }

  const seen = new Set();
  const prepared = [];

  for (let i = 0; i < analyses.length; i++) {
    const item = analyses[i] || {};
    const id = Number(item.id);

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({
        ok: false,
        error: `Invalid contact id at analyses[${i}]`
      });
    }

    if (seen.has(id)) {
      return res.status(400).json({
        ok: false,
        error: `Duplicate contact id ${id}`
      });
    }
    seen.add(id);

    const contactType = validContactType(item.contact_type);
    if (!contactType) {
      return res.status(400).json({
        ok: false,
        error: `Invalid contact_type for contact ${id}`
      });
    }

    const renterStatus = validRenterStatus(item.status || "unknown");
    if (!renterStatus) {
      return res.status(400).json({
        ok: false,
        error: `Invalid status for contact ${id}`
      });
    }

    const data = {
      id,
      contact_type: contactType,
      contact_summary: nullableString(item.contact_summary, 4000),
      relationship_status: nullableString(item.relationship_status, 200),
      classification_confidence: nullableConfidence(item.classification_confidence),
      area_wanted: nullableString(item.area_wanted, 500),
      budget_min: nullableInteger(item.budget_min),
      budget_max: nullableInteger(item.budget_max),
      bedrooms: nullableInteger(item.bedrooms),
      preferred_floor: nullableString(item.preferred_floor, 100),
      wants_garden: nullableBoolean(item.wants_garden),
      wants_rooftop: nullableBoolean(item.wants_rooftop),
      pets_required: nullableBoolean(item.pets_required),
      pet_details: nullableString(item.pet_details, 500),
      parking_needed: nullableBoolean(item.parking_needed),
      move_in_date: nullableDate(item.move_in_date),
      occupants: nullableString(item.occupants, 500),
      source_property: nullableString(item.source_property, 800),
      requirement_summary: nullableString(item.requirement_summary, 3000),
      status: renterStatus,
      analysis_confidence: nullableConfidence(item.analysis_confidence),
      analysis_notes: nullableString(item.analysis_notes, 3000)
    };

    if (
      data.budget_min != null &&
      data.budget_max != null &&
      data.budget_min > data.budget_max
    ) {
      return res.status(400).json({
        ok: false,
        error: `budget_min cannot exceed budget_max for contact ${id}`
      });
    }

    prepared.push(data);
  }

  const db = await pool.connect();

  try {
    await db.query("BEGIN");

    const saved = [];

    for (const data of prepared) {
      const { rows } = await db.query(`
        UPDATE renters SET
          contact_type=$2,
          contact_summary=COALESCE($3, contact_summary),
          relationship_status=COALESCE($4, relationship_status),
          classification_confidence=COALESCE($5, classification_confidence),
          classification_updated_at=NOW(),

          area_wanted=COALESCE($6, area_wanted),
          budget_min=COALESCE($7, budget_min),
          budget_max=COALESCE($8, budget_max),
          bedrooms=COALESCE($9, bedrooms),
          preferred_floor=COALESCE($10, preferred_floor),
          wants_garden=COALESCE($11, wants_garden),
          wants_rooftop=COALESCE($12, wants_rooftop),
          pets_required=COALESCE($13, pets_required),
          pet_details=COALESCE($14, pet_details),
          parking_needed=COALESCE($15, parking_needed),
          move_in_date=COALESCE($16, move_in_date),
          occupants=COALESCE($17, occupants),
          source_property=COALESCE($18, source_property),
          requirement_summary=COALESCE($19, requirement_summary),
          status=$20,
          analysis_confidence=COALESCE($21, analysis_confidence),
          analysis_notes=COALESCE($22, analysis_notes),
          analysis_source='custom_gpt_batch',
          analysis_updated_at=NOW(),
          updated_at=NOW()
        WHERE id=$1
          AND classification_updated_at IS NULL
        RETURNING id, contact_type, status
      `, [
        data.id,
        data.contact_type,
        data.contact_summary,
        data.relationship_status,
        data.classification_confidence,
        data.area_wanted,
        data.budget_min,
        data.budget_max,
        data.bedrooms,
        data.preferred_floor,
        data.wants_garden,
        data.wants_rooftop,
        data.pets_required,
        data.pet_details,
        data.parking_needed,
        data.move_in_date,
        data.occupants,
        data.source_property,
        data.requirement_summary,
        data.status,
        data.analysis_confidence,
        data.analysis_notes
      ]);

      if (!rows.length) {
        throw new Error(
          `Contact ${data.id} was not found or has already been reviewed`
        );
      }

      saved.push(rows[0]);
    }

    const remainingResult = await db.query(`
      SELECT COUNT(*)::int AS count
      FROM renters
      WHERE classification_updated_at IS NULL
    `);

    await db.query("COMMIT");

    res.json({
      ok: true,
      savedCount: saved.length,
      saved,
      remainingAfter: remainingResult.rows[0].count
    });
  } catch (err) {
    await db.query("ROLLBACK");
    console.error("GPT batch analysis save failed:", err);
    res.status(500).json({
      ok: false,
      error: String(err && (err.message || err))
    });
  } finally {
    db.release();
  }
});

/* Backwards-compatible prospect endpoints */

app.get("/gpt/prospects", requireGptAuth, async (req, res) => {
  const limit = Math.max(
    1,
    Math.min(Number(req.query.limit || 100), 250)
  );

  const analysis = String(req.query.analysis || "unreviewed")
    .trim()
    .toLowerCase();

  const status = nullableString(req.query.status, 40);

  const where = ["r.contact_type='renter_prospect'"];
  const values = [];

  if (analysis === "unreviewed") {
    where.push("r.analysis_updated_at IS NULL");
  } else if (analysis === "analysed" || analysis === "analyzed") {
    where.push("r.analysis_updated_at IS NOT NULL");
  }

  if (status) {
    values.push(status);
    where.push(`r.status=$${values.length}`);
  }

  values.push(limit);

  try {
    const { rows } = await pool.query(`
      SELECT
        r.*,
        (
          SELECT COUNT(*)::int
          FROM whatsapp_messages wm
          WHERE wm.renter_id=r.id
        ) message_count
      FROM renters r
      WHERE ${where.join(" AND ")}
      ORDER BY
        r.analysis_updated_at ASC NULLS FIRST,
        r.last_message_at DESC NULLS LAST,
        r.id DESC
      LIMIT $${values.length}
    `, values);

    res.json({
      ok: true,
      count: rows.length,
      analysis,
      prospects: rows
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: String(err && (err.message || err))
    });
  }
});

app.get(
  "/gpt/prospects/:id/conversation",
  requireGptAuth,
  async (req, res) => {
    const id = Number(req.params.id);
    const limit = Math.max(
      20,
      Math.min(Number(req.query.limit || 500), 500)
    );

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({
        ok: false,
        error: "Invalid prospect id"
      });
    }

    try {
      const prospectResult = await pool.query(`
        SELECT *
        FROM renters
        WHERE id=$1
          AND contact_type='renter_prospect'
      `, [id]);

      if (!prospectResult.rows.length) {
        return res.status(404).json({
          ok: false,
          error: "Prospect not found"
        });
      }

      const result = await getContactMessages(id, limit, 0);

      res.json({
        ok: true,
        prospect: prospectResult.rows[0],
        messageCount: result.messages.length,
        totalMessages: result.total,
        hasMore: result.hasMore,
        messages: result.messages
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: String(err && (err.message || err))
      });
    }
  }
);

app.post(
  "/gpt/prospects/:id/analysis",
  requireGptAuth,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({
        ok: false,
        error: "Invalid prospect id"
      });
    }

    const body = req.body || {};
    const status = validRenterStatus(body.status || "unknown");

    if (!status) {
      return res.status(400).json({
        ok: false,
        error: "Invalid status"
      });
    }

    const data = {
      area_wanted: nullableString(body.area_wanted, 500),
      budget_min: nullableInteger(body.budget_min),
      budget_max: nullableInteger(body.budget_max),
      bedrooms: nullableInteger(body.bedrooms),
      preferred_floor: nullableString(body.preferred_floor, 100),
      wants_garden: nullableBoolean(body.wants_garden),
      wants_rooftop: nullableBoolean(body.wants_rooftop),
      pets_required: nullableBoolean(body.pets_required),
      pet_details: nullableString(body.pet_details, 500),
      parking_needed: nullableBoolean(body.parking_needed),
      move_in_date: nullableDate(body.move_in_date),
      occupants: nullableString(body.occupants, 500),
      source_property: nullableString(body.source_property, 800),
      requirement_summary:
        nullableString(body.requirement_summary, 3000),
      status,
      analysis_confidence:
        nullableConfidence(body.analysis_confidence),
      analysis_notes: nullableString(body.analysis_notes, 3000)
    };

    try {
      const { rows } = await pool.query(`
        UPDATE renters SET
          area_wanted=$2,
          budget_min=$3,
          budget_max=$4,
          bedrooms=$5,
          preferred_floor=$6,
          wants_garden=$7,
          wants_rooftop=$8,
          pets_required=$9,
          pet_details=$10,
          parking_needed=$11,
          move_in_date=$12,
          occupants=$13,
          source_property=$14,
          requirement_summary=$15,
          status=$16,
          analysis_confidence=$17,
          analysis_notes=$18,
          analysis_source='custom_gpt',
          analysis_updated_at=NOW(),
          updated_at=NOW()
        WHERE id=$1
          AND contact_type='renter_prospect'
        RETURNING *
      `, [
        id,
        data.area_wanted,
        data.budget_min,
        data.budget_max,
        data.bedrooms,
        data.preferred_floor,
        data.wants_garden,
        data.wants_rooftop,
        data.pets_required,
        data.pet_details,
        data.parking_needed,
        data.move_in_date,
        data.occupants,
        data.source_property,
        data.requirement_summary,
        data.status,
        data.analysis_confidence,
        data.analysis_notes
      ]);

      if (!rows.length) {
        return res.status(404).json({
          ok: false,
          error: "Prospect not found"
        });
      }

      res.json({
        ok: true,
        prospect: rows[0]
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: String(err && (err.message || err))
      });
    }
  }
);

/* Property API */

app.get("/gpt/properties", requireGptAuth, async (req, res) => {
  const status = nullableString(req.query.status, 40);
  const contactId = nullableInteger(req.query.contact_id);
  const values = [];
  const where = [];

  if (status) {
    values.push(status);
    where.push(`p.status=$${values.length}`);
  }

  if (contactId) {
    values.push(contactId);
    where.push(
      `(p.owner_contact_id=$${values.length} OR p.source_contact_id=$${values.length})`
    );
  }

  try {
    const { rows } = await pool.query(`
      SELECT
        p.*,
        owner.display_name owner_name,
        source.display_name source_name
      FROM properties p
      LEFT JOIN renters owner ON owner.id=p.owner_contact_id
      LEFT JOIN renters source ON source.id=p.source_contact_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY p.updated_at DESC, p.id DESC
      LIMIT 250
    `, values);

    res.json({
      ok: true,
      count: rows.length,
      properties: rows
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: String(err && (err.message || err))
    });
  }
});

function propertyData(body = {}) {
  return {
    owner_contact_id: nullableInteger(body.owner_contact_id),
    source_contact_id: nullableInteger(body.source_contact_id),
    title: nullableString(body.title, 500),
    area: nullableString(body.area, 300),
    village: nullableString(body.village, 300),
    address_text: nullableString(body.address_text, 800),
    asking_rent: nullableInteger(body.asking_rent),
    floor: nullableString(body.floor, 100),
    bedrooms: nullableInteger(body.bedrooms),
    size_sqft: nullableInteger(body.size_sqft),
    has_garden: nullableBoolean(body.has_garden),
    has_rooftop: nullableBoolean(body.has_rooftop),
    pets_allowed: nullableBoolean(body.pets_allowed),
    parking_spaces: nullableInteger(body.parking_spaces),
    availability_text:
      nullableString(body.availability_text, 500),
    available_from: nullableDate(body.available_from),
    status: nullableString(body.status, 40) || "unknown",
    property_summary:
      nullableString(body.property_summary, 3000),
    source_notes: nullableString(body.source_notes, 3000),
    analysis_confidence:
      nullableConfidence(body.analysis_confidence)
  };
}

app.post("/gpt/properties", requireGptAuth, async (req, res) => {
  const d = propertyData(req.body || {});

  try {
    const { rows } = await pool.query(`
      INSERT INTO properties (
        owner_contact_id,
        source_contact_id,
        title,
        area,
        village,
        address_text,
        asking_rent,
        floor,
        bedrooms,
        size_sqft,
        has_garden,
        has_rooftop,
        pets_allowed,
        parking_spaces,
        availability_text,
        available_from,
        status,
        property_summary,
        source_notes,
        analysis_confidence,
        analysis_updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW()
      )
      RETURNING *
    `, [
      d.owner_contact_id,
      d.source_contact_id,
      d.title,
      d.area,
      d.village,
      d.address_text,
      d.asking_rent,
      d.floor,
      d.bedrooms,
      d.size_sqft,
      d.has_garden,
      d.has_rooftop,
      d.pets_allowed,
      d.parking_spaces,
      d.availability_text,
      d.available_from,
      d.status,
      d.property_summary,
      d.source_notes,
      d.analysis_confidence
    ]);

    res.json({
      ok: true,
      property: rows[0]
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: String(err && (err.message || err))
    });
  }
});

app.post(
  "/gpt/properties/:id",
  requireGptAuth,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({
        ok: false,
        error: "Invalid property id"
      });
    }

    const d = propertyData(req.body || {});

    try {
      const { rows } = await pool.query(`
        UPDATE properties SET
          owner_contact_id=$2,
          source_contact_id=$3,
          title=$4,
          area=$5,
          village=$6,
          address_text=$7,
          asking_rent=$8,
          floor=$9,
          bedrooms=$10,
          size_sqft=$11,
          has_garden=$12,
          has_rooftop=$13,
          pets_allowed=$14,
          parking_spaces=$15,
          availability_text=$16,
          available_from=$17,
          status=$18,
          property_summary=$19,
          source_notes=$20,
          analysis_confidence=$21,
          analysis_updated_at=NOW(),
          updated_at=NOW()
        WHERE id=$1
        RETURNING *
      `, [
        id,
        d.owner_contact_id,
        d.source_contact_id,
        d.title,
        d.area,
        d.village,
        d.address_text,
        d.asking_rent,
        d.floor,
        d.bedrooms,
        d.size_sqft,
        d.has_garden,
        d.has_rooftop,
        d.pets_allowed,
        d.parking_spaces,
        d.availability_text,
        d.available_from,
        d.status,
        d.property_summary,
        d.source_notes,
        d.analysis_confidence
      ]);

      if (!rows.length) {
        return res.status(404).json({
          ok: false,
          error: "Property not found"
        });
      }

      res.json({
        ok: true,
        property: rows[0]
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: String(err && (err.message || err))
      });
    }
  }
);

/* Match API */

app.get("/gpt/matches", requireGptAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        m.*,
        p.title property_title,
        p.area property_area,
        r.display_name renter_name,
        r.status renter_status,
        r.requirement_summary
      FROM property_matches m
      JOIN properties p ON p.id=m.property_id
      JOIN renters r ON r.id=m.renter_id
      ORDER BY m.match_score DESC, m.updated_at DESC
      LIMIT 500
    `);

    res.json({
      ok: true,
      count: rows.length,
      matches: rows
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: String(err && (err.message || err))
    });
  }
});

app.post("/gpt/matches", requireGptAuth, async (req, res) => {
  const body = req.body || {};
  const propertyId = nullableInteger(body.property_id);
  const renterId = nullableInteger(body.renter_id);

  if (!propertyId || !renterId) {
    return res.status(400).json({
      ok: false,
      error: "property_id and renter_id are required"
    });
  }

  const demandType =
    nullableString(body.demand_type, 40) || "historical";
  const score = clampScore(body.match_score);
  const reasons = nullableString(body.reasons, 3000);
  const status =
    nullableString(body.status, 40) || "suggested";

  try {
    const { rows } = await pool.query(`
      INSERT INTO property_matches (
        property_id,
        renter_id,
        demand_type,
        match_score,
        reasons,
        status
      )
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (property_id, renter_id) DO UPDATE SET
        demand_type=EXCLUDED.demand_type,
        match_score=EXCLUDED.match_score,
        reasons=EXCLUDED.reasons,
        status=EXCLUDED.status,
        updated_at=NOW()
      RETURNING *
    `, [
      propertyId,
      renterId,
      demandType,
      score,
      reasons,
      status
    ]);

    res.json({
      ok: true,
      match: rows[0]
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: String(err && (err.message || err))
    });
  }
});


/*
 * Full-account discovery import.
 * This intentionally scans EVERY direct (non-group) WhatsApp chat, including
 * unlabelled chats, so the GPT can classify old rental enquiries that were
 * never given a WhatsApp label.
 *
 * Existing message IDs are deduplicated by whatsapp_messages.whatsapp_message_id,
 * so this import is safe to rerun.
 */
async function runFullDiscoveryImport() {
  discoveryImportState = {
    running: true,
    startedAt: new Date().toISOString(),
    completedAt: null,
    chatsScanned: 0,
    directChatsFound: 0,
    contactsProcessed: 0,
    messagesRead: 0,
    newMessagesSaved: 0,
    currentContact: null,
    error: null
  };

  try {
    const allChats = await withDetachedFrameRetry(
      () => client.getChats()
    );

    const directChats = allChats
      .filter(chat => !chat.isGroup)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    discoveryImportState.directChatsFound = directChats.length;

    for (const chat of directChats) {
      discoveryImportState.chatsScanned++;

      const chatId =
        chat && chat.id && chat.id._serialized
          ? chat.id._serialized
          : "";

      discoveryImportState.currentContact =
        chat.name || phoneFromChatId(chatId) || chatId || "Unknown";

      try {
        let labelNames = [];

        try {
          const chatLabels = await withDetachedFrameRetry(
            () => client.getChatLabels(chatId),
            2
          );

          labelNames = chatLabels
            .map(label => label.name)
            .filter(Boolean);
        } catch (err) {
          console.warn(
            `Could not read labels for discovery chat ${chatId}:`,
            String(err && (err.message || err))
          );
        }

        const suggestedType = inferTypeFromLabels(labelNames);

        const contactId = await upsertContact(
          chat,
          labelNames,
          suggestedType
        );

        const messages = await withDetachedFrameRetry(
          () => chat.fetchMessages({ limit: Infinity }),
          2
        );

        discoveryImportState.messagesRead += messages.length;

        for (const message of messages) {
          discoveryImportState.newMessagesSaved += await saveMessage(
            chatId,
            contactId,
            message
          );
        }

        await updateContactDates(contactId);
        discoveryImportState.contactsProcessed++;
      } catch (err) {
        console.warn(
          `Could not discovery-import chat ${chatId}:`,
          String(err && (err.stack || err.message || err))
        );
      }

      await new Promise(resolve => setTimeout(resolve, 120));
    }

    discoveryImportState.running = false;
    discoveryImportState.currentContact = null;
    discoveryImportState.completedAt = new Date().toISOString();

    console.log(
      `Discovery import complete: ${discoveryImportState.contactsProcessed} contacts, ` +
      `${discoveryImportState.messagesRead} messages read, ` +
      `${discoveryImportState.newMessagesSaved} new messages saved`
    );
  } catch (err) {
    discoveryImportState.running = false;
    discoveryImportState.currentContact = null;
    discoveryImportState.completedAt = new Date().toISOString();
    discoveryImportState.error = String(
      err && (err.stack || err.message || err)
    );

    console.error(
      "Full direct-chat discovery import failed:",
      discoveryImportState.error
    );
  }
}

app.post("/sync/discovery/all", async (req, res) => {
  if (!waReady) {
    return res.status(409).json({
      ok: false,
      error: "WhatsApp not connected"
    });
  }

  if (
    syncState.running ||
    bulkImportState.running ||
    discoveryImportState.running
  ) {
    return res.status(409).json({
      ok: false,
      error: "A WhatsApp import is already running"
    });
  }

  runFullDiscoveryImport();

  return res.status(202).json({
    ok: true,
    started: true,
    message:
      "Full direct-chat discovery import started. Every non-group chat and its complete available message history will be imported for later GPT classification."
  });
});

app.get("/sync/discovery/all/status", (req, res) => {
  res.json({
    ok: true,
    ...discoveryImportState
  });
});



/*
 * Request WhatsApp peer history for every direct chat, then import every
 * message WhatsApp Web makes available. A second full fetch pass is performed
 * after all history requests have had time to settle.
 */
async function runFullHistorySync() {
  historySyncState = {
    running: true,
    phase: "request_and_import",
    startedAt: new Date().toISOString(),
    completedAt: null,
    directChatsFound: 0,
    chatsProcessed: 0,
    historyRequestsAttempted: 0,
    historyRequestsSucceeded: 0,
    historyRequestsUnavailable: 0,
    historyRequestErrors: 0,
    messagesRead: 0,
    newMessagesSaved: 0,
    secondPassMessagesRead: 0,
    secondPassNewMessagesSaved: 0,
    currentContact: null,
    error: null
  };

  try {
    const allChats = await withDetachedFrameRetry(
      () => client.getChats()
    );

    const directChats = allChats
      .filter(chat => !chat.isGroup)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    historySyncState.directChatsFound = directChats.length;

    for (const chat of directChats) {
      const chatId =
        chat && chat.id && chat.id._serialized
          ? chat.id._serialized
          : "";

      historySyncState.currentContact =
        chat.name || phoneFromChatId(chatId) || chatId || "Unknown";

      try {
        let labelNames = [];

        try {
          const chatLabels = await withDetachedFrameRetry(
            () => client.getChatLabels(chatId),
            2
          );

          labelNames = chatLabels
            .map(label => label.name)
            .filter(Boolean);
        } catch (err) {
          console.warn(
            `Could not read labels while syncing history for ${chatId}:`,
            String(err && (err.message || err))
          );
        }

        const contactId = await upsertContact(
          chat,
          labelNames,
          inferTypeFromLabels(labelNames)
        );

        historySyncState.historyRequestsAttempted++;

        let historyRequested = false;

        try {
          historyRequested = await withDetachedFrameRetry(
            () => client.syncHistory(chatId),
            2
          );

          if (historyRequested) {
            historySyncState.historyRequestsSucceeded++;
          } else {
            historySyncState.historyRequestsUnavailable++;
          }
        } catch (err) {
          historySyncState.historyRequestErrors++;
          console.warn(
            `History request failed for ${chatId}:`,
            String(err && (err.stack || err.message || err))
          );
        }

        // Give successful peer-history requests a short opportunity to begin
        // delivering messages before the first fetch. The second pass below
        // catches slower transfers.
        await new Promise(resolve =>
          setTimeout(resolve, historyRequested ? 1500 : 150)
        );

        const messages = await withDetachedFrameRetry(
          () => chat.fetchMessages({ limit: Infinity }),
          2
        );

        historySyncState.messagesRead += messages.length;

        for (const message of messages) {
          historySyncState.newMessagesSaved += await saveMessage(
            chatId,
            contactId,
            message
          );
        }

        await updateContactDates(contactId);
      } catch (err) {
        console.warn(
          `Could not history-sync/import chat ${chatId}:`,
          String(err && (err.stack || err.message || err))
        );
      }

      historySyncState.chatsProcessed++;
      await new Promise(resolve => setTimeout(resolve, 120));
    }

    // Some peer-history transfers arrive well after syncHistory() resolves.
    // Wait briefly, then refetch every direct chat once more.
    historySyncState.phase = "second_fetch";
    historySyncState.currentContact = "Waiting for history transfers";
    await new Promise(resolve => setTimeout(resolve, 15000));

    for (const chat of directChats) {
      const chatId =
        chat && chat.id && chat.id._serialized
          ? chat.id._serialized
          : "";

      historySyncState.currentContact =
        chat.name || phoneFromChatId(chatId) || chatId || "Unknown";

      try {
        const { rows } = await pool.query(
          `SELECT id FROM renters WHERE whatsapp_chat_id=$1`,
          [chatId]
        );

        if (!rows.length) continue;
        const contactId = rows[0].id;

        const messages = await withDetachedFrameRetry(
          () => chat.fetchMessages({ limit: Infinity }),
          2
        );

        historySyncState.secondPassMessagesRead += messages.length;

        for (const message of messages) {
          historySyncState.secondPassNewMessagesSaved += await saveMessage(
            chatId,
            contactId,
            message
          );
        }

        await updateContactDates(contactId);
      } catch (err) {
        console.warn(
          `Second history fetch failed for ${chatId}:`,
          String(err && (err.stack || err.message || err))
        );
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    historySyncState.running = false;
    historySyncState.phase = "complete";
    historySyncState.currentContact = null;
    historySyncState.completedAt = new Date().toISOString();

    console.log(
      `Full history sync complete: ${historySyncState.chatsProcessed}/${historySyncState.directChatsFound} chats; ` +
      `${historySyncState.historyRequestsSucceeded} history requests accepted; ` +
      `${historySyncState.newMessagesSaved + historySyncState.secondPassNewMessagesSaved} new messages saved`
    );
  } catch (err) {
    historySyncState.running = false;
    historySyncState.phase = "failed";
    historySyncState.currentContact = null;
    historySyncState.completedAt = new Date().toISOString();
    historySyncState.error = String(
      err && (err.stack || err.message || err)
    );

    console.error("Full history sync failed:", historySyncState.error);
  }
}

app.post("/sync/history/all", async (req, res) => {
  if (!waReady) {
    return res.status(409).json({
      ok: false,
      error: "WhatsApp not connected"
    });
  }

  if (
    syncState.running ||
    bulkImportState.running ||
    discoveryImportState.running ||
    historySyncState.running
  ) {
    return res.status(409).json({
      ok: false,
      error: "A WhatsApp import or history sync is already running"
    });
  }

  runFullHistorySync();

  return res.status(202).json({
    ok: true,
    started: true,
    message:
      "Full WhatsApp peer-history sync started for every direct chat. History will be requested, imported, then fetched again in a second pass."
  });
});

app.get("/sync/history/all/status", (req, res) => {
  res.json({
    ok: true,
    ...historySyncState,
    totalNewMessagesSaved:
      historySyncState.newMessagesSaved +
      historySyncState.secondPassNewMessagesSaved
  });
});


/* ---------------- WhatsApp import ---------------- */

async function findChatsByLabels({
  labels = CRM_IMPORT_LABELS,
  limitChats = Infinity,
  scanLimit = Infinity
} = {}) {
  const wanted = new Set(
    labels.map(x => String(x).trim().toLowerCase())
  );

  const allChats = await withDetachedFrameRetry(
    () => client.getChats()
  );

  const directChats = allChats
    .filter(chat => !chat.isGroup)
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  const selected = [];
  let chatsScanned = 0;

  const chatsToScan = Number.isFinite(scanLimit)
    ? directChats.slice(0, scanLimit)
    : directChats;

  for (const chat of chatsToScan) {
    chatsScanned++;

    try {
      const chatLabels = await withDetachedFrameRetry(
        () => client.getChatLabels(chat.id._serialized),
        2
      );

      const labelNames = chatLabels
        .map(label => label.name)
        .filter(Boolean);

      const names = normaliseLabels(labelNames);
      const isMatch = names.some(name => wanted.has(name));

      if (!isMatch) continue;

      selected.push({
        chat,
        labels: labelNames,
        suggestedType: inferTypeFromLabels(labelNames)
      });

      if (
        Number.isFinite(limitChats) &&
        selected.length >= limitChats
      ) {
        break;
      }
    } catch (err) {
      console.warn(
        `Could not read labels for ${
          chat.id && chat.id._serialized
        }:`,
        String(err && (err.message || err))
      );
    }

    await new Promise(resolve => setTimeout(resolve, 60));
  }

  return {
    chatsScanned,
    selected
  };
}

function previewContact(chat, labels, suggestedType) {
  const chatId =
    chat && chat.id && chat.id._serialized
      ? chat.id._serialized
      : "";

  return {
    name: chat.name || null,
    phone: phoneFromChatId(chatId),
    labels,
    suggestedType,
    lastMessageAt: chat.timestamp
      ? new Date(chat.timestamp * 1000).toISOString()
      : null
  };
}

app.get("/crm/preview", async (req, res) => {
  if (!waReady) {
    return res.status(409).json({
      ok: false,
      error: "WhatsApp not connected"
    });
  }

  try {
    const result = await findChatsByLabels({
      limitChats: 100,
      scanLimit: 2000
    });

    res.json({
      ok: true,
      labels: CRM_IMPORT_LABELS,
      chatsScanned: result.chatsScanned,
      contactsFound: result.selected.length,
      contacts: result.selected.map(
        ({ chat, labels, suggestedType }) =>
          previewContact(chat, labels, suggestedType)
      )
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: String(err && (err.message || err))
    });
  }
});

async function runFullCrmImport() {
  bulkImportState = {
    running: true,
    mode: "full_crm",
    startedAt: new Date().toISOString(),
    completedAt: null,
    chatsScanned: 0,
    matchingChatsFound: 0,
    contactsProcessed: 0,
    messagesRead: 0,
    newMessagesSaved: 0,
    currentContact: null,
    error: null
  };

  try {
    const result = await findChatsByLabels({
      limitChats: Infinity,
      scanLimit: Infinity
    });

    bulkImportState.chatsScanned = result.chatsScanned;
    bulkImportState.matchingChatsFound = result.selected.length;

    for (const item of result.selected) {
      const { chat, labels, suggestedType } = item;
      const chatId = chat.id._serialized;

      bulkImportState.currentContact =
        chat.name ||
        phoneFromChatId(chatId) ||
        chatId ||
        "Unknown";

      try {
        const contactId = await upsertContact(
          chat,
          labels,
          suggestedType
        );

        const messages = await withDetachedFrameRetry(
          () => chat.fetchMessages({ limit: Infinity }),
          2
        );

        bulkImportState.messagesRead += messages.length;

        for (const message of messages) {
          bulkImportState.newMessagesSaved += await saveMessage(
            chatId,
            contactId,
            message
          );
        }

        await updateContactDates(contactId);
        bulkImportState.contactsProcessed++;
      } catch (err) {
        console.warn(
          `Could not fully import contact ${chatId}:`,
          String(err && (err.stack || err.message || err))
        );
      }

      await new Promise(resolve => setTimeout(resolve, 120));
    }

    bulkImportState.running = false;
    bulkImportState.currentContact = null;
    bulkImportState.completedAt = new Date().toISOString();
  } catch (err) {
    bulkImportState.running = false;
    bulkImportState.currentContact = null;
    bulkImportState.completedAt = new Date().toISOString();
    bulkImportState.error = String(
      err && (err.stack || err.message || err)
    );
    console.error("Full CRM import failed:", bulkImportState.error);
  }
}

app.post("/sync/crm/all", async (req, res) => {
  if (!waReady) {
    return res.status(409).json({
      ok: false,
      error: "WhatsApp not connected"
    });
  }

  if (syncState.running || bulkImportState.running || discoveryImportState.running || historySyncState.running) {
    return res.status(409).json({
      ok: false,
      error: "A WhatsApp import is already running"
    });
  }

  runFullCrmImport();

  res.status(202).json({
    ok: true,
    started: true,
    labels: CRM_IMPORT_LABELS,
    message:
      "Full rental CRM import started in the background."
  });
});

app.get("/sync/crm/all/status", (req, res) => {
  res.json({
    ok: true,
    ...bulkImportState
  });
});

/* Existing prospect import retained */

async function findProspectChats({
  limitChats = 20,
  scanLimit = 1000
} = {}) {
  const result = await findChatsByLabels({
    labels: PROSPECT_LABELS,
    limitChats,
    scanLimit
  });

  result.selected = result.selected.filter(item => {
    const names = normaliseLabels(item.labels);
    return !names.includes("tenants");
  });

  return {
    chatsScanned: result.chatsScanned,
    skippedExistingTenants: 0,
    selected: result.selected
  };
}

app.get("/prospects/preview", async (req, res) => {
  if (!waReady) {
    return res.status(409).json({
      ok: false,
      error: "WhatsApp not connected"
    });
  }

  const limitChats = Math.max(
    1,
    Math.min(Number(req.query.limit || 20), 50)
  );
  const scanLimit = Math.max(
    limitChats,
    Math.min(Number(req.query.scanLimit || 1000), 2000)
  );

  try {
    const result = await findProspectChats({
      limitChats,
      scanLimit
    });

    res.json({
      ok: true,
      labels: PROSPECT_LABELS,
      chatsScanned: result.chatsScanned,
      prospectsFound: result.selected.length,
      prospects: result.selected.map(
        ({ chat, labels, suggestedType }) =>
          previewContact(chat, labels, suggestedType)
      )
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: String(err && (err.message || err))
    });
  }
});

app.post("/sync/prospects", async (req, res) => {
  if (!waReady) {
    return res.status(409).json({
      ok: false,
      error: "WhatsApp not connected"
    });
  }

  if (syncState.running || bulkImportState.running || discoveryImportState.running || historySyncState.running) {
    return res.status(409).json({
      ok: false,
      error: "Sync already running"
    });
  }

  const body = req.body || {};
  const limitChats = Math.max(
    1,
    Math.min(Number(body.limitChats || 20), 50)
  );
  const messagesPerChat = Math.max(
    20,
    Math.min(Number(body.messagesPerChat || 150), 500)
  );
  const scanLimit = Math.max(
    limitChats,
    Math.min(Number(body.scanLimit || 1000), 2000)
  );

  syncState.running = true;
  let chatsSeen = 0;
  let messagesSaved = 0;

  try {
    const result = await findProspectChats({
      limitChats,
      scanLimit
    });

    for (const { chat, labels } of result.selected) {
      try {
        const contactId = await upsertContact(
          chat,
          labels,
          "renter_prospect"
        );

        const messages = await withDetachedFrameRetry(
          () => chat.fetchMessages({ limit: messagesPerChat }),
          2
        );

        for (const message of messages) {
          messagesSaved += await saveMessage(
            chat.id._serialized,
            contactId,
            message
          );
        }

        await updateContactDates(contactId);
        chatsSeen++;
      } catch (err) {
        console.warn("Could not import prospect:", err);
      }
    }

    syncState = {
      running: false,
      lastSync: new Date().toISOString(),
      chatsSeen,
      messagesSaved
    };

    res.json({
      ok: true,
      chatsScanned: result.chatsScanned,
      matchingProspectsFound: result.selected.length,
      ...syncState
    });
  } catch (err) {
    syncState.running = false;
    res.status(500).json({
      ok: false,
      error: String(err && (err.message || err))
    });
  }
});

async function runFullProspectImport() {
  bulkImportState = {
    running: true,
    mode: "prospects",
    startedAt: new Date().toISOString(),
    completedAt: null,
    chatsScanned: 0,
    matchingChatsFound: 0,
    contactsProcessed: 0,
    messagesRead: 0,
    newMessagesSaved: 0,
    currentContact: null,
    error: null
  };

  try {
    const result = await findProspectChats({
      limitChats: Infinity,
      scanLimit: Infinity
    });

    bulkImportState.chatsScanned = result.chatsScanned;
    bulkImportState.matchingChatsFound = result.selected.length;

    for (const { chat, labels } of result.selected) {
      const chatId = chat.id._serialized;
      bulkImportState.currentContact =
        chat.name || phoneFromChatId(chatId) || "Unknown";

      try {
        const contactId = await upsertContact(
          chat,
          labels,
          "renter_prospect"
        );

        const messages = await withDetachedFrameRetry(
          () => chat.fetchMessages({ limit: Infinity }),
          2
        );

        bulkImportState.messagesRead += messages.length;

        for (const message of messages) {
          bulkImportState.newMessagesSaved += await saveMessage(
            chatId,
            contactId,
            message
          );
        }

        await updateContactDates(contactId);
        bulkImportState.contactsProcessed++;
      } catch (err) {
        console.warn("Could not fully import prospect:", err);
      }
    }

    bulkImportState.running = false;
    bulkImportState.currentContact = null;
    bulkImportState.completedAt = new Date().toISOString();
  } catch (err) {
    bulkImportState.running = false;
    bulkImportState.error = String(
      err && (err.stack || err.message || err)
    );
  }
}

app.post("/sync/prospects/all", async (req, res) => {
  if (!waReady) {
    return res.status(409).json({
      ok: false,
      error: "WhatsApp not connected"
    });
  }

  if (syncState.running || bulkImportState.running || discoveryImportState.running || historySyncState.running) {
    return res.status(409).json({
      ok: false,
      error: "A WhatsApp import is already running"
    });
  }

  runFullProspectImport();

  res.status(202).json({
    ok: true,
    started: true
  });
});

app.get("/sync/prospects/all/status", (req, res) => {
  res.json({
    ok: true,
    ...bulkImportState
  });
});

/* ---------------- Reader UI ---------------- */

app.get("/", (req, res) => {
  const labelText = CRM_IMPORT_LABELS.join(", ");

  res.type("html").send(`
  <html>
    <head>
      <meta name="viewport" content="width=device-width">
      <style>
        body{
          font-family:Arial;
          background:#f2eee3;
          color:#172922;
          padding:38px;
          max-width:960px;
          margin:auto
        }
        h1{
          font-family:Georgia,serif;
          font-weight:400;
          font-size:44px
        }
        .tag{
          color:#ba9251;
          text-transform:uppercase;
          letter-spacing:.12em;
          font-size:12px
        }
        .box{
          background:#fff;
          padding:24px;
          border:1px solid #d8d1c4;
          margin:18px 0
        }
        a{color:#15342c}
        button{
          background:#17372e;
          color:white;
          border:0;
          padding:13px 20px;
          font-size:15px;
          cursor:pointer
        }
        button:disabled{opacity:.5;cursor:not-allowed}
        pre{
          white-space:pre-wrap;
          background:#f7f4ee;
          padding:14px;
          border:1px solid #ddd5c8;
          max-height:420px;
          overflow:auto
        }
        .warn{
          background:#fff8e8;
          border:1px solid #e6d19b;
          padding:13px;
          line-height:1.5
        }
      </style>
    </head>
    <body>
      <div class="tag">張園 / Zheungyuan</div>
      <h1>WhatsApp rental CRM reader</h1>

      <div class="box">
        WhatsApp:
        <b>${waReady ? "Connected" : "Waiting for WhatsApp"}</b>
        <br><br>
        Custom GPT:
        <b>${gptKey ? "Configured" : "READER_GPT_KEY not set"}</b>
      </div>

      <div class="box">
        <a href="/qr">QR pairing</a> ·
        <a href="/status">Status JSON</a> ·
        <a href="/labels">WhatsApp labels</a> ·
        <a href="/crm/preview">Preview rental CRM chats</a>
      </div>

      <div class="box">
        <h3>Sync ALL WhatsApp history</h3>
        <p>
          Requests peer-history transfer for every direct chat and then imports
          every message WhatsApp Web makes available. A second import pass runs
          automatically after the history requests.
        </p>

        <div class="warn">
          This uses the unofficial WhatsApp Web client for all 399 direct chats.
          WhatsApp may not make older history available for every chat; the
          status below reports how many history requests were accepted and how
          many genuinely new messages were recovered.
        </div>

        <div style="margin-top:18px">
          <button
            id="historyBtn"
            onclick="startHistorySync()"
            ${waReady ? "" : "disabled"}
          >
            Sync ALL chat history + import ALL messages
          </button>
        </div>

        <pre id="historyResult">Full history sync has not been started.</pre>
      </div>

      <div class="box">
        <h3>Discover ALL direct chats</h3>
        <p>
          Your historical renter enquiries were not all labelled in WhatsApp.
          This scans <b>every non-group chat</b>, imports its complete available
          message history, and leaves unlabelled contacts as <b>unknown</b> so
          the private GPT can classify them.
        </p>

        <div class="warn">
          This is broader than the labelled CRM import and can include personal
          one-to-one chats. Use it only because you want the GPT to discover old
          rental enquiries that were never labelled. The GPT should classify
          unrelated contacts as <b>unrelated</b>.
        </div>

        <div style="margin-top:18px">
          <button
            id="discoveryBtn"
            onclick="startDiscoveryImport()"
            ${waReady ? "" : "disabled"}
          >
            Import ALL direct chats + ALL messages
          </button>
        </div>

        <pre id="discoveryResult">Discovery import has not been started.</pre>
      </div>

      <div class="box">
        <h3>Full rental CRM import</h3>
        <p>
          Imports the complete available message history from chats carrying
          recognised rental labels.
        </p>
        <p><b>Current included labels:</b> ${labelText}</p>

        <div class="warn">
          Private/unlabelled chats are deliberately not imported. To include a
          landlord chat that is currently unlabelled, apply a
          <b>Landlords</b> label in WhatsApp (or add its label name to the
          Railway variable <b>CRM_EXTRA_LABELS</b>) and rerun this import.
        </div>

        <div style="margin-top:18px">
          <button
            id="crmBtn"
            onclick="startCrmImport()"
            ${waReady ? "" : "disabled"}
          >
            Import ALL rental CRM chats + ALL messages
          </button>
        </div>

        <pre id="crmResult">Full CRM import has not been started.</pre>
      </div>

      <script>
        let timer = null;

        async function refreshCrmStatus() {
          const result = document.getElementById("crmResult");
          const btn = document.getElementById("crmBtn");

          try {
            const response = await fetch("/sync/crm/all/status");
            const data = await response.json();
            result.textContent = JSON.stringify(data, null, 2);

            if (data.running) {
              btn.disabled = true;
              if (!timer) {
                timer = setInterval(refreshCrmStatus, 3000);
              }
            } else {
              btn.disabled = false;
              if (timer) {
                clearInterval(timer);
                timer = null;
              }
            }
          } catch (err) {
            result.textContent = "Status error: " + err.message;
          }
        }

        async function startCrmImport() {
          const ok = window.confirm(
            "Import every recognised rental CRM chat and its complete available WhatsApp history?"
          );
          if (!ok) return;

          document.getElementById("crmBtn").disabled = true;

          const response = await fetch("/sync/crm/all", {
            method: "POST",
            headers: {"Content-Type":"application/json"}
          });

          const data = await response.json();
          document.getElementById("crmResult").textContent =
            JSON.stringify(data, null, 2);

          await refreshCrmStatus();
        }



        let historyTimer = null;

        async function refreshHistoryStatus() {
          const result = document.getElementById("historyResult");
          const btn = document.getElementById("historyBtn");

          try {
            const response = await fetch("/sync/history/all/status");
            const data = await response.json();
            result.textContent = JSON.stringify(data, null, 2);

            if (data.running) {
              btn.disabled = true;
              if (!historyTimer) {
                historyTimer = setInterval(
                  refreshHistoryStatus,
                  3000
                );
              }
            } else {
              btn.disabled = false;
              if (historyTimer) {
                clearInterval(historyTimer);
                historyTimer = null;
              }
            }
          } catch (err) {
            result.textContent =
              "History sync status error: " + err.message;
          }
        }

        async function startHistorySync() {
          const ok = window.confirm(
            "Request WhatsApp history sync for EVERY direct chat, then import every available message? This may take several minutes."
          );
          if (!ok) return;

          document.getElementById("historyBtn").disabled = true;

          const response = await fetch("/sync/history/all", {
            method: "POST",
            headers: {"Content-Type":"application/json"}
          });

          const data = await response.json();
          document.getElementById("historyResult").textContent =
            JSON.stringify(data, null, 2);

          await refreshHistoryStatus();
        }

        refreshHistoryStatus();

        let discoveryTimer = null;

        async function refreshDiscoveryStatus() {
          const result = document.getElementById("discoveryResult");
          const btn = document.getElementById("discoveryBtn");

          try {
            const response = await fetch("/sync/discovery/all/status");
            const data = await response.json();
            result.textContent = JSON.stringify(data, null, 2);

            if (data.running) {
              btn.disabled = true;
              if (!discoveryTimer) {
                discoveryTimer = setInterval(
                  refreshDiscoveryStatus,
                  3000
                );
              }
            } else {
              btn.disabled = false;
              if (discoveryTimer) {
                clearInterval(discoveryTimer);
                discoveryTimer = null;
              }
            }
          } catch (err) {
            result.textContent =
              "Discovery status error: " + err.message;
          }
        }

        async function startDiscoveryImport() {
          const ok = window.confirm(
            "This will import EVERY direct non-group WhatsApp chat and its complete available history, including unlabelled/personal chats, so GPT can find historical rental enquiries. Continue?"
          );
          if (!ok) return;

          document.getElementById("discoveryBtn").disabled = true;

          const response = await fetch("/sync/discovery/all", {
            method: "POST",
            headers: {"Content-Type":"application/json"}
          });

          const data = await response.json();
          document.getElementById("discoveryResult").textContent =
            JSON.stringify(data, null, 2);

          await refreshDiscoveryStatus();
        }

        refreshDiscoveryStatus();

        refreshCrmStatus();
      </script>
    </body>
  </html>`);
});

app.get("/qr", (req, res) => {
  if (waReady) {
    return res.type("html").send(
      "<h2>WhatsApp is connected.</h2><p><a href='/'>Back</a></p>"
    );
  }

  if (!qrDataUrl) {
    return res.type("html").send(
      "<h2>Waiting for QR…</h2><meta http-equiv='refresh' content='3'>"
    );
  }

  res.type("html").send(`
    <h2>Scan with WhatsApp</h2>
    <img src="${qrDataUrl}" width="320">
    <meta http-equiv="refresh" content="20">
  `);
});

app.get("/status", (req, res) => {
  res.json({
    ok: true,
    waReady,
    sync: syncState,
    bulkImport: bulkImportState,
    discoveryImport: discoveryImportState,
    historySync: historySyncState,
    crmImportLabels: CRM_IMPORT_LABELS
  });
});

app.get("/labels", async (req, res) => {
  if (!waReady) {
    return res.status(409).json({
      ok: false,
      error: "WhatsApp not connected"
    });
  }

  try {
    const labelObjects = await withDetachedFrameRetry(
      () => client.getLabels()
    );

    const labels = labelObjects
      .map(label => ({
        id: label.id,
        name: label.name || "(unnamed)"
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      ok: true,
      labels,
      crmImportLabels: CRM_IMPORT_LABELS
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: String(err && (err.message || err))
    });
  }
});

const port =
  process.env.PORT ||
  process.env.READER_PORT ||
  3001;

ensureSchema()
  .then(() => client.initialize())
  .then(() =>
    app.listen(
      port,
      "0.0.0.0",
      () => console.log(`Reader listening on ${port}`)
    )
  )
  .catch(err => {
    console.error("Startup failed:", err);
    process.exit(1);
  });
