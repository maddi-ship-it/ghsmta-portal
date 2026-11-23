import { NextResponse } from "next/server";

import { requireProfile } from "@/lib/auth";
import {
  buildDonorLetterPdf,
  type DonorLetterFields,
} from "@/lib/community/donor-letter-pdf";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEMPLATE_URL =
  "https://www.dropbox.com/scl/fi/lvaofyo9ghbzhwph1pdvy/Shuler_Lasting_Legacy_Letter-FINAL.pdf?rlkey=orzka21w9hdxqpah7qjpqijx4&st=3ae76j2y&dl=1";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DonorLetterRequestRow = {
  id: string;
  letter_date: string;
  recipient_name: string;
  recipient_title: string;
  company_name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
};

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

async function loadTemplate() {
  const templateResponse = await fetch(TEMPLATE_URL, {
    cache: "force-cache",
    next: { revalidate: 86_400 },
  });
  if (!templateResponse.ok) {
    throw new Error("The donor letter template could not be loaded.");
  }
  return new Uint8Array(await templateResponse.arrayBuffer());
}

async function pdfResponse(input: DonorLetterFields) {
  const templateBytes = await loadTemplate();
  const pdf = await buildDonorLetterPdf(templateBytes, input);
  const filename = `ghsmta-lasting-legacy-letter-${safeFilename(input.companyName)}.pdf`;

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "application/pdf",
    },
  });
}

function rowToFields(row: DonorLetterRequestRow): DonorLetterFields {
  return {
    letterDate: formatDate(row.letter_date),
    recipientName: row.recipient_name,
    recipientTitle: row.recipient_title,
    companyName: row.company_name,
    address: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
  };
}

export async function POST(request: Request) {
  const profile = await requireProfile();

  try {
    const formData = await request.formData();
    const companyName = field(formData, "company_name", "Company name", 120);
    const letterDate = field(formData, "letter_date", "Letter date", 10);
    const input: DonorLetterFields = {
      letterDate: formatDate(letterDate),
      recipientName: field(formData, "recipient_name", "Recipient name", 100),
      recipientTitle: field(formData, "recipient_title", "Recipient title", 120),
      companyName,
      address: field(formData, "address", "Address", 160),
      city: field(formData, "city", "City", 80),
      state: field(formData, "state", "State", 30),
      zip: field(formData, "zip", "ZIP code", 15),
    };

    const templateBytes = await loadTemplate();
    const pdf = await buildDonorLetterPdf(templateBytes, input);
    const supabase = await createClient();
    const { error } = await supabase.from("community_donor_letter_requests").insert({
      requested_by: profile.id,
      letter_date: letterDate,
      recipient_name: input.recipientName,
      recipient_title: input.recipientTitle,
      company_name: input.companyName,
      address: input.address,
      city: input.city,
      state: input.state,
      zip: input.zip,
    });
    if (error) throw new Error("The letter was created, but the request could not be saved.");
    const filename = `ghsmta-lasting-legacy-letter-${safeFilename(input.companyName)}.pdf`;

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

export async function GET(request: Request) {
  await requireProfile();

  try {
    const requestId = new URL(request.url).searchParams.get("request") ?? "";
    if (!UUID_PATTERN.test(requestId)) {
      return NextResponse.json({ error: "That letter request could not be found." }, { status: 404 });
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("community_donor_letter_requests")
      .select(
        "id,letter_date,recipient_name,recipient_title,company_name,address,city,state,zip",
      )
      .eq("id", requestId)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ error: "That letter request could not be found." }, { status: 404 });
    }

    return await pdfResponse(rowToFields(data as DonorLetterRequestRow));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The donor letter could not be generated.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
