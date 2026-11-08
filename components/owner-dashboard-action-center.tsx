import Link from "next/link";

import { markSectionCReminderSent } from "@/app/portal/actions";
import type {
  OwnerDashboardAction,
  OwnerDashboardActionKind,
} from "@/lib/owner-dashboard-actions";

const EASTERN_TIME_ZONE = "America/New_York";

const ACTION_LABELS: Record<
  OwnerDashboardActionKind,
  { eyebrow: string; link: string }
> = {
  section_c: { eyebrow: "Section C", link: "Open application" },
  final_comments: { eyebrow: "Adjudication review", link: "Generate comments" },
  pick_six: { eyebrow: "Pick 6", link: "Open comment review" },
  section_c_reminder: { eyebrow: "School reminder", link: "Open school chat" },
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function timingLabel(action: OwnerDashboardAction) {
  if (action.timing === "ready") {
    return "Ready now";
  }
  return action.timing === "overdue"
    ? `Overdue · ${formatDate(action.dueAt)}`
    : `Due ${formatDate(action.dueAt)}`;
}

type OwnerDashboardActionGroup = {
  applicationId: string;
  schoolName: string;
  productionTitle: string | null;
  sectionCDueAt: string;
  actions: OwnerDashboardAction[];
};

function groupActionsBySchool(actions: OwnerDashboardAction[]) {
  const groups = new Map<string, OwnerDashboardActionGroup>();

  for (const action of actions) {
    const group = groups.get(action.applicationId);
    if (group) {
      group.actions.push(action);
      continue;
    }

    groups.set(action.applicationId, {
      applicationId: action.applicationId,
      schoolName: action.schoolName,
      productionTitle: action.productionTitle,
      sectionCDueAt: action.sectionCDueAt,
      actions: [action],
    });
  }

  return [...groups.values()];
}

export function OwnerDashboardActionCenter({
  actions,
}: {
  actions: OwnerDashboardAction[];
}) {
  const overdueCount = actions.filter(
    (action) => action.timing === "overdue",
  ).length;
  const schoolGroups = groupActionsBySchool(actions);

  return (
    <section className="panel owner-dashboard-action-center">
      <div className="panel-header owner-dashboard-action-header">
        <div>
          <span className="eyebrow">Owner follow-up</span>
          <h2>After each adjudication</h2>
          <p>
            Section C, final comments, Pick 6, and school reminders in one
            deadline-driven queue.
          </p>
        </div>
        <div className="owner-dashboard-action-counts" aria-label="Action totals">
          <span>
            <strong>{actions.length}</strong> open
          </span>
          {overdueCount > 0 ? (
            <span className="is-overdue">
              <strong>{overdueCount}</strong> overdue
            </span>
          ) : null}
        </div>
      </div>

      {actions.length === 0 ? (
        <div className="empty-state compact-empty-state">
          <h3>Post-adjudication work is caught up.</h3>
          <p>New actions will appear here as scheduled adjudications finish.</p>
        </div>
      ) : (
        <div className="owner-dashboard-school-grid">
          {schoolGroups.map((group) => (
            <article className="owner-dashboard-school-card" key={group.applicationId}>
              <header className="owner-dashboard-school-header">
                <div>
                  <h3>{group.schoolName}</h3>
                  <p>{group.productionTitle ?? "Production title pending"}</p>
                </div>
                <div className="owner-dashboard-school-deadline">
                  <span>Section C due</span>
                  <time dateTime={group.sectionCDueAt}>
                    {formatDate(group.sectionCDueAt)}
                  </time>
                </div>
              </header>

              <div className="owner-dashboard-school-actions">
                {group.actions.map((action) => {
                  const labels = ACTION_LABELS[action.kind];
                  const overdue = action.timing === "overdue";
                  return (
                    <div
                      className={`owner-dashboard-action-row owner-dashboard-action-${action.kind}${
                        overdue ? " is-overdue" : ""
                      }`}
                      key={action.id}
                    >
                      <div className="owner-dashboard-action-copy">
                        <div className="owner-dashboard-action-row-heading">
                          <span className="eyebrow">{labels.eyebrow}</span>
                          <span className={overdue ? "badge badge-required" : "badge"}>
                            {timingLabel(action)}
                          </span>
                        </div>
                        <strong>{action.title}</strong>
                        <p>{action.detail}</p>
                      </div>
                      <div className="owner-dashboard-action-buttons">
                        <Link className="button button-secondary button-compact" href={action.href}>
                          {labels.link}
                        </Link>
                        {action.canMarkReminderSent ? (
                          <form action={markSectionCReminderSent.bind(null, action.applicationId)}>
                            <button className="text-button" type="submit">
                              Mark sent
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
