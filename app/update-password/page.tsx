import Link from "next/link";

import { updatePassword } from "./actions";

export default async function UpdatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; forced?: string }>;
}) {
  const params = await searchParams;
  const message =
    params.error === "length"
      ? "Passwords must be at least eight characters."
      : params.error === "match"
        ? "The passwords do not match."
        : params.error
          ? "The password could not be updated. Request a fresh reset link and try again."
          : null;

  return (
    <main className="auth-page safe-shell">
      <section className="auth-art">
        <Link className="brand" href="/" style={{ position: "absolute", top: 34, left: 34 }}>
          <span className="brand-mark">G</span>
          <span className="brand-copy">GHSMTA<small>Awards Portal</small></span>
        </Link>
        <div className="auth-art-copy">
          <p className="eyebrow">Account security</p>
          <h1>Choose a new password.</h1>
          <p>{params.forced ? "An Owner requires this account to reset its password before continuing." : "Enter a new password for your portal account."}</p>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <h2>Update password</h2>
          {message && <div className="form-error">{message}</div>}
          <form action={updatePassword} className="form-stack" style={{ marginTop: 18 }}>
            <div className="field">
              <label htmlFor="password">New password</label>
              <input autoComplete="new-password" className="input" id="password" name="password" required type="password" />
            </div>
            <div className="field">
              <label htmlFor="password_confirmation">Confirm password</label>
              <input autoComplete="new-password" className="input" id="password_confirmation" name="password_confirmation" required type="password" />
            </div>
            <button className="button button-dark" type="submit">Save new password</button>
          </form>
        </div>
      </section>
    </main>
  );
}
