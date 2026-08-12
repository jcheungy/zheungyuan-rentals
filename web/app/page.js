const sampleHomes = [
  {
    location: "Yuen Long",
    title: "Garden village home",
    meta: "Ground floor · Approx. 700 sq ft",
    price: "Sample presentation",
    image:
      "https://images.unsplash.com/photo-1721222205941-21b2eee40652?auto=format&fit=crop&fm=jpg&q=82&w=1600",
    tags: ["Garden", "Pet friendly", "Parking"],
  },
  {
    location: "New Territories",
    title: "Bright modern village home",
    meta: "Upper floor · Approx. 700 sq ft",
    price: "Sample presentation",
    image:
      "https://images.unsplash.com/photo-1742490382029-98357c08f3cd?auto=format&fit=crop&fm=jpg&q=82&w=1600",
    tags: ["Bright interior", "Balcony", "Quiet"],
  },
  {
    location: "Yuen Long",
    title: "Rooftop living",
    meta: "Top floor · Private roof",
    price: "Sample presentation",
    image:
      "https://images.unsplash.com/photo-1760709584989-79996c89255c?auto=format&fit=crop&fm=jpg&q=82&w=1600",
    tags: ["Rooftop", "Open view", "Outdoor space"],
  },
];

const landlordBenefits = [
  {
    n: "01",
    title: "Presented properly",
    text: "A polished property page built around the details renters actually care about — photos, floor, outdoor space, pets, parking and availability.",
  },
  {
    n: "02",
    title: "Enquiries organised",
    text: "Instead of repeating the same questions in WhatsApp, enquiries can be captured, qualified and kept in one usable place.",
  },
  {
    n: "03",
    title: "Better matching",
    text: "Prospective renters can be matched against a property by budget, area, floor, pets, parking, garden, rooftop and move-in timing.",
  },
  {
    n: "04",
    title: "You stay in control",
    text: "We help with presentation and the early rental process. The landlord still decides who views, who rents and the final terms.",
  },
];

const demandItems = [
  "Pet-friendly homes",
  "Ground-floor gardens",
  "Private rooftops",
  "Parking",
  "Yuen Long",
  "Flexible move-in dates",
];

