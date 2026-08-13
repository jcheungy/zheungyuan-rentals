export const dynamic = "force-dynamic";

const nav = [
  ["/admin", "Overview"],
  ["/admin/renters", "Renters"],
  ["/admin/landlords", "Landlords"],
  ["/admin/properties", "Properties"],
  ["/admin/agents", "Agents"],
  ["/admin/matches", "Matches"],
];

export default function AdminLayout({ children }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `
        .crm-nav{display:flex;gap:8px;flex-wrap:wrap;margin:28px 0 36px}
        .crm-nav a{border:1px solid #d7d0c4;padding:9px 13px;background:#fff;font-size:12px}
        .crm-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:25px 0}
        .crm-panel{background:#fff;border:1px solid #ddd5c8;padding:22px}
        .crm-panel h3{font-family:Georgia,serif;font-weight:400;font-size:23px;margin:0 0 8px}
        .crm-panel p{color:#68736d;line-height:1.6;font-size:13px}
        .crm-count{font-family:Georgia,serif;font-size:34px}
        .crm-table{width:100%;border-collapse:collapse;background:#fff}
        .crm-table th,.crm-table td{padding:12px 14px;border-bottom:1px solid #ece7de;text-align:left;vertical-align:top;font-size:12px}
        .crm-table th{color:#69726d;text-transform:uppercase;font-size:10px;letter-spacing:.08em}
        .crm-muted{color:#7d847f}
        .crm-tag{display:inline-block;border:1px solid #d8d0c3;border-radius:99px;padding:4px 8px;margin:2px;font-size:10px}
        .crm-status{display:inline-block;background:#f1ecdf;padding:5px 8px;border-radius:99px;font-size:10px}
        .crm-links{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:26px}
        @media(max-width:900px){.crm-grid{grid-template-columns:repeat(2,1fr)}.crm-links{grid-template-columns:1fr}}
      `}} />
      <main className="container admin-wrap">
        <div className="kicker">張園 / Internal Rental CRM</div>
        <nav className="crm-nav">
          {nav.map(([href, label]) => (
            <a href={href} key={href}>{label}</a>
          ))}
        </nav>
        {children}
      </main>
    </>
  );
}
