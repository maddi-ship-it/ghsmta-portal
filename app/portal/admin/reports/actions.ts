"use server";

import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { sendOwnerDigestEmail } from "@/lib/email/owner-digest";

function finish(
  report: string,
  kind: "success" | "error",
  message: string,
): never {
  const params = new URLSearchParams({
    report,
    [kind]: message,
  });
  redirect(`/portal/admin/reports?${params.toString()}`);
}

export async function sendOwnerDigestFromReports(
  formData: FormData,
) {
  const owner = await requireProfile(["owner"]);
  const report = String(
    formData.get("report") ?? "missing-comments",
  );

  try {
    const result = await sendOwnerDigestEmail(owner);
    finish(
      report,
      "success",
      `Daily digest sent to ${result.recipient}.`,
    );
  } catch (caught) {
    finish(
      report,
      "error",
      caught instanceof Error
        ? caught.message
        : "The daily digest could not be sent.",
    );
  }
}
