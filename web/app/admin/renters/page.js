import { pool } from "../../../lib/db";

export const dynamic = "force-dynamic";

function money(r) {
  if (r.budget_min && r.budget_max) return `HK$${Number(r.budget_min).toLocaleString()}–${Number(r.budget_max).toLocaleString()}`;
  if (r.budget_max) return `Up to HK$${Number(r.budget_max).toLocaleString()}`;
  if (r.budget_min) return `From HK$${Number(r.budget_min).toLocaleString()}`;
  return "—";
}

export default async function Renters() {
  let rows = [];
  let counts = { total: 0, confirmed: 0, pending: 0 };

  try {
    rows = (await pool.query(`
      SELECT r.*,
        (SELECT COUNT(*)::int FROM whatsapp_messages w WHERE w.renter_id=r.id) message_count
      FROM renters r
      WHERE r.contact_type='renter_prospect'
         OR (r.contact_type='unknown' AND r.classification_updated_at IS NULL)
      ORDER BY
        CASE
          WHEN r.contact_type='renter_prospect' AND r.status='active' THEN 0
          WHEN r.contact_type='renter_prospect' THEN 1
          ELSE 2
        END,
        r.last_message_at DESC NULLS LAST,
        r.id DESC
    `)).rows;

    const c = (await pool.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE contact_type='renter_prospect'
             OR (contact_type='unknown' AND classification_updated_at IS NULL)
        )::int AS total,
        COUNT(*) FILTER (WHERE contact_type='renter_prospect')::int AS confirmed,
        COUNT(*) FILTER (
          WHERE contact_type='unknown' AND classification_updated_at IS NULL
        )::int AS pending
      FROM renters
    `)).rows[0];

    counts = c;
  } catch {}

  return (
    <>
      <h2>Renter demand</h2>
      <p className="intro">
        Showing {counts.total} potential renter contacts: {counts.confirmed} confirmed renter enquiries and {counts.pending} imported contacts awaiting GPT review. As contacts are classified as unrelated, landlord, agent or existing tenant they automatically leave this list.
      </p>

      <div className="crm-grid" style={{marginBottom: 18}}>
        <div className="crm-panel"><span>Potential renters</span><div className="crm-count">{counts.total}</div></div>
        <div className="crm-panel"><span>Confirmed renters</span><div className="crm-count">{counts.confirmed}</div></div>
        <div className="crm-panel"><span>Awaiting review</span><div className="crm-count">{counts.pending}</div></div>
      </div>

      <div style={{overflowX:"auto"}}>
        <table className="crm-table">
          <thead><tr><th>Lead</th><th>Requirement</th><th>Area</th><th>Budget</th><th>Needs</th><th>Classification</th><th>Status</th><th>Messages</th></tr></thead>
          <tbody>
            {rows.map(r => {
              const needs = [];
              if (r.preferred_floor) needs.push(r.preferred_floor);
              if (r.wants_garden) needs.push("Garden");
              if (r.wants_rooftop) needs.push("Rooftop");
              if (r.pets_required) needs.push(r.pet_details || "Pets");
              if (r.parking_needed) needs.push("Parking");

              const pending = r.contact_type === "unknown" && !r.classification_updated_at;

              return (
                <tr key={r.id}>
                  <td><strong>{r.display_name || r.phone || `#${r.id}`}</strong><div className="crm-muted">ID {r.id}</div></td>
                  <td>{r.requirement_summary || <span className="crm-muted">{pending ? "Awaiting message analysis" : "No summary"}</span>}</td>
                  <td>{r.area_wanted || "—"}</td>
                  <td>{money(r)}</td>
                  <td>{needs.map(n => <span className="crm-tag" key={n}>{n}</span>)}</td>
                  <td><span className="crm-status">{pending ? "potential / unreviewed" : "renter prospect"}</span></td>
                  <td><span className="crm-status">{pending ? "pending" : r.status}</span></td>
                  <td>{r.message_count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
