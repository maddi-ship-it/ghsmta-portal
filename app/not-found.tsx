import Link from "next/link";

export default function NotFound() {
  return (
    <main className="system-state-page safe-shell">
      <section className="system-state-card">
        <span className="eyebrow">404</span>
        <h1>That page is not on the program.</h1>
        <p>The link may have expired or the item may no longer be available.</p>
        <Link className="button button-primary" href="/portal">Return to portal</Link>
      </section>
    </main>
  );
}
