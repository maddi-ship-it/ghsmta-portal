import Link from "next/link";
import { redirect } from "next/navigation";

import { GlobalFeedbackDialog } from "@/components/global-feedback-dialog";
import { PortalHeader } from "@/components/portal-header";
import { requireProfile } from "@/lib/auth";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  if (profile.force_password_reset) redirect("/update-password?forced=1");

  const graceDeadline = profile.mfa_grace_until ? new Date(profile.mfa_grace_until) : null;
  const showMfaGrace = Boolean(profile.mfa_required && graceDeadline);

  return (
    <div className="portal-shell">
      <PortalHeader profile={profile} />
      {showMfaGrace && graceDeadline && (
        <div className="security-grace-banner">
          <div className="container"><span>Multi-factor authentication is required for your role by {graceDeadline.toLocaleDateString("en-US", { dateStyle: "medium" })}.</span><Link href="/portal/account">Set it up now</Link></div>
        </div>
      )}
      <main className="portal-main"><div className="container">{children}</div></main>
      <GlobalFeedbackDialog profile={profile} />
    </div>
  );
}
