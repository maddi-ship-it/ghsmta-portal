export type InvoiceDeliveryType =
  | "invoice"
  | "reminder"
  | "receipt"
  | "scholarship_confirmation";

export type SchoolInvoice = {
  id: string;
  invoice_number: string;
  cycle_id: string;
  application_id: string;
  option_key: string;
  description_snapshot: string;
  amount_cents: number;
  currency: "usd";
  document_kind: "invoice" | "scholarship_confirmation";
  payment_url: string | null;
  recipient_email: string;
  billing_name: string;
  billing_address: string | null;
  status: "draft" | "sent" | "paid" | "void";
  issued_at: string | null;
  due_at: string | null;
  sent_at: string | null;
  paid_at: string | null;
  next_reminder_at: string | null;
  last_reminder_at: string | null;
  reminder_count: number;
  delivery_status: "pending" | "delivered" | "partial" | "failed";
  last_delivery_at: string | null;
  reminder_claimed_at: string | null;
  reminder_claim_token: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type InvoiceContext = SchoolInvoice & {
  school_name: string;
  production_title: string | null;
  cycle_name: string;
  season_year: string;
};

export function formatInvoiceAmount(amountCents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amountCents / 100);
}
