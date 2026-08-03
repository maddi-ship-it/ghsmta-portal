"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  defaultInvoiceMessageTemplates,
  renderInvoiceMessageTemplate,
} from "@/lib/billing/delivery-copy";
import { formatInvoiceAmount } from "@/lib/billing/types";

import { RegalConfirmDialog } from "./regal-confirm-dialog";

type ReviewDetails = {
  amountCents: number;
  description: string;
  documentKind: "invoice" | "scholarship_confirmation";
  schoolName: string;
  selectedCount: number;
};

function selectedReviewDetails(form: HTMLFormElement): ReviewDetails | null {
  const optionSelect = form.elements.namedItem("option_id");
  if (!(optionSelect instanceof HTMLSelectElement)) return null;
  const selectedOption = optionSelect.selectedOptions[0];
  if (!selectedOption?.value) return null;

  const amountCents = Number(selectedOption.dataset.amountCents);
  if (!Number.isFinite(amountCents) || amountCents < 0) return null;

  const bulkSelections = Array.from(
    form.querySelectorAll<HTMLInputElement>(
      'input[name="application_ids"]:checked',
    ),
  );
  const applicationSelect = form.elements.namedItem("application_id");
  const selectedApplication =
    applicationSelect instanceof HTMLSelectElement
      ? applicationSelect.selectedOptions[0]
      : null;
  const schoolName =
    bulkSelections[0]?.dataset.schoolName ||
    selectedApplication?.dataset.schoolName ||
    "Selected school";
  const selectedCount = bulkSelections.length || (selectedApplication?.value ? 1 : 0);
  const scholarshipCheckbox = form.elements.namedItem("scholarship_confirmation");
  const scholarshipConfirmation =
    amountCents === 0 &&
    scholarshipCheckbox instanceof HTMLInputElement &&
    scholarshipCheckbox.checked;

  return {
    amountCents,
    description: selectedOption.dataset.label || selectedOption.textContent || "Registration fee",
    documentKind: scholarshipConfirmation
      ? "scholarship_confirmation"
      : "invoice",
    schoolName,
    selectedCount,
  };
}

