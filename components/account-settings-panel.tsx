"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import { updateAccountDetails, type AccountActionResult } from "@/app/portal/account/actions";
import { MfaManager } from "@/components/mfa-manager";
import { ThemeToggle } from "@/components/theme-toggle";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

const INITIAL_STATE: AccountActionResult = { ok: false };

export function AccountSettingsPanel({ profile }: { profile: Profile }) {
  const [state, action, pending] = useActionState(updateAccountDetails, INITIAL_STATE);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const preferences = profile.notification_preferences ?? {};

  async function updatePassword() {
    setPasswordError(null);
    setPasswordMessage(null);
    if (password.length < 8 || password !== confirmPassword) {
      setPasswordError("Passwords must match and contain at least eight characters.");
      return;
    }
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setPasswordError(error.message);
      return;
    }
    setPassword("");
    setConfirmPassword("");
    setPasswordMessage("Password updated.");
  }

  return (
    <div className="settings-workspace">
      <section className="settings-section">
        <p className="eyebrow">Profile</p>
        <h2>Account details</h2>
        <p>Keep your contact and notification information current.</p>

        {state.error && <div className="form-error">{state.error}</div>}
        {state.message && <div className="notice-banner success-banner">{state.message}</div>}

        <form action={action} className="form-stack">
          <div className="form-grid two-column-form">
            <div className="field"><label htmlFor="account_full_name">Full name</label><input className="input" id="account_full_name" name="full_name" defaultValue={profile.full_name ?? ""} required /></div>
            <div className="field"><label htmlFor="account_preferred_name">Preferred name</label><input className="input" id="account_preferred_name" name="preferred_name" defaultValue={profile.preferred_name ?? ""} /></div>
            <div className="field"><label htmlFor="account_pronouns">Pronouns <span>Optional</span></label><input className="input" id="account_pronouns" name="pronouns" defaultValue={profile.pronouns ?? ""} /></div>
            <div className="field"><label htmlFor="account_organization">School or organization</label><input className="input" id="account_organization" name="organization" defaultValue={profile.organization ?? ""} /></div>
            <div className="field"><label htmlFor="account_email">Email</label><input className="input" id="account_email" value={profile.email ?? ""} readOnly /></div>
            <div className="field"><label htmlFor="account_phone">Mobile number</label><input className="input" id="account_phone" name="phone_e164" type="tel" defaultValue={profile.phone_e164 ?? ""} required /><small>{profile.phone_verified_at ? "Verified" : "Verification required"}</small></div>
          </div>

          <div className="notification-choice-grid">
            <label className="check-row"><input type="checkbox" name="notify_email" defaultChecked={preferences.email !== false} /> Email notifications</label>
            <label className="check-row"><input type="checkbox" name="notify_sms" defaultChecked={preferences.sms === true} /> Text-message notifications</label>
            <label className="check-row"><input type="checkbox" checked readOnly /> In-app notifications</label>
          </div>

          <div className="button-row">
            <button className="button button-gold" type="submit" disabled={pending}>{pending ? "Saving…" : "Save account details"}</button>
            {!profile.phone_verified_at && <Link className="button button-secondary" href="/verify-phone">Verify mobile number</Link>}
          </div>
        </form>
      </section>

      <section className="settings-section">
        <p className="eyebrow">Password</p>
        <h2>Change password</h2>
        {passwordError && <div className="form-error">{passwordError}</div>}
        {passwordMessage && <div className="notice-banner success-banner">{passwordMessage}</div>}
        <div className="form-grid two-column-form">
          <div className="field"><label htmlFor="new_account_password">New password</label><input className="input" id="new_account_password" type="password" minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></div>
          <div className="field"><label htmlFor="confirm_account_password">Confirm password</label><input className="input" id="confirm_account_password" type="password" minLength={8} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></div>
        </div>
        <button className="button button-secondary" type="button" onClick={updatePassword}>Update password</button>
      </section>

      <section className="settings-section">
        <p className="eyebrow">Appearance</p>
        <h2>Portal theme</h2>
        <p>
          Choose the appearance that is most comfortable on this browser.
          Your selection is remembered on this device.
        </p>
        <ThemeToggle variant="setting" />
      </section>

      <MfaManager verifiedPhone={profile.phone_verified_at ? profile.phone_e164 : null} />
    </div>
  );
}
