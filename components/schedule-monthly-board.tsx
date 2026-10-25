import Link from "next/link";

import {
  joinScheduleSlot,
  ownerSaveScheduleWorkflowChecklist,
} from "@/app/portal/schedule/actions";
import type { ScheduleWorkflowChecklist } from "@/lib/schedule-workflow-checklist";

const EASTERN_TIME_ZONE = "America/New_York";

export type MonthlyScheduleItem = {
  id: string;
  applicationId: string;
  startsAt: string;
  endsAt: string;
  schoolName: string;
  productionTitle: string;
  city: string;
  advisoryMember: string;
  adjudicators: string[];
  understudy: string;
  shadows: string[];
  checklist: ScheduleWorkflowChecklist;
  canOpenAdjudication: boolean;
  canJoinPanel: boolean;
  canJoinUnderstudy: boolean;
  canJoinShadow: boolean;
  panelRole: "adjudicator" | "advisory_member" | null;
};

function monthKey(value: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(value));
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  return `${year}-${month}`;
}

function monthLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function timeLabel(start: string, end: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatter.format(new Date(start))}–${formatter.format(new Date(end))}`;
}

function StaffRow({
  item,
  joinMode,
  label,
  value,
}: {
  item: MonthlyScheduleItem;
  joinMode?: "panel" | "understudy" | "shadow";
  label: string;
  value: string;
}) {
  return (
    <div className={`schedule-monthly-staff-row ${value ? "" : "is-open"}`}>
      <span>{label}</span>
      {value ? (
        <strong>{value}</strong>
      ) : joinMode ? (
        <form action={joinScheduleSlot}>
          <input name="slot_id" type="hidden" value={item.id} />
          <input name="participation_mode" type="hidden" value={joinMode} />
          <input name="return_view" type="hidden" value="monthly" />
          <button
            aria-label={`Join ${item.schoolName} as ${label}`}
            className="schedule-monthly-seat-button"
            type="submit"
          >
            Open
          </button>
        </form>
      ) : (
        <strong>Open</strong>
      )}
    </div>
  );
}

function WorkflowChecklist({ item }: { item: MonthlyScheduleItem }) {
  return (
    <form
      action={ownerSaveScheduleWorkflowChecklist.bind(null, item.applicationId)}
      className="schedule-monthly-checklist"
    >
      <span className="schedule-monthly-checklist-title">Owner tracking</span>
      <label>
        <input defaultChecked={item.checklist.pick_six_sent} name="pick_six_sent" type="checkbox" />
        <span>Pick 6 Sent</span>
      </label>
      <label>
        <input defaultChecked={item.checklist.moved_to_section_c} name="moved_to_section_c" type="checkbox" />
        <span>Moved to Section C</span>
      </label>
      <label>
        <input defaultChecked={item.checklist.section_c_complete} name="section_c_complete" type="checkbox" />
        <span>Section C Complete</span>
      </label>
      <label>
        <input defaultChecked={item.checklist.final_results_released} name="final_results_released" type="checkbox" />
        <span>Final Comments/scores released</span>
      </label>
      <button className="text-button" type="submit">Save status</button>
    </form>
  );
}

export function ScheduleMonthlyBoard({
  items,
  showOwnerChecklist,
}: {
  items: MonthlyScheduleItem[];
  showOwnerChecklist: boolean;
}) {
  const monthGroups = new Map<string, MonthlyScheduleItem[]>();
  for (const item of items) {
    const key = monthKey(item.startsAt);
    const group = monthGroups.get(key) ?? [];
    group.push(item);
    monthGroups.set(key, group);
  }

  if (items.length === 0) {
    return (
      <section className="panel empty-state schedule-empty-state">
        <h3>No booked schools match these filters.</h3>
        <p>The monthly view displays confirmed school adjudications.</p>
      </section>
    );
  }

  return (
    <div className="schedule-monthly-board">
      {[...monthGroups.entries()].map(([key, group]) => (
        <section className="schedule-monthly-section" key={key}>
          <header className="schedule-monthly-heading">
            <h2>{monthLabel(group[0].startsAt)}</h2>
            <span>{group.length} adjudication{group.length === 1 ? "" : "s"}</span>
          </header>
          <div className="schedule-monthly-grid">
            {group.map((item) => (
              <article className="schedule-monthly-card" key={item.id}>
                <header className="schedule-monthly-card-header">
                  <strong>{dateLabel(item.startsAt)}</strong>
                  <span>{timeLabel(item.startsAt, item.endsAt)} ET</span>
                </header>
                <div className="schedule-monthly-school">
                  <h3>{item.schoolName}</h3>
                  <span>{item.city}</span>
                  <em>{item.productionTitle}</em>
                </div>
                <div className="schedule-monthly-staff">
                  <StaffRow
                    item={item}
                    joinMode={
                      item.canJoinPanel && item.panelRole === "advisory_member"
                        ? "panel"
                        : undefined
                    }
                    label="Advisory"
                    value={item.advisoryMember}
                  />
                  {[0, 1, 2].map((index) => (
                    <StaffRow
                      item={item}
                      joinMode={
                        item.canJoinPanel && item.panelRole === "adjudicator"
                          ? "panel"
                          : undefined
                      }
                      key={`adjudicator-${index}`}
                      label={`Adjudicator ${index + 1}`}
                      value={item.adjudicators[index] ?? ""}
                    />
                  ))}
                  <StaffRow
                    item={item}
                    joinMode={item.canJoinUnderstudy ? "understudy" : undefined}
                    label="Understudy"
                    value={item.understudy}
                  />
                  {[0, 1, 2].map((index) => (
                    <StaffRow
                      item={item}
                      joinMode={item.canJoinShadow ? "shadow" : undefined}
                      key={`shadow-${index}`}
                      label={`Shadow ${index + 1}`}
                      value={item.shadows[index] ?? ""}
                    />
                  ))}
                </div>
                {showOwnerChecklist && <WorkflowChecklist item={item} />}
                {item.canOpenAdjudication && (
                  <Link
                    className="schedule-monthly-open-link"
                    href={`/portal/adjudication/${item.applicationId}`}
                  >
                    Open adjudication
                  </Link>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
