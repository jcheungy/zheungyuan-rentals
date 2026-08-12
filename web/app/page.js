export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="container">
          <nav className="nav">
            <div className="brand">
              <span className="brand-cn">張園</span>
              <span className="brand-en">Zheungyuan</span>
            </div>
            <a className="btn" href="/admin">Landlord dashboard</a>
          </nav>
          <div className="hero-grid">
            <div className="hero-copy">
              <div className="eyebrow">Yuen Long / Hong Kong</div>
              <h1>Village homes,<br/>thoughtfully let.</h1>
              <p>
                Professional presentation, organised enquiries and better tenant matching
                for Hong Kong village-house landlords.
              </p>
              <div className="hero-actions">
                <a className="btn gold" href="#landlords">List a property</a>
                <a className="btn" href="#how">How it works</a>
              </div>
            </div>
            <div className="hero-art" aria-label="Stylised contemporary village house">
              <div className="house"></div>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="landlords">
        <div className="container">
          <div className="kicker">For landlords</div>
          <h2>Better presentation.<br/>Less rental admin.</h2>
          <p className="intro">
            Send us the details once. We organise the listing, manage initial enquiries,
            identify suitable renters and help arrange viewings. You stay in control of
            who rents your property.
          </p>
          <div className="stats">
            <div className="stat"><strong>01</strong><span>Property profile</span></div>
            <div className="stat"><strong>02</strong><span>Tenant database</span></div>
            <div className="stat"><strong>03</strong><span>Matching</span></div>
            <div className="stat"><strong>04</strong><span>Viewing handoff</span></div>
          </div>
        </div>
      </section>

      <section className="section alt" id="how">
        <div className="container">
          <div className="kicker">How it works</div>
          <h2>From property details to suitable tenants.</h2>
          <div className="steps">
            {[
              ["01","Share the property","Rent, location, floor, photos, pets, parking and availability."],
              ["02","We present it","A clean Zhangyuan-style listing built for WhatsApp and online enquiries."],
              ["03","Enquiries are organised","Rental conversations become structured prospective-renter records."],
              ["04","Requirements are matched","Budget, area, pets, garden, parking, floor and move-in date are compared."],
              ["05","Viewings are focused","Spend time on stronger matches instead of repeating the same questions."],
              ["06","You decide","The landlord remains in control of tenant selection and final terms."]
            ].map(([n,t,d]) => (
              <div className="step" key={n}>
                <div className="step-no">{n}</div><h3>{t}</h3><p>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="container">
          <div className="brand"><span className="brand-cn">張園</span><span className="brand-en">Zheungyuan / Village House Rentals</span></div>
        </div>
      </footer>
    </>
  );
}
