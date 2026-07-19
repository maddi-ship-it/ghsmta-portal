"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { normalizePhoneE164 } from "@/lib/phone";
import { createClient } from "@/lib/supabase/client";

export function PhoneVerificationPanel({ initialPhone }: { initialPhone?: string | null }) {
  const router = useRouter();
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    const normalized = normalizePhoneE164(phone);
    if (!normalized) {
      setError("Enter a valid mobile number with area code.");
      return;
    }

    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ phone: normalized });
    setBusy(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setPhone(normalized);
    setStep("code");
    setMessage("A six-digit verification code was sent by text message.");
  }

  async function verifyCode() {
    const normalized = normalizePhoneE164(phone);
    if (!normalized || code.trim().length < 6) {
      setError("Enter the six-digit verification code.");
      return;
    }

    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone: normalized,
      token: code.trim(),
      type: "phone_change",
    });

    if (verifyError) {
      setBusy(false);
      setError(verifyError.message);
      return;
    }

    const { error: syncError } = await supabase.rpc("sync_my_verified_phone", {
      p_phone_e164: normalized,
    });
    setBusy(false);

    if (syncError) {
      setError(syncError.message);
      return;
    }

    router.replace("/portal");
    router.refresh();
  }

  return (
    <div className="regal-auth-card">
      <p className="eyebrow">Account security</p>
      <h1>Verify your mobile number</h1>
      <p>
        GHSMTA uses this number for secure sign-in, account recovery, and optional
        time-sensitive program alerts.
      </p>

      {message && <div className="notice-banner success-banner">{message}</div>}
      {error && <div className="form-error">{error}</div>}

      {step === "phone" ? (
        <div className="form-stack">
          <div className="field">
            <label htmlFor="verify_phone">Mobile number</label>
            <input
              className="input"
              id="verify_phone"
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="(404) 555-1234"
            />
          </div>
          <button className="button button-gold" type="button" onClick={sendCode} disabled={busy}>
            {busy ? "Sending…" : "Text verification code"}
          </button>
        </div>
      ) : (
        <div className="form-stack">
          <div className="field">
            <label htmlFor="verify_phone_code">Six-digit code</label>
            <input
              className="input auth-code-input"
              id="verify_phone_code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            />
          </div>
          <button className="button button-gold" type="button" onClick={verifyCode} disabled={busy}>
            {busy ? "Verifying…" : "Verify and continue"}
          </button>
          <button className="button button-secondary" type="button" onClick={() => setStep("phone")}>
            Change number or resend code
          </button>
        </div>
      )}
    </div>
  );
}
