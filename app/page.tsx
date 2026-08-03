import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "GHSMTA Awards Portal",
  description:
    "The secure home for Georgia High School Musical Theatre Awards applications, scheduling, adjudication, and school communication.",
};

export default function LandingPage() {
  return (
    <main className="public-home public-home-calm safe-shell">
      <header className="public-home-header">
        <div className="container public-home-nav">
          <Link className="public-home-brand" href="/" aria-label="GHSMTA home">
            <Image
              alt=""
              className="public-home-brand-icon"
              height={48}
              loading="eager"
              src="/ghsmta-icon-512.png"
              width={48}
            />
            <span>
              <strong>GHSMTA</strong>
              <small>Awards Portal</small>
            </span>
          </Link>

          <nav className="public-home-nav-actions" aria-label="Primary navigation">
            <Link className="public-home-nav-choice" href="/login">
              SIGN IN
            </Link>
            <Link className="public-home-nav-choice is-primary" href="/signup">
              SIGN-UP
            </Link>
            <Link className="public-home-nav-choice" href="/staff-signup">
              STAFF SIGN UP
            </Link>
          </nav>
        </div>
      </header>

      <section className="public-home-calm-hero">
        <div className="container public-home-calm-hero-inner">
          <h1>The entire season, all in one place.</h1>
          <p>
            A secure, shared home for applications, scheduling, communication,
            adjudication, and results.
          </p>
          <div className="public-home-hero-actions">
            <Link className="public-home-button public-home-button-primary" href="/signup">
              Start an application <span aria-hidden="true">→</span>
            </Link>
            <Link className="public-home-button public-home-button-secondary" href="/login">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <footer className="public-home-footer public-home-calm-footer">
        <div className="container public-home-footer-grid">
          <div>
            <Link className="public-home-brand" href="/" aria-label="GHSMTA home">
              <Image
                alt=""
                className="public-home-brand-icon"
                height={44}
                src="/ghsmta-icon-512.png"
                width={44}
              />
              <span>
                <strong>GHSMTA</strong>
                <small>Awards Portal</small>
              </span>
            </Link>
            <p>
              Celebrating excellence in Georgia high school musical theatre. ·{" "}
              <Link href="/privacy">Privacy &amp; data use</Link>
            </p>
          </div>

          <div className="public-home-presented-by">
            <span>Presented by</span>
            <span className="public-home-artsbridge-logo">
              <Image
                alt="ArtsBridge Foundation"
                height={43}
                src="/artsbridge-foundation-logo.png"
                width={190}
              />
            </span>
          </div>
        </div>
      </footer>
    </main>
  );
}
