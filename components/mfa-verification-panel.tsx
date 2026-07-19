"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

type Factor = {
  id: string;
  friendly_name?: string;
  factor_type: "totp" | "phone" | "webauthn";
  status: "verified" | "unverified";
};

export function MfaVerificationPanel() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [factorId, setFactorId] = useState("");
  const [phoneChallengeId, setPhoneChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.mfa.listFactors().then(({ data, error: listError }) => {
      if (listError) {
        setError(listError.message);
        return;
      }
      const available = [...data.totp, ...data.phone].filter(
        (factor) => factor.status === "verified",
      ) as Factor[];
      setFactors(available);
      setFactorId(available[0]?.id ?? "");
    });
  }, [supabase]);

  const selectedFactor = factors.find((factor) => factor.id === factorId);

  async function sendPhoneCode() {
    if (!selectedFactor || selectedFactor.factor_type !== "phone") return;

    setBusy(true);
    setError(null);
    setMessage(null);
    const { data, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: selectedFactor.id,
      channel: "sms",
    });
    setBusy(false);

    if (challengeError) {
      setError(challengeError.message);
      return;
    }

    setPhoneChallengeId(data.id);
    setMessage("A fresh multi-factor code was sent by text message.");
  }

  async function verify() {
    if (!selectedFactor || code.trim().length < 6) {
      setError("Choose a security factor and enter its verification code.");
      return;
    }

    if (selectedFactor.factor_type === "phone" && !phoneChallengeId) {
      setError("Send a text-message code before verifying this factor.");
      return;
    }

    setBusy(true);
    setError(null);

    const verification =
      selectedFactor.factor_type === "phone"
        ? await supabase.auth.mfa.verify({
            factorId: selectedFactor.id,
            challengeId: phoneChallengeId!,
            code: code.trim(),
          })
        : await supabase.auth.mfa.challengeAndVerify({
            factorId: selectedFactor.id,
            code: code.trim(),
          });

    setBusy(false);
    if (verification.error) {
      setError(verification.error.message);
      return;
    }

    router.replace("/portal");
    router.refresh();
  }

  return (
    <div className="regal-auth-card">
      <p className="eyebrow">Multi-factor authentication</p>
      <h1>Complete secure sign-in</h1>
      <p>Use your authenticator app or registered phone factor.</p>
      {message && <div className="notice-banner success-banner">{message}</div>}
      {error && <div className="form-error">{error}</div>}
      <div className="form-stack">
        <div className="field">
          <label htmlFor="mfa_factor">Security factor</label>
          <select
            className="select"
            id="mfa_factor"
            value={factorId}
            onChange={(event) => {
              setFactorId(event.target.value);
              setPhoneChallengeId(null);
              setCode("");
              setError(null);
              setMessage(null);
            }}
          >
            {factors.map((factor) => (
              <option value={factor.id} key={factor.id}>
                {factor.friendly_name ??
                  (factor.factor_type === "totp"
                    ? "Authenticator app"
                    : "Text message")}
              </option>
            ))}
          </select>
        </div>

        {selectedFactor?.factor_type === "phone" && (
          <button
            className="button button-secondary"
            type="button"
            onClick={sendPhoneCode}
            disabled={busy}
          >
            {busy ? "Sending…" : phoneChallengeId ? "Resend text code" : "Text verification code"}
          </button>
        )}

        <div className="field">
          <label htmlFor="mfa_code">Verification code</label>
          <input
            className="input auth-code-input"
            id="mfa_code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          />
        </div>
        <button
          className="button button-gold"
          type="button"
          onClick={verify}
          disabled={
            busy ||
            factors.length === 0 ||
            (selectedFactor?.factor_type === "phone" && !phoneChallengeId)
          }
        >
          {busy ? "Verifying…" : "Verify and enter portal"}
        </button>
      </div>
    </div>
  );
}
