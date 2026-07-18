"use client";

import { useMemo, useState } from "react";

import { bulkUpdateSchoolScheduleAccess } from "@/app/portal/schedule/actions";

type BulkSlot = {
  id: string;
  title: string;
  program: string;
  date: string;
  time: string;
  accessLabel: string;
};

export function ScheduleBulkAccessForm({ slots }: { slots: BulkSlot[] }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [accessAction, setAccessAction] = useState("open_now");
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected = slots.length > 0 && selectedIds.length === slots.length;

  function toggleSlot(slotId: string) {
    setSelectedIds((current) =>
      current.includes(slotId)
        ? current.filter((id) => id !== slotId)
        : [...current, slotId],
    );
  }

  return (
    <section className="panel schedule-tool-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">School access</span>
          <h2>Bulk open schedule slots</h2>
          <p>
            Select future slots, open them immediately, or schedule one shared opening time.
          </p>
        </div>
        <span className="badge">{selectedIds.length} selected</span>
      </div>

      <div className="panel-body">
        {slots.length === 0 ? (
          <div className="empty-state compact-empty-state">
            <h3>No future slots are available.</h3>
            <p>Create schedule slots before setting school access.</p>
          </div>
        ) : (
          <form action={bulkUpdateSchoolScheduleAccess} className="schedule-bulk-access-form">
            <div className="schedule-bulk-selection-heading">
              <button
                className="text-button"
                onClick={() => setSelectedIds(allSelected ? [] : slots.map((slot) => slot.id))}
                type="button"
              >
                {allSelected ? "Clear all" : "Select all future slots"}
              </button>
              <small>Cancelled slots are never reopened by a bulk action.</small>
            </div>

            <div className="schedule-bulk-slot-list">
              {slots.map((slot) => (
                <label className="schedule-bulk-slot" key={slot.id}>
                  <input
                    checked={selectedSet.has(slot.id)}
                    name="slot_ids"
                    onChange={() => toggleSlot(slot.id)}
                    type="checkbox"
                    value={slot.id}
                  />
                  <span className="schedule-bulk-slot-main">
                    <strong>{slot.title}</strong>
                    <small>{slot.program}</small>
                  </span>
                  <span className="schedule-bulk-slot-time">
                    <strong>{slot.date}</strong>
                    <small>{slot.time}</small>
                  </span>
                  <span className="badge">{slot.accessLabel}</span>
                </label>
              ))}
            </div>

            <div className="schedule-bulk-action-grid">
              <div className="field">
                <label htmlFor="bulk_access_action">Action</label>
                <select
                  className="select"
                  id="bulk_access_action"
                  name="bulk_access_action"
                  onChange={(event) => setAccessAction(event.target.value)}
                  value={accessAction}
                >
                  <option value="open_now">Open to schools now</option>
                  <option value="schedule">Schedule an opening time</option>
                  <option value="close_now">Close school selection now</option>
                  <option value="hide">Hide from schools</option>
                </select>
              </div>

              {accessAction === "schedule" && (
                <div className="field">
                  <label htmlFor="bulk_school_booking_opens_at">Schools can select beginning</label>
                  <input
                    className="input"
                    id="bulk_school_booking_opens_at"
                    name="bulk_school_booking_opens_at"
                    type="datetime-local"
                    required
                  />
                </div>
              )}

              {(accessAction === "open_now" || accessAction === "schedule") && (
                <div className="field">
                  <label htmlFor="bulk_school_booking_closes_at">School selection closes</label>
                  <input
                    className="input"
                    id="bulk_school_booking_closes_at"
                    name="bulk_school_booking_closes_at"
                    type="datetime-local"
                  />
                </div>
              )}

              <button
                className="button button-dark schedule-bulk-submit"
                disabled={selectedIds.length === 0}
                type="submit"
              >
                Update selected slots
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
