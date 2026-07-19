"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createClient } from "@/lib/supabase/client";

type Factor = {
  id: string;
  friendly_name?: string;
  factor_type: "totp" | "phone" | "webauthn";
  status: "verified" | "unverified";
};

type Enrollment = {
  id: string;
  type: "totp" | "phone";
  challengeId?: string;
  qrCode?: string;
  secret?: string;
};

export function MfaManager({ verifiedPhone }: { verifiedPhone?: string | null }) {
  const supabase = useMemo(() => createClient(), []);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadFactors = useCallback(async () => {
    const { data, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) {
      setError(listError.message);
      return;
    }
    setFactors([...data.totp, ...data.phone] as Factor[]);
  }, [supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadFactors();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadFactors]);

  async function startTotp() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "GHSMTA Authenticator",
      issuer: "GHSMTA Awards Portal",
    });
    setBusy(false);
    if (enrollError) {
      setError(enrollError.message);
      return;
    }
    setEnrollment({
      id: data.id,
      type: "totp",
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    });
  }

  async function startPhone() {
    if (!verifiedPhone) {
      setError("Verify a mobile number in Account Details before adding text-message MFA.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "phone",
      phone: verifiedPhone,
      friendlyName: "GHSMTA Mobile",
    });

    if (enrollError) {
      setBusy(false);
      setError(enrollError.message);
      return;
    }

    const { data: challenge, error: challengeError } =
      await supabase.auth.mfa.challenge({
        factorId: data.id,
        channel: "sms",
      });

    setBusy(false);
    if (challengeError) {
      setError(challengeError.message);
      return;
    }

    setEnrollment({
      id: data.id,
      type: "phone",
      challengeId: challenge.id,
    });
    setMessage("A multi-factor verification code was sent by text message.");
  }

  async function verifyEnrollment() {
    if (!enrollment || code.trim().length < 6) {
      setError("Enter the verification code.");
      return;
    }

    setBusy(true);
    setError(null);

    const verification =
      enrollment.type === "phone"
        ? enrollment.challengeId
          ? await supabase.auth.mfa.verify({
              factorId: enrollment.id,
              challengeId: enrollment.challengeId,
              code: code.trim(),
            })
          : { error: new Error("Request a new text-message verification code.") }
        : await supabase.auth.mfa.challengeAndVerify({
            factorId: enrollment.id,
            code: code.trim(),
          });

    setBusy(false);
    if (verification.error) {
      setError(verification.error.message);
      return;
    }

    setEnrollment(null);
    setCode("");
    setMessage("Multi-factor authentication is active.");
    await loadFactors();
  }

  async function removeFactor(factorId: string) {
    setBusy(true);
    setError(null);
    const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId });
    setBusy(false);
    if (removeError) {
      setError(removeError.message);
      return;
    }
    setMessage("Security factor removed.");
    await loadFactors();
  }

  return (
    <section className="settings-section">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Account security</p>
          <h2>Multi-factor authentication</h2>
          <p>
            Authenticator-app MFA is recommended. Text-message MFA uses your
            verified mobile number.
          </p>
        </div>
      </div>

      {message && <div className="notice-banner success-banner">{message}</div>}
      {error && <div className="form-error">{error}</div>}

      <div className="factor-list">
        {factors
          .filter((factor) => factor.status === "verified")
          .map((factor) => (
            <div className="factor-row" key={factor.id}>
              <div>
                <strong>{factor.friendly_name ?? "Security factor"}</strong>
                <small>
                  {factor.factor_type === "totp"
                    ? "Authenticator app"
                    : "Text message"}
                </small>
              </div>
              <button
                className="button button-danger button-compact"
                type="button"
                onClick={() => void removeFactor(factor.id)}
                disabled={busy}
              >
                Remove
              </button>
            </div>
          ))}
        {factors.filter((factor) => factor.status === "verified").length === 0 && (
          <p className="empty-note">No verified MFA factor is enrolled yet.</p>
        )}
      </div>

      {!enrollment && (
        <div className="button-row">
          <button
            className="button button-gold"
            type="button"
            onClick={startTotp}
            disabled={busy}
          >
            Add authenticator app
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={startPhone}
            disabled={busy || !verifiedPhone}
          >
            Add text-message MFA
          </button>
        </div>
      )}

      {enrollment && (
        <div className="mfa-enrollment-card">
          {enrollment.type === "totp" && enrollment.qrCode && (
            <>
              <p>
                Scan this code with an authenticator app, then enter the
                six-digit code it generates.
              </p>
              {/* Supabase returns a data URL-safe SVG payload. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="mfa-qr-code"
                src={enrollment.qrCode}
                alt="Authenticator enrollment QR code"
              />
              <p className="mfa-secret">
                <span>Manual setup key</span>
                <code>{enrollment.secret}</code>
              </p>
            </>
          )}
          <div className="field">
            <label htmlFor="mfa_enroll_code">Verification code</label>
            <input
              className="input auth-code-input"
              id="mfa_enroll_code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, ""))
              }
            />
          </div>
          <div className="button-row">
            <button
              className="button button-gold"
              type="button"
              onClick={verifyEnrollment}
              disabled={busy}
            >
              Verify factor
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                setEnrollment(null);
                setCode("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
