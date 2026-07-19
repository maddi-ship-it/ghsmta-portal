import Link from "next/link";

import { MfaManager } from "@/components/mfa-manager";
import { requireProfile } from "@/lib/auth";

export default async function MfaEnrollPage() {
  const profile = await requireProfile(undefined, { enforceSecurity: false });
  return (
    <main className="security-page safe-shell">
      <div className="security-page-card">
        <Link href="/" className="regal-brand compact-regal-brand"><span className="regal-brand-mark">G</span><span><strong>GHSMTA</strong><small>Awards Portal</small></span></Link>
        <h1>Protect your portal account</h1>
        <p>Your role requires multi-factor authentication. Add at least one factor to continue.</p>
        <MfaManager verifiedPhone={profile.phone_verified_at ? profile.phone_e164 : null} />
        <Link className="button button-gold" href="/portal">Continue to portal</Link>
      </div>
    </main>
  );
}
