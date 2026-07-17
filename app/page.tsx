import Link from "next/link";

const features = [
  {
    icon: "01",
    title: "One application home",
    copy: "Schools can save progress, return throughout the cycle, and see exactly what remains before submission.",
  },
  {
    icon: "02",
    title: "Assignment-based review",
    copy: "Adjudicators only receive the productions assigned to them, with permissions enforced at the database level.",
  },
  {
    icon: "03",
    title: "Year-over-year continuity",
    copy: "Cycles, applications, assignments, and audit history stay organized without losing prior-season records.",
  },
];

export default function LandingPage() {
  return (
    <main className="safe-shell">
      <header className="public-header">
        <div className="container public-nav">
          <Link href="/" className="brand" aria-label="GHSMTA home">
            <span className="brand-mark">G</span>
            <span className="brand-copy">
              GHSMTA
              <small>Awards Portal</small>
            </span>
          </Link>
          <nav className="nav-actions" aria-label="Primary navigation">
            <Link className="button button-secondary" href="/login">Staff sign in</Link>
            <Link className="button button-primary" href="/signup">Start an application</Link>
          </nav>
        </div>
      </header>

      <section className="hero">
        <div className="container hero-grid">
          <div>
            <p className="eyebrow">Georgia High School Musical Theatre Awards</p>
            <h1>Celebrating the next generation of theatre artists.</h1>
            <p className="hero-lede">
              A secure home for school applications, adjudication assignments,
              and awards-cycle administration—designed for every screen.
            </p>
            <div className="hero-actions">
              <Link className="button button-primary" href="/signup">Begin your application</Link>
              <Link className="button button-secondary" href="/login">Continue or sign in</Link>
            </div>
          </div>

          <aside className="hero-card" aria-label="Application process">
            <div className="hero-card-top">
              <div>
                <div className="hero-card-label">Awards cycle</div>
                <strong>Application pathway</strong>
              </div>
              <span className="status-dot" />
            </div>
            <div className="timeline">
              <div className="timeline-item">
                <span className="timeline-number">1</span>
                <div><strong>Create your school profile</strong><span>Use one account to manage the production application.</span></div>
              </div>
              <div className="timeline-item">
                <span className="timeline-number">2</span>
                <div><strong>Complete the application</strong><span>Save progress and return before the cycle deadline.</span></div>
              </div>
              <div className="timeline-item">
                <span className="timeline-number">3</span>
                <div><strong>Submit for review</strong><span>Track status and receive program communications in one place.</span></div>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-heading">
            <p className="eyebrow">Built around the awards process</p>
            <h2>Clear access for every participant.</h2>
            <p>
              Applicants, adjudicators, advisory members, and program owners each
              see the tools and records appropriate to their role.
            </p>
          </div>
          <div className="feature-grid">
            {features.map((feature) => (
              <article className="feature-card" key={feature.title}>
                <span className="feature-icon">{feature.icon}</span>
                <h3>{feature.title}</h3>
                <p>{feature.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <footer className="public-footer">
        <div className="container public-footer-inner">
          <strong>Georgia High School Musical Theatre Awards</strong>
          <span>Secure application and adjudication portal</span>
        </div>
      </footer>
    </main>
  );
}
