import Link from "next/link";

export const metadata = { title: "Privacy & Data Use" };

export default function PrivacyPage() {
  return (
    <main className="public-policy-page safe-shell">
      <article className="public-policy-card">
        <Link className="regal-brand policy-brand" href="/">
          <span className="regal-brand-mark">G</span>
          <span><strong>GHSMTA</strong><small>Awards Portal</small></span>
        </Link>
        <span className="eyebrow">Privacy &amp; data use</span>
        <h1>How portal information is used</h1>
        <p>Last updated August 2, 2026</p>

        <h2>Program records</h2>
        <p>The portal stores account, application, scheduling, adjudication, messaging, file, billing, and audit records needed to operate the Georgia High School Musical Theatre Awards. Access is limited by assigned role and school or panel relationship.</p>

        <h2>Voice dictation and handwritten notes</h2>
        <p>When you choose Dictate or Scan notes, the selected audio or image is sent to the portal’s configured AI transcription provider to create editable text. The portal does not save the source audio or image from these tools. Review the generated text before inserting it, and do not submit information that is unrelated to GHSMTA work.</p>

        <h2>Files and chat</h2>
        <p>Uploaded files and chat messages are stored in private program workspaces. Message deletions retain an Owner-visible audit record. Do not upload sensitive personal information unless the program specifically requests it.</p>

        <h2>Billing</h2>
        <p>Invoices, scholarship confirmations, payment links, payment status, receipts, and delivery history are retained as program financial records. Payment card details are handled by the linked payment provider and are not collected by this portal.</p>

        <h2>Questions or corrections</h2>
        <p>Use the portal Feedback tool or contact the ArtsBridge Foundation program team to request help with access, correction, or appropriate removal of information.</p>

        <div className="button-row">
          <Link className="button button-primary" href="/login">Sign in</Link>
          <Link className="button button-secondary" href="/">Return home</Link>
        </div>
      </article>
    </main>
  );
}
