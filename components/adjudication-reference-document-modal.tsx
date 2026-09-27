"use client";

import { useEffect, useState } from "react";

import type { AdjudicationReferenceLink } from "@/lib/adjudication-reference-documents";

export function AdjudicationReferenceDocumentModal({
  buttonClassName,
  links,
}: {
  buttonClassName: string;
  links: AdjudicationReferenceLink[];
}) {
  const [activeLink, setActiveLink] =
    useState<AdjudicationReferenceLink | null>(null);

  useEffect(() => {
    if (!activeLink) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveLink(null);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [activeLink]);

  if (links.length === 0) return null;

  return (
    <>
      {links.map((link) => (
        <button
          className={buttonClassName}
          key={link.key}
          onClick={() => setActiveLink(link)}
          title={link.fileName}
          type="button"
        >
          {link.label}
        </button>
      ))}

      {activeLink && (
        <div
          className="application-reference-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setActiveLink(null);
          }}
          role="presentation"
        >
          <section
            aria-labelledby="adjudication-reference-document-title"
            aria-modal="true"
            className="application-reference-modal adjudication-pdf-modal"
            role="dialog"
          >
            <header className="application-reference-modal-header">
              <div>
                <span className="eyebrow">Adjudication reference</span>
                <h2 id="adjudication-reference-document-title">
                  {activeLink.label}
                </h2>
                <p>{activeLink.fileName}</p>
              </div>
              <button
                aria-label={`Close ${activeLink.label}`}
                className="application-reference-close"
                onClick={() => setActiveLink(null)}
                type="button"
              >
                ×
              </button>
            </header>
            <div className="application-reference-modal-body adjudication-pdf-modal-body">
              <iframe
                className="adjudication-pdf-frame"
                src={activeLink.href}
                title={activeLink.label}
              />
            </div>
          </section>
        </div>
      )}
    </>
  );
}
