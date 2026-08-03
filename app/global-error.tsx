"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="system-state-page safe-shell">
          <section className="system-state-card" role="alert">
            <h1>The GHSMTA Portal needs to reload.</h1>
            <p>Try reloading this page. No submitted information has been changed.</p>
            <button className="button button-primary" onClick={reset} type="button">Reload portal</button>
          </section>
        </main>
      </body>
    </html>
  );
}
