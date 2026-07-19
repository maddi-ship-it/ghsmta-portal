"use client";

import { useEffect, useState } from "react";

import type {
  ApplicationReferencePanel,
} from "@/lib/application-reference-panels";

function formatValue(label: string, rawValue: string) {
  const value = rawValue.trim();
  if (!value) return "Not provided";

  const numeric = Number(value.replace(/[$,%\s,]/g, ""));
  const normalizedLabel = label.toLowerCase();

  if (Number.isFinite(numeric)) {
    if (
      normalizedLabel.includes("amount") ||
      normalizedLabel.includes("compensation") ||
      normalizedLabel.includes("spent") ||
      normalizedLabel.includes("budget") ||
      normalizedLabel.includes("fees")
    ) {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(numeric);
    }

    if (normalizedLabel.includes("percentage")) {
      const percentage = Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
      return `${percentage.toLocaleString("en-US", {
        maximumFractionDigits: 2,
      })}%`;
    }
  }

  return value;
}

export function ApplicationReferenceBar({
  panels,
}: {
  panels: ApplicationReferencePanel[];
}) {
  const [activePanel, setActivePanel] =
    useState<ApplicationReferencePanel | null>(null);

  useEffect(() => {
    if (!activePanel) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActivePanel(null);
    };

    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [activePanel]);

  return (
    <>
      <div
        className="application-reference-bar"
        aria-label="Application reference views"
      >
        <span className="application-reference-label">
          Application data
        </span>

        <div className="application-reference-buttons">
          {panels.map((panel) => (
            <button
              className="application-reference-button"
              key={panel.key}
              onClick={() => setActivePanel(panel)}
              type="button"
            >
              {panel.shortTitle}
            </button>
          ))}
        </div>
      </div>

      {activePanel && (
        <div
          className="application-reference-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setActivePanel(null);
            }
          }}
          role="presentation"
        >
          <section
            aria-labelledby="application-reference-modal-title"
            aria-modal="true"
            className="application-reference-modal"
            role="dialog"
          >
            <header className="application-reference-modal-header">
              <div>
                <span className="eyebrow">Application data</span>
                <h2 id="application-reference-modal-title">
                  {activePanel.title}
                </h2>
                <p>{activePanel.description}</p>
              </div>

              <button
                aria-label="Close application data"
                className="application-reference-close"
                onClick={() => setActivePanel(null)}
                type="button"
              >
                ×
              </button>
            </header>

            <div className="application-reference-modal-body">
              {activePanel.groups.length > 0 ? (
                activePanel.groups.map((group) => (
                  <section
                    className="application-reference-group"
                    key={`${activePanel.key}-${group.title}`}
                  >
                    <h3>{group.title}</h3>

                    {group.items.length > 0 ? (
                      <dl className="application-reference-list">
                        {group.items.map((item, index) => (
                          <div
                            className="application-reference-row"
                            key={`${item.label}-${index}`}
                          >
                            <dt>{item.label}</dt>
                            <dd>
                              {formatValue(item.label, item.value)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="application-reference-empty">
                        No matching application responses were found.
                      </p>
                    )}
                  </section>
                ))
              ) : (
                <div className="empty-state">
                  <h3>No application data found</h3>
                  <p>
                    This application does not contain responses for this
                    view yet.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
