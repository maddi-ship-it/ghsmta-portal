"use client";

export default function PortalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="panel system-state-card" role="alert">
      <span className="eyebrow">Portal error</span>
      <h1>This workspace could not be loaded.</h1>
      <p>Try again. If the problem continues, send Feedback so an Owner can follow up.</p>
      <button className="button button-primary" onClick={reset} type="button">Try again</button>
    </section>
  );
}
