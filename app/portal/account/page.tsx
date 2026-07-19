import { AccountSettingsPanel } from "@/components/account-settings-panel";
import { requireProfile } from "@/lib/auth";

export default async function AccountPage() {
  const profile = await requireProfile();
  return (
    <div className="page-stack">
      <header className="page-heading"><div><p className="eyebrow">Account</p><h1>Account settings</h1><p>Manage contact details, notifications, password, and multi-factor authentication.</p></div></header>
      <AccountSettingsPanel profile={profile} />
    </div>
  );
}
