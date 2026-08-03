import { formatInvoiceAmount, type InvoiceDeliveryType, type SchoolInvoice } from "./types";

export const DEFAULT_INVOICE_SUBJECT = "GHSMTA invoice {{invoice_number}}";
export const DEFAULT_INVOICE_MESSAGE =
  "{{school_name}} has a new {{amount}} invoice for {{description}}.";
export const DEFAULT_SCHOLARSHIP_SUBJECT =
  "Scholarship confirmation — {{invoice_number}}";
export const DEFAULT_SCHOLARSHIP_MESSAGE =
  "{{school_name}}'s full scholarship for {{description}} is confirmed. No payment is due.";

export type InvoiceMessageTemplateValues = {
  schoolName: string;
  invoiceNumber: string;
  amount: string;
  description: string;
};

export function renderInvoiceMessageTemplate(
  template: string,
  values: InvoiceMessageTemplateValues,
) {
  return template
    .replaceAll("{{school_name}}", values.schoolName)
    .replaceAll("{{invoice_number}}", values.invoiceNumber)
    .replaceAll("{{amount}}", values.amount)
    .replaceAll("{{description}}", values.description);
}

export function defaultInvoiceMessageTemplates(
  documentKind: SchoolInvoice["document_kind"],
) {
  return documentKind === "scholarship_confirmation"
    ? {
        subject: DEFAULT_SCHOLARSHIP_SUBJECT,
        message: DEFAULT_SCHOLARSHIP_MESSAGE,
      }
    : {
        subject: DEFAULT_INVOICE_SUBJECT,
        message: DEFAULT_INVOICE_MESSAGE,
      };
}

export function resolveInvoiceDeliveryCopy(
  invoice: SchoolInvoice,
  schoolName: string,
  deliveryType: InvoiceDeliveryType,
) {
  const amount = formatInvoiceAmount(invoice.amount_cents);
  if (deliveryType === "receipt") {
    return {
      subject: `Payment receipt — ${invoice.invoice_number}`,
      title: "Payment received",
      body: `Thank you. ${schoolName}'s ${amount} payment for ${invoice.description_snapshot} has been marked paid.`,
    };
  }
  if (deliveryType === "reminder") {
    return {
      subject: `Payment reminder — ${invoice.invoice_number}`,
      title: "Payment reminder",
      body: `${schoolName}'s ${amount} invoice for ${invoice.description_snapshot} remains open.`,
    };
  }

  const defaults = defaultInvoiceMessageTemplates(invoice.document_kind);
  const values = {
    schoolName,
    invoiceNumber: invoice.invoice_number,
    amount,
    description: invoice.description_snapshot,
  };
  const subjectTemplate = invoice.message_subject_snapshot?.trim() || defaults.subject;
  const messageTemplate = invoice.message_body_snapshot?.trim() || defaults.message;

  return {
    subject: renderInvoiceMessageTemplate(subjectTemplate, values),
    title:
      deliveryType === "scholarship_confirmation"
        ? "Scholarship confirmed"
        : "New invoice",
    body: renderInvoiceMessageTemplate(messageTemplate, values),
  };
}
