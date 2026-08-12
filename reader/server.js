const express = require("express");
const QRCode = require("qrcode");
const pg = require("pg");
const fs = require("fs");
const path = require("path");
const { Client, LocalAuth } = require("whatsapp-web.js");

const app = express();
app.use(express.json({ limit: "3mb" }));

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined
});

let qrDataUrl = null;
let waReady = false;
let syncState = {
  running: false,
  lastSync: null,
  chatsSeen: 0,
  messagesSaved: 0
};

const authPath = process.env.WA_AUTH_PATH || "./.wwebjs_auth";
const clientId = process.env.WA_CLIENT_ID || "zheungyuan-rentals";

function clearStaleChromiumLocks() {
  const lockNames = new Set(["SingletonLock", "SingletonSocket", "SingletonCookie"]);
  const roots = [authPath, path.join(authPath, `session-${clientId}`)];

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
            console.warn(`Could not remove stale Chromium lock ${target}:`, err.message);
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
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  }
});

client.on("qr", async qr => {
  qrDataUrl = await QRCode.toDataURL(qr);
  waReady = false;
  console.log("WhatsApp QR generated");
});

client.on("authenticated", () => console.log("WhatsApp authenticated"));

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
  );`;

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

      console.warn(`WhatsApp frame changed; retrying (${attempt + 1}/${retries})...`);
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  throw lastErr;
}

async function upsertRenter(chat, labels = []) {
  const id = chat.id._serialized;

  let contact = null;
  try {
    contact = await withDetachedFrameRetry(() => chat.getContact(), 1);
  } catch {}

  const displayName =
    chat.name ||
    (contact && (contact.pushname || contact.name)) ||
    null;

  const phone = phoneFromChatId(id);

  const { rows } = await pool.query(`
    INSERT INTO renters (whatsapp_chat_id, display_name, phone, labels)
    VALUES ($1,$2,$3,$4::jsonb)
    ON CONFLICT (whatsapp_chat_id) DO UPDATE SET
      display_name = COALESCE(EXCLUDED.display_name, renters.display_name),
      phone = COALESCE(EXCLUDED.phone, renters.phone),
      labels = EXCLUDED.labels,
      updated_at = NOW()
    RETURNING id
  `, [id, displayName, phone, JSON.stringify(labels)]);

  return rows[0].id;
}

async function saveMessage(chatId, renterId, message) {
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
      (whatsapp_message_id, whatsapp_chat_id, renter_id, direction,
       sender_name, body, message_type, message_at, raw)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
    ON CONFLICT (whatsapp_message_id) DO NOTHING
  `, [
    serializedId,
    chatId,
    renterId,
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

async function updateRenterDates(renterId) {
  await pool.query(`
    UPDATE renters r SET
      first_enquiry_at = x.first_at,
      last_message_at = x.last_at,
      updated_at = NOW()
    FROM (
      SELECT renter_id, MIN(message_at) first_at, MAX(message_at) last_at
      FROM whatsapp_messages
      WHERE renter_id=$1
      GROUP BY renter_id
    ) x
    WHERE r.id=x.renter_id
  `, [renterId]);
}

app.get("/", (req, res) => {
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
          max-width:900px;
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
        input{
          padding:10px;
          border:1px solid #cfc8bc;
          width:90px
        }
        label{display:inline-block;margin-right:18px}
        pre{
          white-space:pre-wrap;
          background:#f7f4ee;
          padding:14px;
          border:1px solid #ddd5c8
        }
      </style>
    </head>
    <body>
      <div class="tag">張園 / Zheungyuan</div>
      <h1>WhatsApp rental reader</h1>

      <div class="box">
        Status: <b>${waReady ? "Connected" : "Waiting for WhatsApp"}</b>
      </div>

      <div class="box">
        <a href="/qr">Open QR pairing</a><br><br>
        <a href="/status">Status JSON</a><br><br>
        <a href="/labels">Preview WhatsApp labels</a>
      </div>

      <div class="box">
        <h3>Import renter enquiries</h3>
        <p>
          Scans recent WhatsApp chats and imports only conversations carrying
          the <b>Tenants</b> label.
        </p>

        <label>
          Matching chats
          <input id="limitChats" type="number" min="1" max="250" value="20">
        </label>

        <label>
          Messages per chat
          <input id="messagesPerChat" type="number" min="10" max="500" value="150">
        </label>

        <div style="margin-top:18px">
          <button id="syncBtn" onclick="runSync()" ${waReady ? "" : "disabled"}>
            Sync Tenants
          </button>
        </div>

        <pre id="result">No sync run yet.</pre>
      </div>

      <script>
        async function runSync() {
          const btn = document.getElementById("syncBtn");
          const result = document.getElementById("result");

          const limitChats =
            Number(document.getElementById("limitChats").value || 20);

          const messagesPerChat =
            Number(document.getElementById("messagesPerChat").value || 150);

          btn.disabled = true;
          result.textContent = "Scanning WhatsApp for Tenants-labelled chats…";

          try {
            const response = await fetch("/sync/chats", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                label: "Tenants",
                limitChats,
                messagesPerChat,
                scanLimit: 250
              })
            });

            const data = await response.json();
            result.textContent = JSON.stringify(data, null, 2);
          } catch (err) {
            result.textContent = "Error: " + err.message;
          } finally {
            btn.disabled = false;
          }
        }
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
    <p>This QR refreshes automatically if required.</p>
    <meta http-equiv='refresh' content='20'>
  `);
});

app.get("/status", (req, res) => {
  res.json({ ok: true, waReady, ...syncState });
});

app.get("/labels", async (req, res) => {
  if (!waReady) {
    return res.status(409).json({
      ok: false,
      error: "WhatsApp not connected"
    });
  }

  try {
    const labelObjects = await withDetachedFrameRetry(() => client.getLabels());

    const labels = labelObjects
      .map(label => ({
        id: label.id,
        name: label.name || "(unnamed)"
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ ok: true, labels });
  } catch (err) {
    const detail = String(err && (err.stack || err.message || err));
    console.error("Label preview failed:", detail);

    res.status(500).json({
      ok: false,
      error: String(err && (err.message || err)),
      detail
    });
  }
});

app.post("/sync/chats", async (req, res) => {
  if (!waReady) {
    return res.status(409).json({
      ok: false,
      error: "WhatsApp not connected"
    });
  }

  if (syncState.running) {
    return res.status(409).json({
      ok: false,
      error: "Sync already running"
    });
  }

  const body = req.body || {};

  const limitChats = Math.max(
    1,
    Math.min(Number(body.limitChats || 20), 250)
  );

  const messagesPerChat = Math.max(
    10,
    Math.min(Number(body.messagesPerChat || 150), 500)
  );

  const scanLimit = Math.max(
    limitChats,
    Math.min(Number(body.scanLimit || 250), 1000)
  );

  const labelFilter =
    String(body.label || "Tenants").trim().toLowerCase();

  syncState.running = true;

  let chatsSeen = 0;
  let messagesSaved = 0;
  let chatsScanned = 0;

  try {
    const allChats =
      await withDetachedFrameRetry(() => client.getChats());

    const directChats = allChats
      .filter(chat => !chat.isGroup)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const selected = [];

    for (const chat of directChats.slice(0, scanLimit)) {
      chatsScanned++;

      try {
        const chatLabels = await withDetachedFrameRetry(
          () => client.getChatLabels(chat.id._serialized),
          2
        );

        const labelNames =
          chatLabels.map(label => label.name).filter(Boolean);

        const isMatch = labelNames.some(
          name =>
            String(name).trim().toLowerCase() === labelFilter
        );

        if (isMatch) {
          selected.push({
            chat,
            labels: labelNames
          });

          if (selected.length >= limitChats) break;
        }
      } catch (err) {
        console.warn(
          `Could not read labels for ${chat.id && chat.id._serialized}:`,
          String(err && (err.message || err))
        );
      }

      await new Promise(resolve => setTimeout(resolve, 80));
    }

    for (const { chat, labels } of selected) {
      chatsSeen++;

      try {
        const renterId = await upsertRenter(chat, labels);

        const messages = await withDetachedFrameRetry(
          () => chat.fetchMessages({ limit: messagesPerChat }),
          2
        );

        for (const message of messages) {
          messagesSaved +=
            await saveMessage(
              chat.id._serialized,
              renterId,
              message
            );
        }

        await updateRenterDates(renterId);
      } catch (err) {
        console.warn(
          `Could not import chat ${chat.id && chat.id._serialized}:`,
          String(err && (err.stack || err.message || err))
        );
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
      label: body.label || "Tenants",
      chatsScanned,
      matchingChatsFound: selected.length,
      ...syncState
    });
  } catch (err) {
    syncState.running = false;

    const detail =
      String(err && (err.stack || err.message || err));

    console.error("Sync failed:", detail);

    res.status(500).json({
      ok: false,
      error: String(err && (err.message || err)),
      detail
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