export function InvoicePreviewSubmitButton({
  bulk = false,
}: {
  bulk?: boolean;
}) {
  const { pending } = useFormStatus();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [details, setDetails] = useState<ReviewDetails | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function openPreview() {
    const form = buttonRef.current?.form;
    if (!form || !form.reportValidity()) return;

    const nextDetails = selectedReviewDetails(form);
    if (!nextDetails || nextDetails.selectedCount === 0) {
      setTriggerError(
        bulk
          ? "Select at least one school before previewing."
          : "Choose a school and pricing option before previewing.",
      );
      return;
    }
    if (bulk && nextDetails.selectedCount > 50) {
      setTriggerError("Select no more than 50 schools at a time.");
      return;
    }

    const paymentInput = form.elements.namedItem("payment_url");
    if (
      nextDetails.amountCents > 0 &&
      paymentInput instanceof HTMLInputElement &&
      !paymentInput.value.trim().startsWith("https://")
    ) {
      paymentInput.setCustomValidity(
        "Paid invoices require a secure https payment link.",
      );
      paymentInput.reportValidity();
      paymentInput.setCustomValidity("");
      return;
    }

    const templates = defaultInvoiceMessageTemplates(nextDetails.documentKind);
    setDetails(nextDetails);
    setSubject(templates.subject);
    setMessage(templates.message);
    setTriggerError(null);
    setPreviewError(null);
    setLoadingPreview(true);
    setOpen(true);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }

    try {
      const response = await fetch("/api/admin/billing/invoice-preview", {
        method: "POST",
        body: new FormData(form),
      });
      if (!response.ok) {
        throw new Error((await response.text()) || "Invoice preview failed.");
      }
      setPreviewUrl(URL.createObjectURL(await response.blob()));
    } catch (error) {
      setPreviewError(
        error instanceof Error ? error.message : "Invoice preview failed.",
      );
    } finally {
      setLoadingPreview(false);
    }
  }

  function submitReviewedInvoice() {
    if (subject.trim().length < 3 || message.trim().length < 3) return;
    const form = buttonRef.current?.form;
    if (!form) return;
    setOpen(false);
    form.requestSubmit();
  }

  const renderedSubject = details
    ? renderInvoiceMessageTemplate(subject, {
        schoolName: details.schoolName,
        invoiceNumber: "assigned when sent",
        amount: formatInvoiceAmount(details.amountCents),
        description: details.description,
      })
    : "";
  const renderedMessage = details
    ? renderInvoiceMessageTemplate(message, {
        schoolName: details.schoolName,
        invoiceNumber: "assigned when sent",
        amount: formatInvoiceAmount(details.amountCents),
        description: details.description,
      })
    : "";
  const invalidMessage =
    subject.trim().length < 3 ||
    subject.length > 200 ||
    /[\r\n]/.test(subject) ||
    message.trim().length < 3 ||
    message.length > 5_000;

  return (
    <>
      <input name="message_subject" type="hidden" value={subject.trim()} />
      <input name="message_body" type="hidden" value={message.trim()} />
      <button
        className="button button-primary"
        disabled={pending}
        onClick={() => void openPreview()}
        ref={buttonRef}
        type="button"
      >
        {pending
          ? "Sending…"
          : bulk
            ? "Preview selected invoices"
            : "Preview invoice"}
      </button>
      {triggerError ? (
        <small className="form-error invoice-preview-trigger-error" role="alert">
          {triggerError}
        </small>
      ) : null}

      <RegalConfirmDialog
        confirmDisabled={
          invalidMessage || loadingPreview || Boolean(previewError) || !previewUrl
        }
        confirmLabel={
          details && details.selectedCount > 1
            ? `Send ${details.selectedCount} invoices`
            : details?.documentKind === "scholarship_confirmation"
              ? "Send confirmation"
              : "Send invoice"
        }
        description={
          details && details.selectedCount > 1
            ? `Review the representative PDF and message before sending to ${details.selectedCount} schools.`
            : "Review the exact PDF and edit the message before it is delivered."
        }
        onCancel={() => setOpen(false)}
        onConfirm={submitReviewedInvoice}
        open={open}
        pending={pending}
        title="Preview before sending"
        wide
      >
        <div className="invoice-send-review">
          <section className="invoice-preview-pane" aria-label="Invoice PDF preview">
            <div className="invoice-preview-heading">
              <strong>Document preview</strong>
              {previewUrl ? (
                <a
                  className="text-button"
                  href={previewUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open PDF
                </a>
              ) : null}
            </div>
            {loadingPreview ? (
              <div className="invoice-preview-state">Generating preview…</div>
            ) : previewError ? (
              <div className="form-error invoice-preview-state" role="alert">
                {previewError}
              </div>
            ) : previewUrl ? (
              <iframe src={previewUrl} title="Invoice PDF preview" />
            ) : null}
          </section>

          <section className="invoice-message-editor">
            {details?.amountCents === 0 ? (
              <div className="notice invoice-zero-message-note">
                This is a $0 document. Write the confirmation message the school
                should receive with it.
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="invoice-message-subject">Email subject</label>
              <input
                className="input"
                id="invoice-message-subject"
                maxLength={200}
                onChange={(event) => setSubject(event.target.value)}
                value={subject}
              />
            </div>
            <div className="field">
              <label htmlFor="invoice-message-body">
                Email and School Messaging message
              </label>
              <textarea
                className="textarea"
                id="invoice-message-body"
                maxLength={5_000}
                onChange={(event) => setMessage(event.target.value)}
                rows={7}
                value={message}
              />
              <small>
                Personalization: {"{{school_name}}"}, {"{{invoice_number}}"},{" "}
                {"{{amount}}"}, and {"{{description}}"}.
              </small>
            </div>
            <div className="invoice-email-preview">
              <span className="eyebrow">Message preview</span>
              <strong>{renderedSubject}</strong>
              <p>{renderedMessage}</p>
              <small>A PDF copy will be attached to the email.</small>
            </div>
          </section>
        </div>
      </RegalConfirmDialog>
    </>
  );
}