export default function Home() {
  return (
    <>
      <section className="zy-hero">
        <img
          className="zy-hero-photo"
          src="https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&q=88&w=2200"
          alt="Contemporary home exterior"
        />
        <div className="zy-hero-shade" />

        <div className="container zy-hero-shell">
          <nav className="zy-nav">
            <a className="zy-brand" href="/" aria-label="Zheungyuan home">
              <span className="zy-brand-cn">張園</span>
              <span className="zy-brand-en">Zheungyuan</span>
            </a>

            <div className="zy-nav-links">
              <a href="#homes">Homes</a>
              <a href="#landlords">For landlords</a>
              <a href="#how">How it works</a>
              <a className="zy-nav-cta" href="#contact">
                List your property
              </a>
            </div>
          </nav>

          <div className="zy-hero-copy">
            <div className="zy-eyebrow">Village House Rentals · Hong Kong</div>
            <h1>
              Village homes,
              <br />
              presented properly.
            </h1>
            <p>
              A more thoughtful way to let village houses — professional
              presentation, organised enquiries and better matching between
              landlords and prospective renters.
            </p>

            <div className="zy-actions">
              <a className="zy-btn zy-btn-gold" href="#contact">
                List your property
              </a>
              <a className="zy-btn zy-btn-light" href="#homes">
                See the presentation
              </a>
            </div>
          </div>

          <div className="zy-hero-foot">
            <div>
              <span>Specialist focus</span>
              <strong>Village houses</strong>
            </div>
            <div>
              <span>Starting in</span>
              <strong>Yuen Long</strong>
            </div>
            <div>
              <span>Built around</span>
              <strong>Landlords + renters</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="zy-editorial" id="landlords">
        <div className="container zy-editorial-grid">
          <div className="zy-editorial-copy">
            <div className="zy-kicker">For village-house landlords</div>
            <h2>
              Better presentation.
              <br />
              Less rental admin.
            </h2>
            <p className="zy-lead">
              Send the property details once. 張園 can turn them into a
              cleaner rental presentation, keep enquiries organised and help
              surface stronger renter matches.
            </p>

            <div className="zy-quote">
              <span>張園</span>
              <p>
                The aim is simple: make a landlord&apos;s property easier to
                understand, easier to enquire about and easier to match with
                the right renter.
              </p>
            </div>
          </div>

          <div className="zy-editorial-media">
            <img
              src="https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&q=86&w=1600"
              alt="Bright modern living room"
            />
            <div className="zy-media-label">
              <span>Presentation matters</span>
              <strong>Photography · details · clarity</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="zy-homes" id="homes">
        <div className="container">
          <div className="zy-section-head">
            <div>
              <div className="zy-kicker">How listings can feel</div>
              <h2>Homes shown like homes.</h2>
            </div>
            <p>
              These are presentation examples for now. Real 張園 listings and
              property photography can replace them as the landlord portfolio
              grows.
            </p>
          </div>

          <div className="zy-property-grid">
            {sampleHomes.map((home, i) => (
              <article className="zy-property" key={home.title}>
                <div className="zy-property-image">
                  <img src={home.image} alt={home.title} />
                  <div className="zy-property-number">0{i + 1}</div>
                </div>
                <div className="zy-property-body">
                  <div className="zy-property-location">{home.location}</div>
                  <h3>{home.title}</h3>
                  <p>{home.meta}</p>
                  <div className="zy-property-tags">
                    {home.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                  <div className="zy-property-bottom">
                    <strong>{home.price}</strong>
                    <span aria-hidden="true">↗</span>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="zy-sample-note">
            <span>Preview only</span>
            Sample imagery and listing details are being used to establish the
            張園 visual language before the real property portfolio is added.
          </div>
        </div>
      </section>

      <section className="zy-benefits">
        <div className="container">
          <div className="zy-section-head zy-section-head-light">
            <div>
              <div className="zy-kicker">Why landlords use 張園</div>
              <h2>A cleaner route from listing to viewing.</h2>
            </div>
            <p>
              The service is designed around the parts of village-house
              letting that become repetitive and fragmented when everything
              happens through individual messages.
            </p>
          </div>

          <div className="zy-benefit-grid">
            {landlordBenefits.map((item) => (
              <div className="zy-benefit" key={item.n}>
                <div className="zy-benefit-no">{item.n}</div>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="zy-demand">
        <div className="container zy-demand-grid">
          <div>
            <div className="zy-kicker">A growing demand picture</div>
            <h2>
              Know what renters
              <br />
              are actually looking for.
            </h2>
            <p className="zy-lead">
              Historical property enquiries can become useful demand
              information instead of disappearing inside old WhatsApp
              conversations.
            </p>
          </div>

          <div className="zy-demand-panel">
            <div className="zy-demand-title">
              <span>Prospective renter requirements</span>
              <em>Example view</em>
            </div>
            <div className="zy-demand-list">
              {demandItems.map((item, i) => (
                <div className="zy-demand-row" key={item}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <strong>{item}</strong>
                  <i />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="zy-how" id="how">
        <div className="container">
          <div className="zy-section-head">
            <div>
              <div className="zy-kicker">How it works</div>
              <h2>Simple for the landlord.</h2>
            </div>
            <p>
              The technology stays behind the scenes. The landlord experience
              should remain straightforward and familiar.
            </p>
          </div>

          <div className="zy-process">
            {[
              ["01", "Send the details", "Photos, rent, location, floor, pets, parking, outdoor space and availability."],
              ["02", "We prepare the listing", "A clean, consistent property presentation designed for mobile and WhatsApp traffic."],
              ["03", "We organise enquiries", "Prospective renters are separated from day-to-day tenant conversations and other contacts."],
              ["04", "We surface matches", "Stronger fits can be identified before time is spent arranging viewings."],
              ["05", "You choose", "The landlord keeps control of viewings, tenant choice and final rental terms."],
            ].map(([n, title, text]) => (
              <div className="zy-process-step" key={n}>
                <span>{n}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="zy-contact" id="contact">
        <div className="zy-contact-photo">
          <img
            src="https://images.unsplash.com/photo-1744858207706-dd827060504d?auto=format&fit=crop&fm=jpg&q=82&w=2000"
            alt="Contemporary home with landscaped garden"
          />
        </div>
        <div className="container zy-contact-inner">
          <div className="zy-contact-card">
            <div className="zy-kicker">List with 張園</div>
            <h2>Have a village house to rent?</h2>
            <p>
              Start with the basics. Send the location, floor, asking rent and
              a few photos. We can build the property presentation from there.
            </p>
            <div className="zy-actions">
              <a className="zy-btn zy-btn-gold" href="#contact">
                Property enquiry
              </a>
              <a className="zy-text-link" href="/admin">
                Landlord dashboard →
              </a>
            </div>
            <small>
              Contact details / WhatsApp button can be connected when the
              public launch details are finalised.
            </small>
          </div>
        </div>
      </section>

      <footer className="zy-footer">
        <div className="container zy-footer-grid">
          <div className="zy-brand">
            <span className="zy-brand-cn">張園</span>
            <span className="zy-brand-en">Zheungyuan</span>
          </div>
          <p>Village House Rentals · Hong Kong</p>
          <span>Presentation · Enquiries · Matching</span>
        </div>
      </footer>
    </>
  );
}
