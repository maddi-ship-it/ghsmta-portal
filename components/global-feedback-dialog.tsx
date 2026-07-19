"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { submitPortalFeedback } from "@/app/portal/feedback/actions";
import { uploadPortalFiles } from "@/lib/portal-file-client";
import type { Profile } from "@/lib/types";

export const FEEDBACK_DIALOG_EVENT = "ghsmta:open-feedback";

export function GlobalFeedbackDialog({ profile }: { profile: Profile }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  useEffect(() => {
    const handler = () => {
      setError(null);
      setReference(null);
      setOpen(true);
    };
    window.addEventListener(FEEDBACK_DIALOG_EVENT, handler);
    return () => window.removeEventListener(FEEDBACK_DIALOG_EVENT, handler);
  }, []);

  async function submit(form: HTMLFormElement) {
    setBusy(true);
    setError(null);
    const formData = new FormData(form);
    const requestType = String(formData.get("request_type") ?? "bug_report");
    const files = formData.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    formData.delete("files");
    formData.set("page_url", window.location.href);
    formData.set("page_path", window.location.pathname);
    formData.set("browser_info", navigator.userAgent);
    formData.set("screen_width", String(window.innerWidth));
    formData.set("screen_height", String(window.innerHeight));

    try {
      const result = await submitPortalFeedback(formData);
      if (!result.ok || !result.requestId) throw new Error(result.error ?? "Could not submit request.");

      if (files.length > 0) {
        await uploadPortalFiles({
          files,
          contextType: requestType === "feature_request" ? "feature_request" : "bug_report",
          contextId: result.requestId,
          userId: profile.id,
          documentType: requestType === "feature_request" ? "Feature-Request" : "Bug-Report",
          documentCategory: "feedback",
          reviewerVisible: false,
        });
      }

      form.reset();
      setReference(result.referenceCode ?? "Submitted");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not submit request.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="modal-card feedback-modal" role="dialog" aria-modal="true" aria-labelledby="global-feedback-title">
        <div className="modal-header">
          <div><p className="eyebrow">Portal feedback</p><h2 id="global-feedback-title">Report a bug or request a feature</h2></div>
          <button className="modal-close" type="button" onClick={() => setOpen(false)} aria-label="Close">×</button>
        </div>

        {reference ? (
          <div className="feedback-success-state">
            <span className="success-seal">✓</span>
            <h3>Thank you. We received your request.</h3>
            <p>Confirmation number: <strong>{reference}</strong></p>
            <div className="button-row"><Link className="button button-secondary" href="/portal/feedback" onClick={() => setOpen(false)}>View my requests</Link><button className="button button-gold" type="button" onClick={() => setOpen(false)}>Done</button></div>
          </div>
        ) : (
          <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void submit(event.currentTarget); }}>
            {error && <div className="form-error">{error}</div>}
            <div className="form-grid two-column-form">
              <div className="field"><label htmlFor="feedback_type">Type</label><select className="select" id="feedback_type" name="request_type"><option value="bug_report">Bug report</option><option value="feature_request">Feature request</option></select></div>
              <div className="field"><label htmlFor="feedback_priority">Priority</label><select className="select" id="feedback_priority" name="priority"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
            </div>
            <div className="field"><label htmlFor="feedback_title_input">Title</label><input className="input" id="feedback_title_input" name="title" minLength={3} maxLength={180} required /></div>
            <div className="field"><label htmlFor="feedback_description">What happened, or what would help?</label><textarea className="textarea" id="feedback_description" name="description" rows={7} minLength={10} required /></div>
            <div className="field"><label htmlFor="feedback_files">Screenshot or supporting file</label><input className="input file-input" id="feedback_files" name="files" type="file" multiple /></div>
            <p className="privacy-note">The portal automatically includes your current page, role, browser, and screen size so the team can reproduce the issue.</p>
            <div className="modal-actions"><button className="button button-secondary" type="button" onClick={() => setOpen(false)}>Cancel</button><button className="button button-gold" type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit request"}</button></div>
          </form>
        )}
      </div>
    </div>
  );
}
