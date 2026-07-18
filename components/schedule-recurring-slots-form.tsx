"use client";

import { useState } from "react";

import { createRecurringScheduleSlots } from "@/app/portal/schedule/actions";

type CycleOption = {
  id: string;
  name: string;
  season_year: string;
};

const WEEKDAYS = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [0, "Sun"],
] as const;

export function ScheduleRecurringSlotsForm({
  cycles,
}: {
  cycles: CycleOption[];
}) {
  const [repeatFrequency, setRepeatFrequency] = useState("weekly");
  const [schoolAccessMode, setSchoolAccessMode] = useState("hidden");

  return (
    <section className="panel schedule-tool-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Bulk creation</span>
          <h2>Create recurring slots</h2>
          <p>
            Create repeated dates and multiple back-to-back slots in one action.
            Times use Eastern Time.
          </p>
        </div>
      </div>

      <div className="panel-body">
        <form action={createRecurringScheduleSlots} className="schedule-recurring-form">
          <div className="field">
            <label htmlFor="recurring_cycle_id">Program</label>
            <select className="select" id="recurring_cycle_id" name="cycle_id" required>
              <option value="">Choose a program</option>
              {cycles.map((cycle) => (
                <option key={cycle.id} value={cycle.id}>
                  {cycle.season_year} — {cycle.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="recurring_title">Slot title</label>
            <input
              className="input"
              id="recurring_title"
              name="title"
              placeholder="Adjudication visit"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="series_start_date">First date</label>
            <input className="input" id="series_start_date" name="series_start_date" type="date" required />
          </div>

          <div className="field">
            <label htmlFor="series_start_time">First start time</label>
            <input className="input" id="series_start_time" name="series_start_time" type="time" required />
          </div>

          <div className="field">
            <label htmlFor="slot_duration_minutes">Slot length</label>
            <div className="input-with-suffix">
              <input
                className="input"
                defaultValue="60"
                id="slot_duration_minutes"
                max="720"
                min="1"
                name="slot_duration_minutes"
                type="number"
                required
              />
              <span>minutes</span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="slots_per_day">Slots each day</label>
            <input
              className="input"
              defaultValue="1"
              id="slots_per_day"
              max="24"
              min="1"
              name="slots_per_day"
              type="number"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="gap_minutes">Gap between slots</label>
            <div className="input-with-suffix">
              <input
                className="input"
                defaultValue="0"
                id="gap_minutes"
                max="240"
                min="0"
                name="gap_minutes"
                type="number"
              />
              <span>minutes</span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="repeat_frequency">Repeat</label>
            <select
              className="select"
              id="repeat_frequency"
              name="repeat_frequency"
              onChange={(event) => setRepeatFrequency(event.target.value)}
              value={repeatFrequency}
            >
              <option value="once">One date only</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>

          {repeatFrequency !== "once" && (
            <>
              <div className="field">
                <label htmlFor="repeat_interval">Repeat every</label>
                <div className="input-with-suffix">
                  <input
                    className="input"
                    defaultValue="1"
                    id="repeat_interval"
                    max="12"
                    min="1"
                    name="repeat_interval"
                    type="number"
                  />
                  <span>{repeatFrequency === "weekly" ? "week(s)" : "day(s)"}</span>
                </div>
              </div>

              <div className="field">
                <label htmlFor="repeat_until">Repeat until</label>
                <input className="input" id="repeat_until" name="repeat_until" type="date" required />
              </div>
            </>
          )}

          {repeatFrequency === "weekly" && (
            <fieldset className="field schedule-weekday-field">
              <legend>Days of week</legend>
              <div className="schedule-weekday-options">
                {WEEKDAYS.map(([value, label]) => (
                  <label className="schedule-weekday-option" key={value}>
                    <input name="weekly_days" type="checkbox" value={value} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <small>When no day is selected, the weekday of the first date is used.</small>
            </fieldset>
          )}

          <div className="field">
            <label htmlFor="recurring_location">Location</label>
            <input className="input" id="recurring_location" name="location" />
          </div>

          <div className="field">
            <label htmlFor="recurring_status">Reviewer status</label>
            <select className="select" defaultValue="open" id="recurring_status" name="status">
              <option value="open">Open to reviewers</option>
              <option value="draft">Draft</option>
              <option value="closed">Closed</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="recurring_school_access_mode">School selection</label>
            <select
              className="select"
              id="recurring_school_access_mode"
              name="school_access_mode"
              onChange={(event) => setSchoolAccessMode(event.target.value)}
              value={schoolAccessMode}
            >
              <option value="hidden">Keep hidden from schools</option>
              <option value="open_now">Open to schools now</option>
              <option value="scheduled">Schedule opening</option>
            </select>
          </div>

          {schoolAccessMode === "scheduled" && (
            <div className="field">
              <label htmlFor="recurring_school_booking_opens_at">Schools can select beginning</label>
              <input
                className="input"
                id="recurring_school_booking_opens_at"
                name="school_booking_opens_at"
                type="datetime-local"
                required
              />
            </div>
          )}

          {schoolAccessMode !== "hidden" && (
            <div className="field">
              <label htmlFor="recurring_school_booking_closes_at">School selection closes</label>
              <input
                className="input"
                id="recurring_school_booking_closes_at"
                name="school_booking_closes_at"
                type="datetime-local"
              />
            </div>
          )}

          <div className="field schedule-recurring-instructions">
            <label htmlFor="recurring_school_instructions">School instructions</label>
            <textarea
              className="textarea"
              id="recurring_school_instructions"
              name="school_instructions"
              placeholder="Arrival, parking, check-in, or other instructions visible to the school."
            />
          </div>

          <div className="schedule-recurring-submit">
            <button className="button button-dark" type="submit">
              Create recurring slots
            </button>
            <small>A single action can create up to 250 slots. Duplicate times are skipped.</small>
          </div>
        </form>
      </div>
    </section>
  );
}
