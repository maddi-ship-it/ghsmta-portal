import { NextResponse } from "next/server";

import { requireProfile } from "@/lib/auth";
import {
  buildDonorLetterPdf,
  type DonorLetterFields,
} from "@/lib/community/donor-letter-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEMPLATE_URL =
  "https://www.dropbox.com/scl/fi/lvaofyo9ghbzhwph1pdvy/Shuler_Lasting_Legacy_Letter-FINAL.pdf?rlkey=orzka21w9hdxqpah7qjpqijx4&st=3ae76j2y&dl=1";

function field(formData: FormData, key: string, label: string, maxLength: number) {
  const value = String(formData.get(key) ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) throw new Error(`${label} is required.`);
  if (value.length > maxLength) throw new Error(`${label} is too long.`);
  return value;
}

function formatDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Enter a valid letter date.");
  }
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error("Enter a valid letter date.");
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function safeFilename(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70) || "prospective-donor";
}

export async function POST(request: Request) {
  await requireProfile();

  try {
    const formData = await request.formData();
    const companyName = field(formData, "company_name", "Company name", 120);
    const input: DonorLetterFields = {
      letterDate: formatDate(field(formData, "letter_date", "Letter date", 10)),
      recipientName: field(formData, "recipient_name", "Recipient name", 100),
      recipientTitle: field(formData, "recipient_title", "Recipient title", 100),
      companyName,
      address: field(formData, "address", "Address", 160),
      city: field(formData, "city", "City", 80),
      state: field(formData, "state", "State", 30),
      zip: field(formData, "zip", "ZIP code", 15),
    };

    const templateResponse = await fetch(TEMPLATE_URL, {
      cache: "force-cache",
      next: { revalidate: 86_400 },
    });
    if (!templateResponse.ok) {
      throw new Error("The donor letter template could not be loaded.");
    }

    const templateBytes = new Uint8Array(await templateResponse.arrayBuffer());
    const pdf = await buildDonorLetterPdf(templateBytes, input);
    const filename = `ghsmta-lasting-legacy-letter-${safeFilename(companyName)}.pdf`;

    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": "application/pdf",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The donor letter could not be generated.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
