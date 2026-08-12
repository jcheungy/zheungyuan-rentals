import { pool } from "../../lib/db";

export const dynamic = "force-dynamic";

async function getRenters() {
  try {
    const { rows } = await pool.query(`
      SELECT id, display_name, phone, area_wanted, budget_max, preferred_floor,
             pets_required, parking_needed, last_message_at, status
      FROM renters
      ORDER BY last_message_at DESC NULLS LAST, id DESC
      LIMIT 250
    `);
    return rows;
  } catch {
    return [];
  }
}

export default async function Admin() {
  const renters = await getRenters();
  const active = renters.filter(r => r.status === "active").length;
  const pet = renters.filter(r => r.pets_required).length;
  const parking = renters.filter(r => r.parking_needed).length;

  return (
    <main className="container admin-wrap">
      <div className="kicker">Internal / Tenant demand</div>
      <h2>Rental enquiries</h2>
      <p className="intro">WhatsApp conversations become reusable renter requirements.</p>

      <div className="cards">
        <div className="card"><span>Total renters</span><strong>{renters.length}</strong></div>
        <div className="card"><span>Active</span><strong>{active}</strong></div>
        <div className="card"><span>Pets required</span><strong>{pet}</strong></div>
        <div className="card"><span>Parking required</span><strong>{parking}</strong></div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Name</th><th>Area</th><th>Budget</th><th>Floor</th><th>Pets</th><th>Parking</th><th>Status</th><th>Last message</th></tr>
          </thead>
          <tbody>
          {renters.length === 0 ? (
            <tr><td colSpan="8">No renters imported yet. Connect the reader and sync chats.</td></tr>
          ) : renters.map(r => (
            <tr key={r.id}>
              <td>{r.display_name || r.phone || "Unknown"}</td>
              <td>{r.area_wanted || "—"}</td>
              <td>{r.budget_max ? `HK$${Number(r.budget_max).toLocaleString()}` : "—"}</td>
              <td>{r.preferred_floor || "—"}</td>
              <td>{r.pets_required == null ? "—" : r.pets_required ? "Yes" : "No"}</td>
              <td>{r.parking_needed == null ? "—" : r.parking_needed ? "Yes" : "No"}</td>
              <td><span className="pill">{r.status || "unknown"}</span></td>
              <td>{r.last_message_at ? new Date(r.last_message_at).toLocaleDateString("en-HK") : "—"}</td>
            </tr>
          ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
