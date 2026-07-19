import { redirect } from "next/navigation";

import { PortalHeader } from "@/components/portal-header";
import { requireProfile } from "@/lib/auth";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();

  if (profile.force_password_reset) {
    redirect("/update-password?forced=1");
  }

  return (
    <div className="portal-shell">
      <PortalHeader profile={profile} />
      <main className="portal-main"><div className="container">{children}</div></main>
    </div>
  );
}
