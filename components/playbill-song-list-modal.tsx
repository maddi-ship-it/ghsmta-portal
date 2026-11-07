"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  buildPlaybillSongListSections,
  type PlaybillSong,
} from "@/lib/playbill-song-list";

type SongListResponse = {
  cached: boolean;
  extractedAt: string;
  songs: PlaybillSong[];
  sourceFileName: string;
};

export function PlaybillSongListModal({
  applicationId,
  buttonClassName = "button button-secondary",
  sourceFileName,
}: {
  applicationId: string;
  buttonClassName?: string;
  sourceFileName: string;
}) {
  const reactId = useId();
  const titleId = `playbill-song-list-title-${reactId.replaceAll(":", "")}`;
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [result, setResult] = useState<SongListResponse | null>(null);
  const [error, setError] = useState("");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  async function loadSongList() {
    setStatus("loading");
    setError("");

    try {
      const response = await fetch(
        `/api/adjudication/${applicationId}/playbill-song-list`,
        { method: "POST", cache: "no-store" },
      );
      const payload = (await response.json().catch(() => null)) as
        | (SongListResponse & { error?: string })
        | null;
      if (!response.ok || !payload) {
        throw new Error(
          payload?.error || "The Playbill song list could not be loaded.",
        );
      }

      setResult(payload);
      setStatus("loaded");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "The Playbill song list could not be loaded.",
      );
      setStatus("error");
    }
  }

  function openSongList() {
    setOpen(true);
    if (status === "idle") void loadSongList();
  }

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

  const sections = result ? buildPlaybillSongListSections(result.songs) : [];

  return (
    <>
      <button
        aria-haspopup="dialog"
        className={buttonClassName}
        onClick={openSongList}
        ref={triggerRef}
        type="button"
      >
        Playbill song list
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
                className="application-reference-modal playbill-song-list-modal"
                role="dialog"
              >
                <header className="application-reference-modal-header">
                  <div>
                    <span className="eyebrow">Playbill reference</span>
                    <h2 id={titleId}>Musical numbers</h2>
                    <p>
                      Pulled from {result?.sourceFileName || sourceFileName} in
                      the school&apos;s file library.
                    </p>
                  </div>
                  <button
                    aria-label="Close Playbill song list"
                    className="application-reference-close"
                    onClick={() => setOpen(false)}
                    ref={closeButtonRef}
                    type="button"
                  >
                    ×
                  </button>
                </header>

                <div className="application-reference-modal-body playbill-song-list-modal-body">
                  {status === "loading" ? (
                    <div className="playbill-song-list-status" role="status">
                      <span className="loading-spinner" aria-hidden="true" />
                      <div>
                        <strong>Reading the Playbill…</strong>
                        <p>The first opening may take a moment. Later views use the saved list.</p>
                      </div>
                    </div>
                  ) : null}

                  {status === "error" ? (
                    <div className="playbill-song-list-status" role="alert">
                      <div>
                        <strong>Song list unavailable</strong>
                        <p>{error}</p>
                      </div>
                      <button
                        className="button button-secondary"
                        onClick={() => void loadSongList()}
                        type="button"
                      >
                        Try again
                      </button>
                    </div>
                  ) : null}

                  {status === "loaded" && sections.length === 0 ? (
                    <div className="empty-state playbill-song-list-empty">
                      <h3>No musical-number list found</h3>
                      <p>
                        The uploaded Playbill did not contain a clearly labeled song list.
                        Review the original file if you expected one.
                      </p>
                    </div>
                  ) : null}

                  {status === "loaded" && sections.length > 0 ? (
                    <div className="playbill-song-list-sections">
                      {sections.map((section, sectionIndex) => (
                        <section
                          className="playbill-song-list-section"
                          key={`${section.heading}-${sectionIndex}`}
                        >
                          <h3>{section.heading}</h3>
                          <ol>
                            {section.songs.map((song, songIndex) => (
                              <li key={`${song.title}-${songIndex}`}>
                                <div>
                                  <strong>{song.title}</strong>
                                  {song.performers ? <span>{song.performers}</span> : null}
                                </div>
                              </li>
                            ))}
                          </ol>
                        </section>
                      ))}
                    </div>
                  ) : null}

                  {status === "loaded" ? (
                    <p className="playbill-song-list-note">
                      Automatically read from the uploaded Playbill. Verify unusual spellings or formatting against the source file.
                    </p>
                  ) : null}
                </div>
              </section>
            </div>,
            document.querySelector(".portal-shell") ?? document.body,
          )
        : null}
    </>
  );
}
