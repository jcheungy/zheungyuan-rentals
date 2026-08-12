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
);

CREATE INDEX IF NOT EXISTS idx_renters_last_message ON renters(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_renters_status ON renters(status);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON whatsapp_messages(whatsapp_chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_date ON whatsapp_messages(message_at DESC);
