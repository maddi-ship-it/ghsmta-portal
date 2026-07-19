import Link from "next/link";

import { signup } from "./actions";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="regal-auth-shell">
      <section className="regal-auth-hero">
        <Link href="/" className="regal-brand">
          <span className="regal-brand-mark">G</span>
          <span>
            <strong>GHSMTA</strong>
            <small>Awards Portal</small>
          </span>
        </Link>

        <div className="regal-auth-copy">
          <p className="eyebrow">2026–2027 season</p>
          <h1>Create your school&apos;s secure portal account.</h1>
          <p>
            Submit applications, choose adjudication times, upload program
            materials, and communicate with the GHSMTA team from one place.
          </p>
        </div>
      </section>

      <section className="regal-auth-panel">
        <div className="regal-auth-card">
          <p className="eyebrow">School applicants</p>
          <h2>Create account</h2>
          <p>
            Use the primary school contact&apos;s information. A verified mobile
            number is required for account recovery and secure sign-in.
          </p>

          {params.error && (
            <div className="form-error">
              Please verify each field. Passwords must be at least eight
              characters, and the mobile number must include area code.
            </div>
          )}

          <form action={signup} className="form-stack" style={{ marginTop: 20 }}>
            <div className="field">
              <label htmlFor="full_name">Full name</label>
              <input
                className="input"
                id="full_name"
                name="full_name"
                autoComplete="name"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="email">Email address</label>
              <input
                className="input"
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="phone">Mobile number</label>
              <input
                className="input"
                id="phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                placeholder="(404) 555-1234"
                required
              />
              <small>US numbers are stored securely as +1 followed by ten digits.</small>
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                className="input"
                id="password"
                name="password"
                type="password"
                minLength={8}
                autoComplete="new-password"
                required
              />
            </div>

            <button className="button button-gold" type="submit">
              Create applicant account
            </button>
          </form>

          <p className="auth-links">
            Already registered? <Link href="/login">Sign in</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
