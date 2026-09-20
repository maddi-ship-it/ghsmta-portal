"use client";

import { SCORECARD_SAVE_REQUEST_EVENT } from "@/components/adjudicator-autosave";

export function ScorecardDraftButton({
  applicationId,
}: {
  applicationId: string;
}) {
  return (
    <button
      className="button button-secondary"
      onClick={() => {
        window.dispatchEvent(
          new CustomEvent(SCORECARD_SAVE_REQUEST_EVENT, {
            detail: { applicationId },
          }),
        );
      }}
      type="button"
    >
      Save draft
    </button>
  );
}
