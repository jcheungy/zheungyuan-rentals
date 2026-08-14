import { pool } from "../../../lib/db";

export const dynamic = "force-dynamic";

function money(r) {
  if (r.budget_min && r.budget_max) {
    return `HK$${Number(r.budget_min).toLocaleString()}–${Number(r.budget_max).toLocaleString()}`;
  }
  if (r.budget_max) return `Up to HK$${Number(r.budget_max).toLocaleString()}`;
  if (r.budget_min) return `From HK$${Number(r.budget_min).toLocaleString()}`;
  return "—";
}

function value(params, key, fallback = "") {
  const v = params?.[key];
  return Array.isArray(v) ? (v[0] || fallback) : (v || fallback);
}

function checked(params, key) {
  return value(params, key) === "1";
}

export default async function Renters({ searchParams }) {
  const params = (await searchParams) || {};

  const q = String(value(params, "q")).trim();
  const analysis = String(value(params, "analysis", "all"));
  const type = String(value(params, "type", "all"));
  const sort = String(value(params, "sort", "recent"));
  const budgetMaxRaw = String(value(params, "budget_max")).trim();

  const wantsParking = checked(params, "parking");
  const wantsPets = checked(params, "pets");
  const wantsGarden = checked(params, "garden");
  const wantsRooftop = checked(params, "rooftop");
  const hasRequirements = checked(params, "requirements");

  const budgetMax =
    budgetMaxRaw && Number.isFinite(Number(budgetMaxRaw))
      ? Math.max(0, Math.round(Number(budgetMaxRaw)))
      : null;

  const where = ["1=1"];
  const values = [];

  if (q) {
    values.push(`%${q}%`);
    const p = `$${values.length}`;

    where.push(`(
      COALESCE(r.display_name,'') ILIKE ${p}
      OR COALESCE(r.phone,'') ILIKE ${p}
      OR COALESCE(r.requirement_summary,'') ILIKE ${p}
      OR COALESCE(r.contact_summary,'') ILIKE ${p}
      OR COALESCE(r.area_wanted,'') ILIKE ${p}
      OR COALESCE(r.preferred_floor,'') ILIKE ${p}
      OR COALESCE(r.pet_details,'') ILIKE ${p}
      OR COALESCE(r.source_property,'') ILIKE ${p}
      OR COALESCE(r.contact_type,'') ILIKE ${p}
      OR CAST(r.id AS TEXT) ILIKE ${p}
    )`);
  }

  if (analysis === "analysed") {
    where.push("r.analysis_updated_at IS NOT NULL");
  } else if (analysis === "awaiting") {
    where.push("r.analysis_updated_at IS NULL");
  }

  if (type !== "all") {
    values.push(type);
    where.push(`r.contact_type=$${values.length}`);
  }

  if (hasRequirements) {
    where.push(`(
      NULLIF(TRIM(COALESCE(r.requirement_summary,'')), '') IS NOT NULL
      OR NULLIF(TRIM(COALESCE(r.area_wanted,'')), '') IS NOT NULL
      OR r.budget_min IS NOT NULL
      OR r.budget_max IS NOT NULL
      OR r.bedrooms IS NOT NULL
      OR r.pets_required IS TRUE
      OR r.parking_needed IS TRUE
      OR r.wants_garden IS TRUE
      OR r.wants_rooftop IS TRUE
    )`);
  }

  if (wantsParking) where.push("r.parking_needed IS TRUE");
  if (wantsPets) where.push("r.pets_required IS TRUE");
  if (wantsGarden) where.push("r.wants_garden IS TRUE");
  if (wantsRooftop) where.push("r.wants_rooftop IS TRUE");

  if (budgetMax != null) {
    values.push(budgetMax);
    where.push(`(
      r.budget_min IS NULL
      OR r.budget_min <= $${values.length}
    )`);
  }

  const sortSql = {
    recent: "r.last_message_at DESC NULLS LAST, r.id DESC",
    oldest: "r.last_message_at ASC NULLS LAST, r.id ASC",
    name: "LOWER(COALESCE(r.display_name,r.phone,'')) ASC, r.id ASC",
    messages: "message_count DESC, r.last_message_at DESC NULLS LAST",
    analysed: "r.analysis_updated_at DESC NULLS LAST, r.id DESC",
    budget_low: "COALESCE(r.budget_max,r.budget_min,2147483647) ASC, r.id DESC",
    budget_high: "COALESCE(r.budget_max,r.budget_min,-1) DESC, r.id DESC"
  }[sort] || "r.last_message_at DESC NULLS LAST, r.id DESC";

  let rows = [];
  let counts = {
    total: 0,
    analysed: 0,
    awaiting: 0,
    requirements: 0,
    filtered: 0
  };

  try {
    const base = (await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE analysis_updated_at IS NOT NULL
        )::int AS analysed,
        COUNT(*) FILTER (
          WHERE analysis_updated_at IS NULL
        )::int AS awaiting,
        COUNT(*) FILTER (
          WHERE NULLIF(TRIM(COALESCE(requirement_summary,'')), '') IS NOT NULL
             OR NULLIF(TRIM(COALESCE(area_wanted,'')), '') IS NOT NULL
             OR budget_min IS NOT NULL
             OR budget_max IS NOT NULL
             OR bedrooms IS NOT NULL
             OR pets_required IS TRUE
             OR parking_needed IS TRUE
             OR wants_garden IS TRUE
             OR wants_rooftop IS TRUE
        )::int AS requirements
      FROM renters
    `)).rows[0];

    const filtered = (await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM renters r
      WHERE ${where.join(" AND ")}
    `, values)).rows[0].count;

    rows = (await pool.query(`
      SELECT
        r.*,
        (
          SELECT COUNT(*)::int
          FROM whatsapp_messages w
          WHERE w.renter_id=r.id
        ) AS message_count
      FROM renters r
      WHERE ${where.join(" AND ")}
      ORDER BY ${sortSql}
    `, values)).rows;

    counts = {
      ...base,
      filtered
    };
  } catch (err) {
    console.error("CRM contact list failed:", err);
  }

  const hasFilters =
    q ||
    analysis !== "all" ||
    type !== "all" ||
    budgetMaxRaw ||
    wantsParking ||
    wantsPets ||
    wantsGarden ||
    wantsRooftop ||
    hasRequirements ||
    sort !== "recent";

  return (
    <>
      <h2>Rental contacts & renter demand</h2>

      <p className="intro">
        Every imported WhatsApp contact remains in this table. GPT analysis only summarises the stored chat and extracts renter requirements; it does not remove contacts from this list.
      </p>

      <div className="crm-grid" style={{marginBottom:18}}>
        <div className="crm-panel">
          <span>All CRM contacts</span>
          <div className="crm-count">{counts.total}</div>
        </div>

        <div className="crm-panel">
          <span>Chats analysed</span>
          <div className="crm-count">{counts.analysed}</div>
        </div>

        <div className="crm-panel">
          <span>Awaiting analysis</span>
          <div className="crm-count">{counts.awaiting}</div>
        </div>

        <div className="crm-panel">
          <span>With rental requirements</span>
          <div className="crm-count">{counts.requirements}</div>
        </div>

        <div className="crm-panel">
          <span>Showing now</span>
          <div className="crm-count">{counts.filtered}</div>
        </div>
      </div>

      <form
        method="get"
        style={{
          display:"grid",
          gridTemplateColumns:"minmax(280px,2fr) repeat(4,minmax(140px,1fr))",
          gap:10,
          alignItems:"end",
          background:"#fff",
          border:"1px solid #e7dfd0",
          padding:14,
          marginBottom:12
        }}
      >
        <label style={{display:"grid",gap:5}}>
          <span className="crm-muted">Search entire CRM</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Name, phone, area, requirement, summary, ID..."
            style={{
              padding:"9px 10px",
              border:"1px solid #d8d0c2",
              width:"100%"
            }}
          />
        </label>

        <label style={{display:"grid",gap:5}}>
          <span className="crm-muted">Analysis</span>
          <select
            name="analysis"
            defaultValue={analysis}
            style={{padding:"9px 10px",border:"1px solid #d8d0c2"}}
          >
            <option value="all">All contacts</option>
            <option value="analysed">Analysed</option>
            <option value="awaiting">Awaiting analysis</option>
          </select>
        </label>

        <label style={{display:"grid",gap:5}}>
          <span className="crm-muted">Existing type</span>
          <select
            name="type"
            defaultValue={type}
            style={{padding:"9px 10px",border:"1px solid #d8d0c2"}}
          >
            <option value="all">All types</option>
            <option value="renter_prospect">Renter prospect</option>
            <option value="existing_tenant">Existing tenant</option>
            <option value="landlord">Landlord</option>
            <option value="agent">Agent</option>
            <option value="other_rental_contact">Other rental</option>
            <option value="unrelated">Unrelated</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>

        <label style={{display:"grid",gap:5}}>
          <span className="crm-muted">Budget ceiling</span>
          <input
            type="number"
            min="0"
            step="500"
            name="budget_max"
            defaultValue={budgetMaxRaw}
            placeholder="e.g. 15000"
            style={{
              padding:"9px 10px",
              border:"1px solid #d8d0c2",
              width:"100%"
            }}
          />
        </label>

        <label style={{display:"grid",gap:5}}>
          <span className="crm-muted">Sort by</span>
          <select
            name="sort"
            defaultValue={sort}
            style={{padding:"9px 10px",border:"1px solid #d8d0c2"}}
          >
            <option value="recent">Most recent chat</option>
            <option value="oldest">Oldest chat</option>
            <option value="name">Name A–Z</option>
            <option value="messages">Most messages</option>
            <option value="analysed">Recently analysed</option>
            <option value="budget_low">Budget low → high</option>
            <option value="budget_high">Budget high → low</option>
          </select>
        </label>

        <div
          style={{
            gridColumn:"1 / -1",
            display:"flex",
            flexWrap:"wrap",
            gap:14,
            alignItems:"center"
          }}
        >
          <span className="crm-muted">Requirements:</span>

          <label style={{display:"flex",gap:6,alignItems:"center"}}>
            <input
              type="checkbox"
              name="requirements"
              value="1"
              defaultChecked={hasRequirements}
            />
            Has rental requirements
          </label>

          <label style={{display:"flex",gap:6,alignItems:"center"}}>
            <input type="checkbox" name="parking" value="1" defaultChecked={wantsParking} />
            Parking
          </label>

          <label style={{display:"flex",gap:6,alignItems:"center"}}>
            <input type="checkbox" name="pets" value="1" defaultChecked={wantsPets} />
            Pets
          </label>

          <label style={{display:"flex",gap:6,alignItems:"center"}}>
            <input type="checkbox" name="garden" value="1" defaultChecked={wantsGarden} />
            Garden
          </label>

          <label style={{display:"flex",gap:6,alignItems:"center"}}>
            <input type="checkbox" name="rooftop" value="1" defaultChecked={wantsRooftop} />
            Rooftop
          </label>

          <button
            type="submit"
            style={{
              marginLeft:"auto",
              padding:"9px 16px",
              border:"1px solid #20362d",
              background:"#20362d",
              color:"#fff",
              cursor:"pointer"
            }}
          >
            Apply
          </button>

          {hasFilters ? (
            <a
              href="/admin/renters"
              style={{
                padding:"9px 14px",
                border:"1px solid #d8d0c2",
                textDecoration:"none",
                color:"inherit",
                background:"#fff"
              }}
            >
              Clear
            </a>
          ) : null}
        </div>
      </form>

      <div className="crm-muted" style={{marginBottom:10}}>
        Showing {counts.filtered} of {counts.total} CRM contacts.
      </div>

      <div style={{overflowX:"auto"}}>
        <table className="crm-table">
          <thead>
            <tr>
              <th>Contact</th>
              <th>Chat summary</th>
              <th>Rental requirements</th>
              <th>Area</th>
              <th>Budget</th>
              <th>Needs</th>
              <th>Existing type</th>
              <th>Messages</th>
              <th>Last chat</th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan="9" style={{padding:20}}>
                  No contacts match these filters.
                </td>
              </tr>
            ) : rows.map(r => {
              const needs = [];

              if (r.preferred_floor) needs.push(r.preferred_floor);
              if (r.wants_garden) needs.push("Garden");
              if (r.wants_rooftop) needs.push("Rooftop");
              if (r.pets_required) needs.push(r.pet_details || "Pets");
              if (r.parking_needed) needs.push("Parking");

              return (
                <tr key={r.id}>
                  <td>
                    <strong>{r.display_name || r.phone || `#${r.id}`}</strong>
                    <div className="crm-muted">ID {r.id}</div>
                    {r.phone && r.display_name ? (
                      <div className="crm-muted">{r.phone}</div>
                    ) : null}
                  </td>

                  <td>
                    {r.contact_summary || (
                      <span className="crm-muted">
                        {r.analysis_updated_at
                          ? "No chat summary recorded"
                          : "Awaiting GPT summary"}
                      </span>
                    )}
                  </td>

                  <td>
                    {r.requirement_summary || (
                      <span className="crm-muted">
                        No clear rental requirement recorded
                      </span>
                    )}
                  </td>

                  <td>{r.area_wanted || "—"}</td>
                  <td>{money(r)}</td>

                  <td>
                    {needs.length
                      ? needs.map(n => (
                          <span className="crm-tag" key={n}>{n}</span>
                        ))
                      : "—"}
                  </td>

                  <td>
                    <span className="crm-status">
                      {r.contact_type || "unknown"}
                    </span>
                  </td>

                  <td>{r.message_count}</td>

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
    </>
  );
}
