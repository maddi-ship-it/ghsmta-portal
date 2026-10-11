"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ScoringCriterionGuide } from "@/lib/scoring-criterion-guides";

type GuideResponse = {
  guide?: ScoringCriterionGuide;
  sourceDocument?: string;
  error?: string;
};

export function CriterionScoringGuideButton({
  categoryTitle,
  criterionId,
  criterionTitle,
}: {
  categoryTitle: string;
  criterionId: string;
  criterionTitle: string;
}) {
  const reactId = useId();
  const titleId = `criterion-guide-title-${reactId.replaceAll(":", "")}`;
  const [open, setOpen] = useState(false);
  const [guide, setGuide] = useState<ScoringCriterionGuide | null>(null);
  const [sourceDocument, setSourceDocument] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);

  const loadGuide = useCallback(async () => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/adjudication/criterion-guide/${criterionId}`,
        {
          cache: "force-cache",
          signal: controller.signal,
        },
      );
      const payload = (await response.json().catch(() => ({}))) as GuideResponse;
      if (!response.ok || !payload.guide) {
        throw new Error(
          payload.error || "The scoring guide could not be loaded.",
        );
      }
      setGuide(payload.guide);
      setSourceDocument(payload.sourceDocument ?? "");
    } catch (reason) {
      if (controller.signal.aborted) return;
      setError(
        reason instanceof Error
          ? reason.message
          : "The scoring guide could not be loaded.",
      );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [criterionId]);

  useEffect(
    () => () => {
      requestControllerRef.current?.abort();
    },
    [],
  );

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
        className="criterion-guide-button"
        onClick={() => {
          setOpen(true);
          if (!guide && !loading) void loadGuide();
        }}
        title={`Open scoring guide for ${criterionTitle}`}
        type="button"
        ref={triggerRef}
      >
        Guide
      </button>

      {open &&
        createPortal(
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
              className="application-reference-modal"
              role="dialog"
            >
              <header className="application-reference-modal-header">
                <div>
                  <span className="eyebrow">Scoring guide</span>
                  <h2 id={titleId}>{guide?.title ?? criterionTitle}</h2>
                  <p>
                    {categoryTitle} · Observable benchmarks and practical
                    examples for scores 10 through 1.
                  </p>
                </div>
                <button
                  aria-label={`Close scoring guide for ${criterionTitle}`}
                  className="application-reference-close"
                  onClick={() => setOpen(false)}
                  ref={closeButtonRef}
                  type="button"
                >
                  ×
                </button>
              </header>

              <div className="application-reference-modal-body">
                {loading ? (
                  <div className="criterion-guide-state" role="status">
                    <span className="status-dot" />
                    Loading criterion guidance…
                  </div>
                ) : error ? (
                  <div className="criterion-guide-state criterion-guide-state-error">
                    <p>{error}</p>
                    <button
                      className="button button-secondary button-compact"
                      onClick={() => void loadGuide()}
                      type="button"
                    >
                      Try again
                    </button>
                  </div>
                ) : guide ? (
                  <>
                    <section className="application-reference-group">
                      <h3>Assessment focus</h3>
                      <ul className="criterion-guide-focus-list">
                        {guide.assessment_focus.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </section>

                    <section className="application-reference-group">
                      <h3>Score descriptions</h3>
                      <dl className="application-reference-list criterion-guide-level-list">
                        {guide.levels.map((level) => (
                          <div
                            className="application-reference-row criterion-guide-level-row"
                            key={level.score}
                          >
                            <dt className="criterion-guide-score">
                              <strong>{level.score}</strong>
                              <span>{level.label}</span>
                            </dt>
                            <dd className="criterion-guide-level-copy">
                              <div>
                                <span>Observable performance</span>
                                <p>{level.observable}</p>
                              </div>
                              <div>
                                <span>Practical context</span>
                                <p>{level.example}</p>
                              </div>
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </section>

                    <p className="criterion-guide-source">
                      Quarter-point scores may be used between levels.
                      {sourceDocument ? ` Source: ${sourceDocument}` : ""}
                    </p>
                  </>
                ) : null}
              </div>
            </section>
          </div>,
          document.querySelector(".portal-shell") ?? document.body,
        )}
    </>
  );
}
