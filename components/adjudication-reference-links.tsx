import Link from "next/link";

import { AdjudicationReferenceDocumentModal } from "@/components/adjudication-reference-document-modal";
import type { AdjudicationReferenceLink } from "@/lib/adjudication-reference-documents";

export function AdjudicationReferenceLinks({
  links,
}: {
  links: AdjudicationReferenceLink[];
}) {
  return (
    <section
      aria-label="Adjudication reference guides"
      className="panel adjudication-reference-panel"
    >
      <div className="panel-header">
        <div>
          <span className="eyebrow">Reference guides</span>
          <h2>Scoring resources</h2>
          <p>Keep the rubric and shared evaluation language open while you review.</p>
        </div>
        <div className="heading-actions">
          <AdjudicationReferenceDocumentModal
            buttonClassName="button button-secondary button-compact"
            links={links}
          />
          <Link
            className="button button-secondary button-compact"
            href="/portal/reference-documents"
          >
            All reference documents
          </Link>
        </div>
      </div>
    </section>
  );
}
