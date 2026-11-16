import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { requireProfile } from "@/lib/auth";
import { buildGhsmtaWorkForHireDocument } from "@/lib/contracts/ghsmta-work-for-hire";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEMPLATE_PATH = path.join(
  process.cwd(),
  "public",
  "templates",
  "ghsmta-work-for-hire-contract.docx",
);

function safeFilename(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "contractor";
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ contractId: string }> },
) {
  await requireProfile(["owner"]);
  const { contractId } = await context.params;
  const supabase = await createClient();
  const [contractResult, paymentsResult, template] = await Promise.all([
    supabase
      .from("ghsmta_operations_contracts")
      .select("contractor_name,contractor_address,role_title,foundation_signer_name,agreement_date,starts_on,ends_on,event_date,total_consideration,responsibilities,transportation,lodging,meals,out_of_pocket_expenses,communication_credit")
      .eq("id", contractId)
      .single(),
    supabase
      .from("ghsmta_operations_contract_payments")
      .select("label,deliverable,amount,due_date")
      .eq("contract_id", contractId)
      .order("installment_order")
      .order("due_date", { nullsFirst: false }),
    readFile(TEMPLATE_PATH),
  ]);

  if (contractResult.error || !contractResult.data) {
    return NextResponse.json(
      { error: contractResult.error?.message ?? "Contract not found." },
      { status: contractResult.error?.code === "PGRST116" ? 404 : 500 },
    );
  }
  if (paymentsResult.error) {
    return NextResponse.json({ error: paymentsResult.error.message }, { status: 500 });
  }

  const contract = contractResult.data;
  const document = buildGhsmtaWorkForHireDocument(template, {
    contractorName: contract.contractor_name,
    contractorAddress: contract.contractor_address,
    roleTitle: contract.role_title,
    foundationSignerName: contract.foundation_signer_name,
    agreementDate: contract.agreement_date,
    startsOn: contract.starts_on,
    endsOn: contract.ends_on,
    eventDate: contract.event_date,
    totalConsideration: Number(contract.total_consideration ?? 0),
    responsibilities: contract.responsibilities,
    transportation: contract.transportation,
    lodging: contract.lodging,
    meals: contract.meals,
    outOfPocketExpenses: contract.out_of_pocket_expenses,
    communicationCredit: contract.communication_credit,
    payments: (paymentsResult.data ?? []).map((payment) => ({
      ...payment,
      amount: Number(payment.amount ?? 0),
    })),
  });
  const filename = `ghsmta-contract-${safeFilename(contract.contractor_name)}.docx`;

  return new NextResponse(Buffer.from(document), {
    headers: {
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Cache-Control": "private, no-store",
    },
  });
}

