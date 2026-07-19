"use client";

import { useEffect, useState } from "react";

import { ScheduleBulkAccessForm } from "@/components/schedule-bulk-access-form";
import { ScheduleRecurringSlotsForm } from "@/components/schedule-recurring-slots-form";

type CycleOption = {
  id: string;
  name: string;
  season_year: string;
};

type BulkSlot = {
  id: string;
  title: string;
  program: string;
  date: string;
  time: string;
  accessLabel: string;
};

type ActiveTool = "recurring" | "school-access" | null;

export function ScheduleOwnerTools({
  cycles,
  slots,
}: {
  cycles: CycleOption[];
  slots: BulkSlot[];
}) {
  const [activeTool, setActiveTool] = useState<ActiveTool>(null);

  useEffect(() => {
    if (!activeTool) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveTool(null);
    };

    document.addEventListener("keydown", closeOnEscape);
    document.body.classList.add("modal-open");

    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.classList.remove("modal-open");
    };
  }, [activeTool]);

  return (
    <>
      <section className="schedule-owner-tool-bar" aria-label="Schedule tools">
        <div>
          <span className="eyebrow">Owner tools</span>
          <strong>Build and release schedule availability</strong>
        </div>
        <div className="schedule-owner-tool-actions">
          <button
            className="button button-dark"
            onClick={() => setActiveTool("recurring")}
            type="button"
          >
            Create recurring slots
          </button>
          <button
            className="button button-secondary"
            onClick={() => setActiveTool("school-access")}
            type="button"
          >
            Bulk school access
          </button>
        </div>
      </section>

      {activeTool && (
        <div
          aria-modal="true"
          className="schedule-tool-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setActiveTool(null);
          }}
          role="dialog"
        >
          <div className="schedule-tool-modal">
            <button
              aria-label="Close schedule tool"
              className="schedule-tool-modal-close"
              onClick={() => setActiveTool(null)}
              type="button"
            >
              ×
            </button>

            {activeTool === "recurring" ? (
              <ScheduleRecurringSlotsForm cycles={cycles} />
            ) : (
              <ScheduleBulkAccessForm slots={slots} />
            )}
          </div>
        </div>
      )}
    </>
  );
}
