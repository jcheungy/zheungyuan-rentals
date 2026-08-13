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
  const classification = String(value(params, "classification", "all"));
  const status = String(value(params, "status", "all"));
  const sort = String(value(params, "sort", "priority"));
  const budgetMaxRaw = String(value(params, "budget_max")).trim();

  const wantsParking = checked(params, "parking");
  const wantsPets = checked(params, "pets");
  const wantsGarden = checked(params, "garden");
  const wantsRooftop = checked(params, "rooftop");

  const budgetMax =
    budgetMaxRaw && Number.isFinite(Number(budgetMaxRaw))
      ? Math.max(0, Math.round(Number(budgetMaxRaw)))
      : null;

  const where = [
    `(r.contact_type='renter_prospect'
      OR (r.contact_type='unknown' AND r.classification_updated_at IS NULL))`
  ];
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
      OR CAST(r.id AS TEXT) ILIKE ${p}
    )`);
  }

  if (classification === "confirmed") {
    where.push(`r.contact_type='renter_prospect'`);
  } else if (classification === "pending") {
    where.push(`r.contact_type='unknown' AND r.classification_updated_at IS NULL`);
  }

  if (status === "active") {
    where.push(`r.contact_type='renter_prospect' AND r.status='active'`);
  } else if (status === "historical") {
    where.push(`r.contact_type='renter_prospect' AND r.status='historical'`);
  } else if (status === "closed") {
    where.push(`r.contact_type='renter_prospect' AND r.status='closed'`);
  } else if (status === "pending") {
    where.push(`r.contact_type='unknown' AND r.classification_updated_at IS NULL`);
  }

  if (wantsParking) where.push(`r.parking_needed IS TRUE`);
  if (wantsPets) where.push(`r.pets_required IS TRUE`);
  if (wantsGarden) where.push(`r.wants_garden IS TRUE`);
  if (wantsRooftop) where.push(`r.wants_rooftop IS TRUE`);

  if (budgetMax != null) {
    values.push(budgetMax);
    where.push(`(r.budget_min IS NULL OR r.budget_min <= $${values.length})`);
  }

  const sortSql = {
    priority: `
      CASE
        WHEN r.contact_type='renter_prospect' AND r.status='active' THEN 0
        WHEN r.contact_type='renter_prospect' THEN 1
        ELSE 2
      END,
      r.last_message_at DESC NULLS LAST,
      r.id DESC
    `,
    recent: `r.last_message_at DESC NULLS LAST, r.id DESC`,
    oldest: `r.last_message_at ASC NULLS LAST, r.id ASC`,
    name: `LOWER(COALESCE(r.display_name,r.phone,'')) ASC, r.id ASC`,
    messages: `message_count DESC, r.last_message_at DESC NULLS LAST`,
    budget_low: `COALESCE(r.budget_max,r.budget_min,2147483647) ASC, r.id DESC`,
    budget_high: `COALESCE(r.budget_max,r.budget_min,-1) DESC, r.id DESC`
  }[sort] || `
    CASE
      WHEN r.contact_type='renter_prospect' AND r.status='active' THEN 0
      WHEN r.contact_type='renter_prospect' THEN 1
      ELSE 2
    END,
    r.last_message_at DESC NULLS LAST,
    r.id DESC
  `;

  let rows = [];
  let counts = { total: 0, confirmed: 0, pending: 0, filtered: 0 };

  try {
    const baseCounts = (await pool.query(`
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

    counts = { ...baseCounts, filtered };
  } catch (err) {
    console.error("Renter list failed:", err);
  }

  const hasFilters =
    q ||
    classification !== "all" ||
    status !== "all" ||
    budgetMaxRaw ||
    wantsParking ||
    wantsPets ||
    wantsGarden ||
    wantsRooftop ||
    sort !== "priority";

  return (
    <>
      <h2>Renter demand</h2>
      <p className="intro">
        Search, filter and sort confirmed renter enquiries plus imported contacts awaiting review.
      </p>

      <div className="crm-grid" style={{marginBottom: 18}}>
        <div className="crm-panel"><span>Potential renters</span><div className="crm-count">{counts.total}</div></div>
        <div className="crm-panel"><span>Confirmed renters</span><div className="crm-count">{counts.confirmed}</div></div>
        <div className="crm-panel"><span>Awaiting review</span><div className="crm-count">{counts.pending}</div></div>
        <div className="crm-panel"><span>Showing now</span><div className="crm-count">{counts.filtered}</div></div>
      </div>

      <form
        method="get"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(260px,2fr) repeat(4,minmax(130px,1fr))",
          gap: 10,
          alignItems: "end",
          background: "#fff",
          border: "1px solid #e7dfd0",
          padding: 14,
          marginBottom: 12
        }}
      >
        <label style={{display:"grid", gap:5}}>
          <span className="crm-muted">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Name, phone, area, requirement, property, ID..."
            style={{padding:"9px 10px", border:"1px solid #d8d0c2", width:"100%"}}
          />
        </label>

        <label style={{display:"grid", gap:5}}>
          <span className="crm-muted">Classification</span>
          <select name="classification" defaultValue={classification} style={{padding:"9px 10px", border:"1px solid #d8d0c2"}}>
            <option value="all">All potential</option>
            <option value="confirmed">Confirmed renters</option>
            <option value="pending">Awaiting review</option>
          </select>
        </label>

        <label style={{display:"grid", gap:5}}>
          <span className="crm-muted">Status</span>
          <select name="status" defaultValue={status} style={{padding:"9px 10px", border:"1px solid #d8d0c2"}}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="historical">Historical</option>
            <option value="closed">Closed</option>
            <option value="pending">Pending review</option>
          </select>
        </label>

        <label style={{display:"grid", gap:5}}>
          <span className="crm-muted">Budget ceiling</span>
          <input
            type="number"
            min="0"
            step="500"
            name="budget_max"
            defaultValue={budgetMaxRaw}
            placeholder="e.g. 15000"
            style={{padding:"9px 10px", border:"1px solid #d8d0c2", width:"100%"}}
          />
        </label>

        <label style={{display:"grid", gap:5}}>
          <span className="crm-muted">Sort by</span>
          <select name="sort" defaultValue={sort} style={{padding:"9px 10px", border:"1px solid #d8d0c2"}}>
            <option value="priority">Active / confirmed first</option>
            <option value="recent">Most recent enquiry</option>
            <option value="oldest">Oldest enquiry</option>
            <option value="name">Name A–Z</option>
            <option value="messages">Most messages</option>
            <option value="budget_low">Budget low → high</option>
            <option value="budget_high">Budget high → low</option>
          </select>
        </label>

        <div style={{gridColumn:"1 / -1", display:"flex", flexWrap:"wrap", gap:14, alignItems:"center"}}>
          <span className="crm-muted">Needs:</span>
          <label style={{display:"flex", gap:6, alignItems:"center"}}>
            <input type="checkbox" name="parking" value="1" defaultChecked={wantsParking} />
            Parking
          </label>
          <label style={{display:"flex", gap:6, alignItems:"center"}}>
            <input type="checkbox" name="pets" value="1" defaultChecked={wantsPets} />
            Pets
          </label>
          <label style={{display:"flex", gap:6, alignItems:"center"}}>
            <input type="checkbox" name="garden" value="1" defaultChecked={wantsGarden} />
            Garden
          </label>
          <label style={{display:"flex", gap:6, alignItems:"center"}}>
            <input type="checkbox" name="rooftop" value="1" defaultChecked={wantsRooftop} />
            Rooftop
          </label>

          <button
            type="submit"
            style={{marginLeft:"auto", padding:"9px 16px", border:"1px solid #20362d", background:"#20362d", color:"#fff", cursor:"pointer"}}
          >
            Apply
          </button>

          {hasFilters ? (
            <a
              href="/admin/renters"
              style={{padding:"9px 14px", border:"1px solid #d8d0c2", textDecoration:"none", color:"inherit", background:"#fff"}}
            >
              Clear
            </a>
          ) : null}
        </div>
      </form>

      <div className="crm-muted" style={{marginBottom:10}}>
        Showing {counts.filtered} of {counts.total} potential renter contacts.
      </div>

      <div style={{overflowX:"auto"}}>
        <table className="crm-table">
          <thead>
            <tr>
              <th>Lead</th>
              <th>Requirement</th>
              <th>Area</th>
              <th>Budget</th>
              <th>Needs</th>
              <th>Classification</th>
              <th>Status</th>
              <th>Messages</th>
              <th>Last message</th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan="9" style={{padding:20}}>No potential renters match these filters.</td>
              </tr>
            ) : rows.map(r => {
              const needs = [];
              if (r.preferred_floor) needs.push(r.preferred_floor);
              if (r.wants_garden) needs.push("Garden");
              if (r.wants_rooftop) needs.push("Rooftop");
              if (r.pets_required) needs.push(r.pet_details || "Pets");
              if (r.parking_needed) needs.push("Parking");

              const pending = r.contact_type === "unknown" && !r.classification_updated_at;

              return (
                <tr key={r.id}>
                  <td>
                    <strong>{r.display_name || r.phone || `#${r.id}`}</strong>
                    <div className="crm-muted">ID {r.id}</div>
                    {r.phone && r.display_name ? <div className="crm-muted">{r.phone}</div> : null}
                  </td>
                  <td>{r.requirement_summary || <span className="crm-muted">{pending ? "Awaiting message analysis" : "No summary"}</span>}</td>
                  <td>{r.area_wanted || "—"}</td>
                  <td>{money(r)}</td>
                  <td>{needs.length ? needs.map(n => <span className="crm-tag" key={n}>{n}</span>) : "—"}</td>
                  <td><span className="crm-status">{pending ? "potential / unreviewed" : "renter prospect"}</span></td>
                  <td><span className="crm-status">{pending ? "pending" : r.status}</span></td>
                  <td>{r.message_count}</td>
                  <td>{r.last_message_at ? new Date(r.last_message_at).toLocaleDateString("en-HK") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
