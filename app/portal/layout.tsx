import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { stopImpersonation } from "@/app/portal/impersonation/actions";
import { GlobalFeedbackDialog } from "@/components/global-feedback-dialog";
import { PortalHeader } from "@/components/portal-header";
import { PortalScrollManager } from "@/components/portal-scroll-manager";
import { ThemeProfileSync } from "@/components/theme-profile-sync";
import { requireProfile } from "@/lib/auth";
import {
  bannerStateFromImpersonation,
  IMPERSONATION_COOKIE_NAME,
  readImpersonationCookieValue,
} from "@/lib/impersonation";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  if (profile.force_password_reset) redirect("/update-password?forced=1");
  const cookieStore = await cookies();
  const impersonation = bannerStateFromImpersonation(
    readImpersonationCookieValue(cookieStore.get(IMPERSONATION_COOKIE_NAME)?.value),
  );

  return (
    <div className="portal-shell" data-portal-role={profile.role}>
      <ThemeProfileSync preference={profile.theme_preference ?? "system"} />
      <PortalScrollManager />
      <PortalHeader profile={profile} />
      {impersonation && (
        <div className="impersonation-banner">
          <div className="container">
            <span>
              Viewing as <strong>{impersonation.targetName ?? impersonation.targetEmail}</strong>
              {" "}for <strong>{impersonation.ownerName ?? impersonation.ownerEmail}</strong>
            </span>
            <form action={stopImpersonation}>
              <button className="button button-dark button-compact" type="submit">
                End impersonation
              </button>
            </form>
          </div>
        </div>
      )}
      <main className="portal-main"><div className="container">{children}</div></main>
      <GlobalFeedbackDialog profile={profile} />
    </div>
  );
}
