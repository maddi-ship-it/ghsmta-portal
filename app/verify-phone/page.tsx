import Link from "next/link";

import { PhoneVerificationPanel } from "@/components/phone-verification-panel";
import { requireProfile } from "@/lib/auth";

export default async function VerifyPhonePage() {
  const profile = await requireProfile(undefined, { enforceSecurity: false });

  return (
    <main className="regal-auth-shell single-panel-auth">
      <section className="regal-auth-hero compact-auth-hero">
        <Link href="/" className="regal-brand">
          <span className="regal-brand-mark">G</span>
          <span><strong>GHSMTA</strong><small>Awards Portal</small></span>
        </Link>
        <div className="regal-auth-copy">
          <p className="eyebrow">One secure identity</p>
          <h2>Your school&apos;s work deserves protected access.</h2>
        </div>
      </section>
      <section className="regal-auth-panel">
        <PhoneVerificationPanel initialPhone={profile.phone_e164} />
      </section>
    </main>
  );
}
