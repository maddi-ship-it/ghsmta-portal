import { MfaVerificationPanel } from "@/components/mfa-verification-panel";
import { requireProfile } from "@/lib/auth";

export default async function MfaVerifyPage() {
  await requireProfile(undefined, { enforceSecurity: false });
  return <main className="security-page safe-shell"><MfaVerificationPanel /></main>;
}
