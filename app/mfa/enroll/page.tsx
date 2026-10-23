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
        <p>Multi-factor authentication is optional. Add a factor if you would like extra protection for your account.</p>
        <MfaManager verifiedPhone={profile.phone_verified_at ? profile.phone_e164 : null} />
        <Link className="button button-gold" href="/portal">Return to portal</Link>
      </div>
    </main>
  );
}
