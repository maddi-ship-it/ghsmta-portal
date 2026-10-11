"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  SpecialtyAwardWorkspace,
  type SpecialtyAwardRecommendation,
} from "@/components/specialty-award-workspace";

export function SpecialtyAwardModal({
  applicationId,
  currentUserId,
  recommendations,
}: {
  applicationId: string;
  currentUserId: string;
  recommendations: SpecialtyAwardRecommendation[];
}) {
  const reactId = useId();
  const titleId = `specialty-awards-title-${reactId.replaceAll(":", "")}`;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const triggerElement = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      triggerElement?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="application-reference-button"
        onClick={() => setOpen(true)}
        ref={triggerRef}
        type="button"
      >
        Specialty awards
      </button>

      {open
        ? createPortal(
            <div
              className="application-reference-modal-backdrop"
              onMouseDown={(event) => {
                if (event.currentTarget === event.target) setOpen(false);
              }}
              role="presentation"
            >
              <section
                aria-labelledby={titleId}
                aria-modal="true"
                className="application-reference-modal specialty-awards-modal"
                role="dialog"
              >
                <header className="application-reference-modal-header">
                  <div>
                    <span className="eyebrow">Advisory Committee</span>
                    <h2 id={titleId}>Specialty awards</h2>
                    <p>
                      Record a recommendation or explicitly select no
                      recommendation for each award.
                    </p>
                  </div>
                  <button
                    aria-label="Close specialty awards"
                    className="application-reference-close"
                    onClick={() => setOpen(false)}
                    ref={closeButtonRef}
                    type="button"
                  >
                    ×
                  </button>
                </header>

                <div className="application-reference-modal-body specialty-awards-modal-body">
                  <SpecialtyAwardWorkspace
                    applicationId={applicationId}
                    currentUserId={currentUserId}
                    recommendations={recommendations}
                    role="advisory_member"
                  />
                </div>
              </section>
            </div>,
            document.querySelector(".portal-shell") ?? document.body,
          )
        : null}
    </>
  );
}
