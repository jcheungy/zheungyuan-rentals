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
  try {
    rows = (await pool.query(`
      SELECT r.*,
        (SELECT COUNT(*)::int FROM whatsapp_messages w WHERE w.renter_id=r.id) message_count
      FROM renters r
      WHERE r.contact_type='renter_prospect'
      ORDER BY CASE WHEN r.status='active' THEN 0 ELSE 1 END,
               r.last_message_at DESC NULLS LAST
    `)).rows;
  } catch {}

  return (
    <>
      <h2>Renter demand</h2>
      <p className="intro">Active renters first; historical enquiries remain useful demand evidence.</p>
      <div style={{overflowX:"auto"}}>
        <table className="crm-table">
          <thead><tr><th>Lead</th><th>Requirement</th><th>Area</th><th>Budget</th><th>Needs</th><th>Status</th><th>Messages</th></tr></thead>
          <tbody>
            {rows.map(r => {
              const needs = [];
              if (r.preferred_floor) needs.push(r.preferred_floor);
              if (r.wants_garden) needs.push("Garden");
              if (r.wants_rooftop) needs.push("Rooftop");
              if (r.pets_required) needs.push(r.pet_details || "Pets");
              if (r.parking_needed) needs.push("Parking");
              return (
                <tr key={r.id}>
                  <td><strong>{r.display_name || r.phone || `#${r.id}`}</strong><div className="crm-muted">ID {r.id}</div></td>
                  <td>{r.requirement_summary || <span className="crm-muted">No summary</span>}</td>
                  <td>{r.area_wanted || "—"}</td>
                  <td>{money(r)}</td>
                  <td>{needs.map(n => <span className="crm-tag" key={n}>{n}</span>)}</td>
                  <td><span className="crm-status">{r.status}</span></td>
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
