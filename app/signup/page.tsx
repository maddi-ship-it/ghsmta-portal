import Link from "next/link";
import { signup } from "./actions";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  return (
    <main className="auth-page safe-shell">
      <section className="auth-art">
        <Link href="/" className="brand" style={{ position: "absolute", top: 34, left: 34 }}>
          <span className="brand-mark">G</span>
          <span className="brand-copy">GHSMTA<small>Awards Portal</small></span>
        </Link>
        <div className="auth-art-copy">
          <p className="eyebrow">School applicants</p>
          <h1>Start with one secure account.</h1>
          <p>Your account will only have access to its own school application and related program updates.</p>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <h2>Create account</h2>
          <p>Use the primary contact information for your school&apos;s application.</p>
          {params.error && <div className="form-error">Please verify each field. Passwords must be at least eight characters.</div>}
          <form action={signup} className="form-stack" style={{ marginTop: 18 }}>
            <div className="field"><label htmlFor="full_name">Full name</label><input className="input" id="full_name" name="full_name" autoComplete="name" required /></div>
            <div className="field"><label htmlFor="email">Email address</label><input className="input" id="email" name="email" type="email" autoComplete="email" required /></div>
            <div className="field"><label htmlFor="password">Password</label><input className="input" id="password" name="password" type="password" minLength={8} autoComplete="new-password" required /></div>
            <button className="button button-dark" type="submit">Create applicant account</button>
          </form>
          <p className="auth-links">Already registered? <Link href="/login">Sign in</Link></p>
        </div>
      </section>
    </main>
  );
}
