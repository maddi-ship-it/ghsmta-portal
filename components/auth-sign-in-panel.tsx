"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { login } from "@/app/login/actions";
import { normalizePhoneE164 } from "@/lib/phone";
import { createClient } from "@/lib/supabase/client";

type LoginMethod = "password" | "magic" | "phone";

export function AuthSignInPanel({
  initialError,
  initialMessage,
}: {
  initialError?: string;
  initialMessage?: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [method, setMethod] = useState<LoginMethod>("password");
  const [phone, setPhone] = useState("");
  const [phoneCodeSent, setPhoneCodeSent] = useState(false);
  const [message, setMessage] = useState<string | null>(
    initialMessage ?? null,
  );
  const [error, setError] = useState<string | null>(
    initialError ? "We could not sign you in. Check your information and try again." : null,
  );
  const [pending, startTransition] = useTransition();

  function chooseMethod(nextMethod: LoginMethod) {
    setMethod(nextMethod);
    setError(null);
    setMessage(null);
    setPhoneCodeSent(false);
  }

  function sendMagicLink(form: HTMLFormElement) {
    const formData = new FormData(form);
    const email = String(formData.get("email") ?? "").trim();
    setError(null);
    setMessage(null);

    startTransition(async () => {
      const { error: magicError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/portal`,
        },
      });

      if (magicError) {
        setError(magicError.message);
        return;
      }

      form.reset();
      setMessage("Check your email for a secure sign-in link.");
    });
  }

  function sendPhoneCode(form: HTMLFormElement) {
    const formData = new FormData(form);
    setError(null);
    setMessage(null);

    startTransition(async () => {
      try {
        const normalized = normalizePhoneE164(
          String(formData.get("phone") ?? ""),
        );
        const { error: phoneError } = await supabase.auth.signInWithOtp({
          phone: normalized,
          options: { shouldCreateUser: false },
        });

        if (phoneError) throw phoneError;
        setPhone(normalized);
        setPhoneCodeSent(true);
        setMessage("A six-digit sign-in code was sent to your verified mobile number.");
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not send the phone sign-in code.",
        );
      }
    });
  }

  function verifyPhoneCode(form: HTMLFormElement) {
    const formData = new FormData(form);
    const token = String(formData.get("token") ?? "").trim();
    setError(null);
    setMessage(null);

    startTransition(async () => {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        phone,
        token,
        type: "sms",
      });

      if (verifyError) {
        setError(verifyError.message);
        return;
      }

      router.push("/portal");
      router.refresh();
    });
  }

  return (
    <div className="auth-card auth-card-regal">
      <span className="eyebrow">Secure portal access</span>
      <h2>Sign in</h2>
      <p>Choose the sign-in method that works best for your account.</p>

      <div className="auth-method-tabs" role="tablist" aria-label="Sign-in methods">
        <button
          aria-selected={method === "password"}
          className={method === "password" ? "active" : ""}
          onClick={() => chooseMethod("password")}
          role="tab"
          type="button"
        >
          Password
        </button>
        <button
          aria-selected={method === "magic"}
          className={method === "magic" ? "active" : ""}
          onClick={() => chooseMethod("magic")}
          role="tab"
          type="button"
        >
          Magic Link
        </button>
        <button
          aria-selected={method === "phone"}
          className={method === "phone" ? "active" : ""}
          onClick={() => chooseMethod("phone")}
          role="tab"
          type="button"
        >
          Text code
        </button>
      </div>

      {error && <div className="form-error">{error}</div>}
      {message && <div className="notice">{message}</div>}

      {method === "password" && (
        <form action={login} className="form-stack auth-method-form">
          <div className="field">
            <label htmlFor="email">Email address</label>
            <input
              autoComplete="email"
              className="input"
              id="email"
              name="email"
              required
              type="email"
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              autoComplete="current-password"
              className="input"
              id="password"
              name="password"
              required
              type="password"
            />
          </div>
          <button className="button button-primary" type="submit">
            Sign in
          </button>
          <Link className="text-button auth-forgot-link" href="/forgot-password">
            Forgot your password?
          </Link>
        </form>
      )}

      {method === "magic" && (
        <form
          className="form-stack auth-method-form"
          onSubmit={(event) => {
            event.preventDefault();
            sendMagicLink(event.currentTarget);
          }}
        >
          <div className="field">
            <label htmlFor="magic-email">Email address</label>
            <input
              autoComplete="email"
              className="input"
              id="magic-email"
              name="email"
              required
              type="email"
            />
            <small>We will email a one-time sign-in link. No password is required.</small>
          </div>
          <button className="button button-primary" disabled={pending} type="submit">
            {pending ? "Sending…" : "Email my sign-in link"}
          </button>
        </form>
      )}

      {method === "phone" && !phoneCodeSent && (
        <form
          className="form-stack auth-method-form"
          onSubmit={(event) => {
            event.preventDefault();
            sendPhoneCode(event.currentTarget);
          }}
        >
          <div className="field">
            <label htmlFor="phone-login">Verified mobile number</label>
            <input
              autoComplete="tel"
              className="input"
              id="phone-login"
              name="phone"
              placeholder="+14045551234"
              required
              type="tel"
            />
            <small>Phone sign-in works after the number has been verified in Account settings.</small>
          </div>
          <button className="button button-primary" disabled={pending} type="submit">
            {pending ? "Sending…" : "Text me a sign-in code"}
          </button>
        </form>
      )}

      {method === "phone" && phoneCodeSent && (
        <form
          className="form-stack auth-method-form"
          onSubmit={(event) => {
            event.preventDefault();
            verifyPhoneCode(event.currentTarget);
          }}
        >
          <div className="field">
            <label htmlFor="phone-token">Six-digit code</label>
            <input
              autoComplete="one-time-code"
              className="input auth-code-input"
              id="phone-token"
              inputMode="numeric"
              maxLength={6}
              name="token"
              pattern="[0-9]{6}"
              required
            />
          </div>
          <button className="button button-primary" disabled={pending} type="submit">
            {pending ? "Verifying…" : "Verify and sign in"}
          </button>
          <button
            className="text-button"
            onClick={() => setPhoneCodeSent(false)}
            type="button"
          >
            Use another number
          </button>
        </form>
      )}

      <p className="auth-links">
        Applying for the first time? <Link href="/signup">Create an applicant account</Link>
      </p>
    </div>
  );
}
