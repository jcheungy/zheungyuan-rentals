import { pool } from "../../../lib/db";
export const dynamic = "force-dynamic";

export default async function Properties() {
  let rows = [];
  try {
    rows = (await pool.query(`
      SELECT p.*,
             o.display_name owner_name,
             s.display_name source_name
      FROM properties p
      LEFT JOIN renters o ON o.id=p.owner_contact_id
      LEFT JOIN renters s ON s.id=p.source_contact_id
      ORDER BY CASE WHEN p.status='available' THEN 0 ELSE 1 END,
               p.updated_at DESC
    `)).rows;
  } catch {}

  return (
    <>
      <h2>Properties</h2>
      <p className="intro">Properties extracted from landlord and agent conversations. These can later be upgraded into real public listings.</p>
      <div style={{overflowX:"auto"}}>
        <table className="crm-table">
          <thead><tr><th>Property</th><th>Area</th><th>Rent</th><th>Features</th><th>Owner/source</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map(p => {
              const f = [];
              if (p.floor) f.push(p.floor);
              if (p.bedrooms != null) f.push(`${p.bedrooms} bed`);
              if (p.has_garden) f.push("Garden");
              if (p.has_rooftop) f.push("Rooftop");
              if (p.pets_allowed) f.push("Pets");
              if (p.parking_spaces) f.push(`${p.parking_spaces} parking`);
              return (
                <tr key={p.id}>
                  <td><strong>{p.title || p.address_text || `Property #${p.id}`}</strong><div className="crm-muted">{p.property_summary}</div></td>
                  <td>{p.village || p.area || "—"}</td>
                  <td>{p.asking_rent ? `HK$${Number(p.asking_rent).toLocaleString()}` : "—"}</td>
                  <td>{f.map(x => <span className="crm-tag" key={x}>{x}</span>)}</td>
                  <td>{p.owner_name || p.source_name || "—"}</td>
                  <td><span className="crm-status">{p.status}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
