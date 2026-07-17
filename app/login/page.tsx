import Link from "next/link";
import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="auth-page safe-shell">
      <section className="auth-art">
        <Link href="/" className="brand" style={{ position: "absolute", top: 34, left: 34 }}>
          <span className="brand-mark">G</span>
          <span className="brand-copy">GHSMTA<small>Awards Portal</small></span>
        </Link>
        <div className="auth-art-copy">
          <p className="eyebrow">Welcome back</p>
          <h1>Your awards portal.</h1>
          <p>Continue an application, review assigned productions, or manage the current awards cycle.</p>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <h2>Sign in</h2>
          <p>Enter the email and password associated with your portal account.</p>
          {params.error && <div className="form-error">We could not sign you in. Check your information and try again.</div>}
          {params.message && <div className="notice">{params.message}</div>}
          <form action={login} className="form-stack" style={{ marginTop: 18 }}>
            <div className="field">
              <label htmlFor="email">Email address</label>
              <input className="input" id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            <button className="button button-dark" type="submit">Sign in</button>
          </form>
          <p className="auth-links">Applying for the first time? <Link href="/signup">Create an applicant account</Link></p>
        </div>
      </section>
    </main>
  );
}
