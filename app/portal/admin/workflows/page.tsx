import {
  assignScoringParticipant,
  deleteScheduleNotificationRule,
  saveDigestSettings,
  saveScheduleNotificationRule,
  updateFeedbackRequest,
} from "@/app/portal/admin/workflows/actions";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function WorkflowsAdminPage() {
  const owner = await requireProfile(["owner"]);
  const supabase = await createClient();
  const [rulesResult, cyclesResult, applicationsResult, usersResult, digestResult, feedbackResult, activityResult] = await Promise.all([
    supabase.from("schedule_notification_rules").select("*").order("offset_minutes", { ascending: false }),
    supabase.from("award_cycles").select("id,name,season_year").order("season_year", { ascending: false }),
    supabase.from("applications").select("id,school_name,production_title").eq("is_archived", false).order("school_name"),
    supabase.from("profiles").select("id,full_name,email,role,active").in("role", ["adjudicator", "advisory_member"]).eq("active", true).order("full_name"),
    supabase.from("owner_digest_settings").select("*").eq("owner_user_id", owner.id).maybeSingle(),
    supabase.from("portal_feedback_requests").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("owner_activity_log").select("*").order("created_at", { ascending: false }).limit(30),
  ]);

  for (const result of [rulesResult, cyclesResult, applicationsResult, usersResult, digestResult, feedbackResult, activityResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const digest = digestResult.data;

  return (
    <div className="workflow-admin-grid">
      <section className="panel workflow-notification-builder">
        <div className="panel-header"><div><h2>Scheduled slot notifications</h2><p>Send automatic reminders to the School Messaging, school staff channel, in-app inbox, or email.</p></div></div>
        <div className="panel-body">
          <form action={saveScheduleNotificationRule} className="form-stack">
            <div className="form-grid two-column-form">
              <div className="field"><label htmlFor="rule_name">Rule name</label><input className="input" id="rule_name" name="name" required placeholder="72-hour school reminder" /></div>
              <div className="field"><label htmlFor="rule_cycle">Program</label><select className="select" id="rule_cycle" name="cycle_id"><option value="">All programs</option>{(cyclesResult.data ?? []).map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.season_year} — {cycle.name}</option>)}</select></div>
              <div className="field"><label htmlFor="rule_offset">Minutes before slot</label><input className="input" id="rule_offset" min="0" name="offset_minutes" required type="number" defaultValue="4320" /><small>4320 = 3 days; 1440 = 1 day; 120 = 2 hours.</small></div>
              <div className="field"><label htmlFor="rule_audience">Audience</label><select className="select" id="rule_audience" name="audience"><option value="school">School applicant</option><option value="school_staff">Assigned adjudicators and Advisory Committee</option></select></div>
              <div className="field"><label htmlFor="rule_destination">Destination</label><select className="select" id="rule_destination" name="destination"><option value="school_dm">School Messaging</option><option value="school_channel">Panel Channel</option><option value="in_app">In-app notification</option><option value="email">Email</option></select></div>
              <label className="check-card compact-check-card"><input defaultChecked name="active" type="checkbox" /><span><strong>Active</strong><small>Process this rule hourly.</small></span></label>
            </div>
            <div className="field"><label htmlFor="rule_title">Notification title</label><input className="input" id="rule_title" name="title_template" required defaultValue="Upcoming adjudication — {{school_name}}" /></div>
            <div className="field"><label htmlFor="rule_message">Message</label><textarea className="textarea" id="rule_message" name="message_template" required rows={5} defaultValue={"Reminder: {{school_name}} is scheduled for {{slot_date}} at {{slot_time}} at {{location}}."} /><small>Available variables: <code>{"{{school_name}}"}</code>, <code>{"{{production_title}}"}</code>, <code>{"{{slot_date}}"}</code>, <code>{"{{slot_time}}"}</code>, and <code>{"{{location}}"}</code>.</small></div>
            <button className="button button-dark" type="submit">Create notification rule</button>
          </form>
        </div>
        <div className="workflow-rule-list">
          {(rulesResult.data ?? []).map((rule) => <article className="workflow-rule-card" key={rule.id}><div><strong>{rule.name}</strong><p>{rule.offset_minutes} minutes before · {rule.audience} → {rule.destination}</p><small>{rule.active ? "Active" : "Inactive"}</small></div><form action={deleteScheduleNotificationRule.bind(null, rule.id)}><button className="button button-danger button-compact" type="submit">Delete</button></form></article>)}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>Daily Owner review email</h2><p>Summarizes schedule changes, appeals, disputes, and review submissions.</p></div></div>
        <div className="panel-body">
          <form action={saveDigestSettings} className="form-stack">
            <label className="check-card"><input defaultChecked={digest?.enabled ?? true} name="enabled" type="checkbox" /><span><strong>Send daily digest</strong><small>One email per Owner at the selected local hour.</small></span></label>
            <div className="form-grid two-column-form"><div className="field"><label>Delivery hour</label><select className="select" name="delivery_hour" defaultValue={String(digest?.delivery_hour ?? 8)}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{new Intl.DateTimeFormat("en-US", { hour: "numeric" }).format(new Date(2020, 0, 1, hour))}</option>)}</select></div><div className="field"><label>Time zone</label><input className="input" name="time_zone" defaultValue={digest?.time_zone ?? "America/New_York"} /></div></div>
            <div className="field"><label>Recipient email</label><input className="input" name="recipient_email" type="email" defaultValue={digest?.recipient_email ?? owner.email ?? ""} /></div>
            <label className="check-card compact-check-card"><input defaultChecked={digest?.include_empty ?? false} name="include_empty" type="checkbox" /><span><strong>Send empty reports</strong><small>Send even when there are no review items.</small></span></label>
            <button className="button button-dark" type="submit">Save digest settings</button>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>Advisory scoring permissions</h2><p>Allow an Advisory Committee member to score and/or comment for one school without changing their global role.</p></div></div>
        <div className="panel-body"><form action={assignScoringParticipant} className="form-stack"><div className="field"><label>Application</label><select className="select" name="application_id" required><option value="">Select school</option>{(applicationsResult.data ?? []).map((application) => <option key={application.id} value={application.id}>{application.school_name} — {application.production_title ?? "Untitled production"}</option>)}</select></div><div className="field"><label>Portal user</label><select className="select" name="user_id" required><option value="">Select user</option>{(usersResult.data ?? []).map((user) => <option key={user.id} value={user.id}>{user.full_name ?? user.email} — {user.role === "advisory_member" ? "Advisory Committee" : "Adjudicator"}</option>)}</select></div><div className="release-choice-grid"><label className="check-card"><input defaultChecked name="can_score" type="checkbox" /><span><strong>Scoring participant</strong><small>Receives a personal scorecard.</small></span></label><label className="check-card"><input defaultChecked name="can_comment" type="checkbox" /><span><strong>Commenting participant</strong><small>Can contribute criterion observations.</small></span></label></div><button className="button button-dark" type="submit">Save participant permissions</button></form></div>
      </section>

      <section className="panel workflow-feedback-panel">
        <div className="panel-header"><div><h2>Bug reports and feature requests</h2><p>Requests submitted from the portal menu.</p></div></div>
        <div className="workflow-feedback-list">{(feedbackResult.data ?? []).length === 0 ? <div className="empty-state"><p>No feedback requests.</p></div> : (feedbackResult.data ?? []).map((request) => <form action={updateFeedbackRequest} className="workflow-feedback-card" key={request.id}><input name="id" type="hidden" value={request.id} /><div><span className="badge">{request.request_type.replaceAll("_", " ")}</span><strong>{request.title}</strong><p>{request.description}</p><small>{formatDate(request.created_at)} · {request.priority}</small></div><div className="field"><label>Status</label><select className="select" name="status" defaultValue={request.status}><option value="new">New</option><option value="reviewing">Reviewing</option><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></div><div className="field"><label>Owner notes</label><textarea className="textarea compact-textarea" name="owner_notes" defaultValue={request.owner_notes ?? ""} /></div><button className="button button-secondary button-compact" type="submit">Save</button></form>)}</div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>Recent Owner review activity</h2><p>Included in the next daily digest.</p></div></div>
        <div className="owner-activity-list">{(activityResult.data ?? []).map((activity) => <article key={activity.id}><strong>{activity.title}</strong>{activity.detail && <p>{activity.detail}</p>}<small>{formatDate(activity.created_at)}</small></article>)}</div>
      </section>
    </div>
  );
}
