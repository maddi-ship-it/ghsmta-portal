import Link from "next/link";

const portalPaths = [
  { number: "01", title: "Schools", copy: "Applications, scheduling, school files, appeals, and direct communication with GHSMTA." },
  { number: "02", title: "Adjudicators", copy: "Assigned productions, collaborative observations, scoring, and category decisions." },
  { number: "03", title: "Advisory & Owners", copy: "Live oversight, eligibility review, program setup, reporting, and preserved archives." },
];

export default function LandingPage() {
  return (
    <main className="regal-landing safe-shell">
      <header className="regal-public-header">
        <div className="container regal-public-nav">
          <Link href="/" className="regal-brand" aria-label="GHSMTA home">
            <span className="regal-brand-mark">G</span>
            <span><strong>GHSMTA</strong><small>Awards Portal</small></span>
          </Link>
          <nav className="nav-actions" aria-label="Primary navigation">
            <Link className="button button-ghost-gold" href="/login">Sign in</Link>
            <Link className="button button-gold" href="/signup">Start an application</Link>
          </nav>
        </div>
      </header>

      <section className="regal-hero">
        <div className="regal-curtain regal-curtain-left" />
        <div className="regal-curtain regal-curtain-right" />
        <div className="regal-spotlight" />
        <div className="container regal-hero-grid">
          <div className="regal-hero-copy">
            <p className="eyebrow">Georgia High School Musical Theatre Awards</p>
            <h1>Excellence takes the stage.</h1>
            <p className="regal-hero-lede">The secure 2026–2027 home for school applications, adjudication visits, award materials, and GHSMTA program administration.</p>
            <div className="hero-actions"><Link className="button button-gold" href="/signup">Begin your school application</Link><Link className="button button-ghost-gold" href="/login">Continue to the portal</Link></div>
            <div className="regal-signin-note"><span>Secure access</span><span>Email + password</span><span>Magic Link</span><span>Phone code</span><span>MFA</span></div>
          </div>

          <aside className="regal-season-card">
            <div className="regal-season-seal">2026<br /><span>–</span><br />2027</div>
            <p className="eyebrow">Current awards cycle</p>
            <h2>One portal.<br />Every part of the journey.</h2>
            <div className="regal-season-rule" />
            <p>Built for schools, adjudicators, Advisory Committee members, and program Owners—with role-based access throughout.</p>
          </aside>
        </div>
      </section>

      <section className="regal-path-section">
        <div className="container">
          <div className="regal-section-heading"><p className="eyebrow">Designed for the full awards process</p><h2>A clear path for every participant.</h2></div>
          <div className="regal-path-grid">{portalPaths.map((path) => <article className="regal-path-card" key={path.title}><span>{path.number}</span><h3>{path.title}</h3><p>{path.copy}</p></article>)}</div>
        </div>
      </section>

      <section className="regal-callout"><div className="container regal-callout-inner"><div><p className="eyebrow">Ready for the season?</p><h2>Step into the GHSMTA Awards Portal.</h2></div><div className="button-row"><Link className="button button-gold" href="/signup">Create school account</Link><Link className="button button-ghost-gold" href="/login">Sign in securely</Link></div></div></section>
      <footer className="regal-footer"><div className="container"><strong>Georgia High School Musical Theatre Awards</strong><span>Secure applications · Live scheduling · Collaborative adjudication</span></div></footer>
    </main>
  );
}
