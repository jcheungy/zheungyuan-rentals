import { pool } from "../../../lib/db";
export const dynamic = "force-dynamic";

export default async function Matches() {
  let rows = [];
  try {
    rows = (await pool.query(`
      SELECT m.*, p.title property_title, p.area property_area,
             r.display_name renter_name, r.status renter_status,
             r.requirement_summary
      FROM property_matches m
      JOIN properties p ON p.id=m.property_id
      JOIN renters r ON r.id=m.renter_id
      ORDER BY CASE WHEN m.demand_type='active' THEN 0 ELSE 1 END,
               m.match_score DESC
    `)).rows;
  } catch {}

  return (
    <>
      <h2>Property matches</h2>
      <p className="intro">Active renter matches are prioritised. Historical matches show evidence of demand for similar homes.</p>
      <div style={{overflowX:"auto"}}>
        <table className="crm-table">
          <thead><tr><th>Property</th><th>Renter</th><th>Demand</th><th>Score</th><th>Why it matches</th></tr></thead>
          <tbody>
            {rows.map(m => (
              <tr key={m.id}>
                <td><strong>{m.property_title || `Property #${m.property_id}`}</strong><div className="crm-muted">{m.property_area}</div></td>
                <td>{m.renter_name || `Renter #${m.renter_id}`}</td>
                <td><span className="crm-status">{m.demand_type}</span></td>
                <td><strong>{m.match_score}%</strong></td>
                <td>{m.reasons || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
