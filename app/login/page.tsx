import Link from "next/link";

import { AuthSignInPanel } from "@/components/auth-sign-in-panel";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="auth-page safe-shell auth-page-regal">
      <section className="auth-art auth-art-regal">
        <Link href="/" className="brand auth-brand">
          <span className="brand-mark">G</span>
          <span className="brand-copy">
            GHSMTA<small>Awards Portal</small>
          </span>
        </Link>
        <div className="auth-stage-light auth-stage-light-one" />
        <div className="auth-stage-light auth-stage-light-two" />
        <div className="auth-art-copy">
          <p className="eyebrow">Georgia High School Musical Theatre Awards</p>
          <h1>Welcome back to the awards portal.</h1>
          <p>
            Continue a school application, prepare an adjudication, or manage
            the current GHSMTA season from one secure workspace.
          </p>
        </div>
      </section>
      <section className="auth-panel">
        <AuthSignInPanel
          initialError={params.error}
          initialMessage={params.message}
        />
      </section>
    </main>
  );
}
