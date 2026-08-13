import { pool } from "../../lib/db";

export const dynamic = "force-dynamic";

async function data() {
  const contacts = await pool.query(`
    SELECT
      COUNT(*)::int total,
      COUNT(*) FILTER (WHERE contact_type='renter_prospect')::int renters,
      COUNT(*) FILTER (WHERE contact_type='landlord')::int landlords,
      COUNT(*) FILTER (WHERE contact_type='agent')::int agents,
      COUNT(*) FILTER (WHERE contact_type='existing_tenant')::int tenants,
      COUNT(*) FILTER (WHERE classification_updated_at IS NOT NULL)::int reviewed
    FROM renters
    WHERE contact_type <> 'unrelated'
  `);

  const messages = await pool.query(
    `SELECT COUNT(*)::int count FROM whatsapp_messages`
  );

  const properties = await pool.query(`
    SELECT
      COUNT(*)::int total,
      COUNT(*) FILTER (WHERE status='available')::int available
    FROM properties
  `);

  const matches = await pool.query(`
    SELECT COUNT(*)::int count FROM property_matches
  `);

  return {
    c: contacts.rows[0],
    messages: messages.rows[0].count,
    properties: properties.rows[0],
    matches: matches.rows[0].count
  };
}

export default async function Admin() {
  let d = {
    c: {total:0,renters:0,landlords:0,agents:0,tenants:0,reviewed:0},
    messages:0,
    properties:{total:0,available:0},
    matches:0
  };

  try { d = await data(); } catch {}

  return (
    <>
      <h2>Rental CRM overview</h2>
      <p className="intro">
        WhatsApp rental conversations, renter demand, landlords, agents,
        properties and property-to-renter matches in one database.
      </p>

      <div className="crm-grid">
        <div className="crm-panel"><span>CRM contacts</span><div className="crm-count">{d.c.total}</div></div>
        <div className="crm-panel"><span>Messages stored</span><div className="crm-count">{Number(d.messages).toLocaleString()}</div></div>
        <div className="crm-panel"><span>Renters</span><div className="crm-count">{d.c.renters}</div></div>
        <div className="crm-panel"><span>Landlords</span><div className="crm-count">{d.c.landlords}</div></div>
        <div className="crm-panel"><span>Agents</span><div className="crm-count">{d.c.agents}</div></div>
        <div className="crm-panel"><span>Properties</span><div className="crm-count">{d.properties.total}</div></div>
        <div className="crm-panel"><span>Available properties</span><div className="crm-count">{d.properties.available}</div></div>
        <div className="crm-panel"><span>Saved matches</span><div className="crm-count">{d.matches}</div></div>
        <div className="crm-panel"><span>GPT reviewed contacts</span><div className="crm-count">{d.c.reviewed}</div></div>
      </div>

      <div className="crm-links">
        <div className="crm-panel">
          <h3>Demand</h3>
          <p>Active and historical renter requirements extracted from complete WhatsApp conversations.</p>
          <a href="/admin/renters">Open renters →</a>
        </div>
        <div className="crm-panel">
          <h3>Supply</h3>
          <p>Landlord and agent contacts plus properties identified from rental conversations.</p>
          <a href="/admin/properties">Open properties →</a>
        </div>
        <div className="crm-panel">
          <h3>Matching</h3>
          <p>Prioritise active renters and use historical demand as supporting evidence.</p>
          <a href="/admin/matches">Open matches →</a>
        </div>
      </div>
    </>
  );
}
