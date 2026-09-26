import Link from "next/link";

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
          {links.map((link) => (
            <a
              className="button button-secondary button-compact"
              href={link.href}
              key={link.key}
              rel="noreferrer"
              target="_blank"
              title={link.fileName}
            >
              {link.label}
            </a>
          ))}
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
