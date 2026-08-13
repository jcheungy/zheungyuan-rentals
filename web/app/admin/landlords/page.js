import { pool } from "../../../lib/db";
export const dynamic = "force-dynamic";

export default async function Landlords() {
  let rows = [];
  try {
    rows = (await pool.query(`
      SELECT r.*,
        (SELECT COUNT(*)::int FROM whatsapp_messages w WHERE w.renter_id=r.id) message_count
      FROM renters r
      WHERE r.contact_type='landlord'
      ORDER BY r.last_message_at DESC NULLS LAST
    `)).rows;
  } catch {}

  return (
    <>
      <h2>Landlords / owners</h2>
      <p className="intro">Property owners identified from rental-related WhatsApp conversations.</p>
      <div style={{overflowX:"auto"}}>
        <table className="crm-table">
          <thead><tr><th>Contact</th><th>Summary</th><th>Relationship</th><th>Messages</th><th>Last message</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td><strong>{r.display_name || r.phone || `#${r.id}`}</strong><div className="crm-muted">ID {r.id}</div></td>
                <td>{r.contact_summary || <span className="crm-muted">Awaiting GPT classification</span>}</td>
                <td><span className="crm-status">{r.relationship_status || r.contact_type}</span></td>
                <td>{r.message_count}</td>
                <td>{r.last_message_at ? new Date(r.last_message_at).toLocaleDateString("en-HK") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
