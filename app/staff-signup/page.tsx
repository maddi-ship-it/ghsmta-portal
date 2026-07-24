import Link from "next/link";

import { staffSignup } from "./actions";

const errorMessages: Record<string, string> = {
  invalid:
    "Please verify each field. Passwords must be at least eight characters, and the mobile number must include an area code.",
  "access-code":
    "The staff registration access code is not valid. Contact a GHSMTA Portal Owner for the current code.",
  exists:
    "An account may already exist for that email address. Try signing in or resetting the password.",
  unavailable:
    "Staff registration is not configured yet. A Portal Owner must add the staff access code in Vercel.",
  disabled:
    "Staff registration is temporarily closed. Contact a GHSMTA Portal Owner for assistance.",
  provision:
    "The account could not be assigned to the Adjudicator role. No account was retained; please try again or contact a Portal Owner.",
};

export default async function StaffSignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const errorMessage = params.error
    ? errorMessages[params.error] ?? errorMessages.invalid
    : null;

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
          <p className="eyebrow">2026-2027 season</p>
          <h1>Create your GHSMTA staff account.</h1>
          <p>
            Adjudicators use this secure account to manage assignments,
            review school materials, communicate with the GHSMTA team, and
            complete adjudication scorecards.
          </p>
        </div>
      </section>

      <section className="regal-auth-panel">
        <div className="regal-auth-card">
          <p className="eyebrow">Adjudicators and staff</p>
          <h2>Create staff account</h2>
          <p>
            Use your own contact information and the registration access code
            supplied by GHSMTA. This page creates an Adjudicator account, not
            a school Applicant account.
          </p>

          {errorMessage ? (
            <div className="form-error">{errorMessage}</div>
          ) : null}

          <form
            action={staffSignup}
            className="form-stack"
            style={{ marginTop: 20 }}
          >
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
              <small>
                Text verification is currently disabled, but the number is
                retained for account recovery and staff communication.
              </small>
            </div>

            <div className="field">
              <label htmlFor="access_code">Staff registration code</label>
              <input
                className="input"
                id="access_code"
                name="access_code"
                type="password"
                autoComplete="off"
                required
              />
              <small>
                This code is provided directly by a GHSMTA Portal Owner.
              </small>
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
              Create adjudicator account
            </button>
          </form>

          <p className="auth-links">
            Already registered? <Link href="/login">Sign in</Link>
          </p>
          <p className="auth-links">
            Registering a school? <Link href="/signup">Applicant signup</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
