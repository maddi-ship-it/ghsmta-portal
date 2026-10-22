"use client";

import { useEffect } from "react";

import { recordPortalErrorBoundary } from "@/lib/portal-error-diagnostics";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    recordPortalErrorBoundary(error);
  }, [error]);

  return (
    <main className="system-state-page safe-shell">
      <section className="system-state-card" role="alert">
        <span className="eyebrow">Something went wrong</span>
        <h1>We could not finish that request.</h1>
        <p>Your saved work is still available. Try the request again, or return to the portal.</p>
        <div className="button-row">
          <button className="button button-primary" onClick={reset} type="button">Try again</button>
          <a className="button button-secondary" href="/portal">Return to portal</a>
        </div>
      </section>
    </main>
  );
}
