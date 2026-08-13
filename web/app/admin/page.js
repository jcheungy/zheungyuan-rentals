import { pool } from "../../lib/db";

export const dynamic = "force-dynamic";

async function getRenters() {
  try {
    const { rows } = await pool.query(`
      SELECT
        id,
        display_name,
        phone,
        area_wanted,
        budget_min,
        budget_max,
        bedrooms,
        preferred_floor,
        wants_garden,
        wants_rooftop,
        pets_required,
        pet_details,
        parking_needed,
        move_in_date,
        occupants,
        source_property,
        requirement_summary,
        last_message_at,
        status,
        contact_type,
        analysis_confidence,
        analysis_notes,
        analysis_updated_at
      FROM renters
      WHERE contact_type = 'renter_prospect'
      ORDER BY last_message_at DESC NULLS LAST, id DESC
      LIMIT 250
    `);
    return rows;
  } catch {
    return [];
  }
}

function moneyRange(r) {
  if (r.budget_min && r.budget_max) {
    return `HK$${Number(r.budget_min).toLocaleString()}–${Number(r.budget_max).toLocaleString()}`;
  }
  if (r.budget_max) return `Up to HK$${Number(r.budget_max).toLocaleString()}`;
  if (r.budget_min) return `From HK$${Number(r.budget_min).toLocaleString()}`;
  return "—";
}

function requirementTags(r) {
  const tags = [];
  if (r.bedrooms != null) tags.push(`${r.bedrooms} bed`);
  if (r.preferred_floor) tags.push(r.preferred_floor);
  if (r.wants_garden) tags.push("Garden");
  if (r.wants_rooftop) tags.push("Rooftop");
  if (r.pets_required) tags.push(r.pet_details || "Pets");
  if (r.parking_needed) tags.push("Parking");
  if (r.move_in_date) tags.push(`Move ${new Date(r.move_in_date).toLocaleDateString("en-HK")}`);
  return tags;
}

export default async function Admin() {
  const renters = await getRenters();
  const analysed = renters.filter(r => r.analysis_updated_at).length;
  const active = renters.filter(r => r.status === "active").length;
  const historical = renters.filter(r => r.status === "historical").length;

  return (
    <main className="container admin-wrap">
      <div className="kicker">Internal / Prospective renter demand</div>
      <h2>Rental enquiries</h2>
      <p className="intro">
        Historical viewing and property-enquiry leads imported from WhatsApp.
        The private 張園 Custom GPT can turn each conversation into structured
        renter requirements for future property matching.
      </p>

      <div className="cards">
        <div className="card"><span>Prospect leads</span><strong>{renters.length}</strong></div>
        <div className="card"><span>GPT analysed</span><strong>{analysed}</strong></div>
        <div className="card"><span>Active</span><strong>{active}</strong></div>
        <div className="card"><span>Historical demand</span><strong>{historical}</strong></div>
      </div>

      <div className="admin-note">
        Existing tenant-management conversations remain excluded. A lead should
        only be marked active when the conversation supports that conclusion;
        older enquiries can remain useful as historical demand.
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Lead</th>
              <th>Requirement</th>
              <th>Budget</th>
              <th>Needs</th>
              <th>Status</th>
              <th>Last message</th>
            </tr>
          </thead>
          <tbody>
          {renters.length === 0 ? (
            <tr>
              <td colSpan="6">
                No prospective renter leads imported yet.
              </td>
            </tr>
          ) : renters.map(r => {
            const tags = requirementTags(r);
            return (
              <tr key={r.id}>
                <td className="lead-main">
                  <div className="lead-name">{r.display_name || r.phone || "Unknown"}</div>
                  {r.phone && <div className="lead-phone">{r.phone}</div>}
                  {r.analysis_updated_at && (
                    <span className="confidence">
                      GPT reviewed
                      {r.analysis_confidence != null
                        ? ` · ${Math.round(Number(r.analysis_confidence) * 100)}% confidence`
                        : ""}
                    </span>
                  )}
                </td>
                <td>
                  <div className="lead-summary">
                    {r.requirement_summary || (
                      <span className="muted-small">Awaiting GPT analysis</span>
                    )}
                  </div>
                  <div className="lead-meta">
                    {r.area_wanted || "Area not extracted"}
                    {r.occupants ? ` · ${r.occupants}` : ""}
                  </div>
                </td>
                <td>{moneyRange(r)}</td>
                <td>
                  <div className="mini-tags">
                    {tags.length
                      ? tags.map(tag => <span className="mini-tag" key={tag}>{tag}</span>)
                      : <span className="muted-small">—</span>}
                  </div>
                </td>
                <td><span className="pill">{r.status || "unknown"}</span></td>
                <td>
                  {r.last_message_at
                    ? new Date(r.last_message_at).toLocaleDateString("en-HK")
                    : "—"}
                </td>
              </tr>
            );
          })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
