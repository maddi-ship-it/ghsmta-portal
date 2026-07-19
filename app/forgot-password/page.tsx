import Link from "next/link";

import { requestPasswordReset } from "./actions";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="auth-page safe-shell">
      <section className="auth-art">
        <Link className="brand" href="/" style={{ position: "absolute", top: 34, left: 34 }}>
          <span className="brand-mark">G</span>
          <span className="brand-copy">GHSMTA<small>Awards Portal</small></span>
        </Link>
        <div className="auth-art-copy">
          <p className="eyebrow">Account recovery</p>
          <h1>Reset your password.</h1>
          <p>We will send a secure password-reset link to the email associated with your portal account.</p>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <h2>Forgot password</h2>
          {params.sent ? (
            <div className="notice">If an account exists for that email, a password-reset link has been sent.</div>
          ) : (
            <form action={requestPasswordReset} className="form-stack" style={{ marginTop: 18 }}>
              {params.error && <div className="form-error">Enter your email address.</div>}
              <div className="field">
                <label htmlFor="email">Email address</label>
                <input autoComplete="email" className="input" id="email" name="email" required type="email" />
              </div>
              <button className="button button-dark" type="submit">Send reset link</button>
            </form>
          )}
          <p className="auth-links"><Link href="/login">Return to sign in</Link></p>
        </div>
      </section>
    </main>
  );
}
