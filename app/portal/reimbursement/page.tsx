import { safeEmbeddedDocumentUrl } from "@/lib/embedded-document";
import { requireProfile } from "@/lib/auth";

export default async function ReimbursementPage() {
  await requireProfile(["adjudicator", "advisory_member"]);

  const embedUrl = safeEmbeddedDocumentUrl(
    process.env.REIMBURSEMENT_DOCUMENT_URL,
  );

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Resources</span>
          <h1>REIMBURSEMENT</h1>
          <p>
            Review and complete the GHSMTA reimbursement document without
            leaving the portal.
          </p>
        </div>
      </header>

      <section className="panel embedded-document-panel">
        <div className="panel-body">
          <div className="embedded-document-heading">
            <div>
              <span className="eyebrow">Adjudicator &amp; ACM resource</span>
              <h2>Reimbursement document</h2>
              <p>
                Use the embedded document below for reimbursement information
                and submission.
              </p>
            </div>
            <span className="badge">Embedded document</span>
          </div>

          {embedUrl ? (
            <>
              <div className="embedded-document-frame-shell">
                <iframe
                  allowFullScreen
                  className="embedded-document-frame"
                  loading="lazy"
                  referrerPolicy="strict-origin-when-cross-origin"
                  src={embedUrl}
                  title="GHSMTA reimbursement document"
                />
              </div>
              <p className="embedded-document-fallback">
                Trouble viewing the document?{" "}
                <a href={embedUrl} target="_blank" rel="noreferrer noopener">
                  Open the reimbursement document in a new window
                </a>
                .
              </p>
            </>
          ) : (
            <div className="form-error" role="alert">
              The reimbursement document is not configured yet. Please contact
              GHSMTA support.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
