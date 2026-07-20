import {
  savePortalMessageTemplate,
  sendOwnerDigestNow,
} from "@/app/portal/schedule/admin-actions";

type MessageTemplate = {
  template_key: string;
  name: string;
  subject_template: string;
  body_template: string;
  send_in_app: boolean;
  send_school_messaging: boolean;
  send_email: boolean;
  active: boolean;
};

type DigestSettings = {
  enabled: boolean;
  recipient_email: string | null;
  delivery_hour: number;
  time_zone: string;
  last_sent_at: string | null;
} | null;

export function OwnerScheduleMessages({
  templates,
  digest,
}: {
  templates: MessageTemplate[];
  digest: DigestSettings;
}) {
  return (
    <div className="owner-schedule-message-grid">
      <section className="panel owner-message-template-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">School communications</p>
            <h2>Message templates</h2>
            <p>
              Configure the messages schools receive when they select a
              timeslot, receive final approval, or receive a waitlist offer.
            </p>
          </div>
        </div>
        <div className="panel-body owner-message-template-list">
          {templates.map((template) => (
            <details key={template.template_key}>
              <summary>
                <span>
                  <strong>{template.name}</strong>
                  <small>{template.active ? "Active" : "Inactive"}</small>
                </span>
                <span>Configure</span>
              </summary>
              <form action={savePortalMessageTemplate} className="form-stack">
                <input
                  name="template_key"
                  type="hidden"
                  value={template.template_key}
                />
                <div className="field">
                  <label>Subject</label>
                  <input
                    className="input"
                    defaultValue={template.subject_template}
                    name="subject_template"
                    required
                  />
                </div>
                <div className="field">
                  <label>Message</label>
                  <textarea
                    className="textarea"
                    defaultValue={template.body_template}
                    name="body_template"
                    required
                    rows={6}
                  />
                  <small>
                    Variables: {"{{school_name}}"}, {"{{production_title}}"},{" "}
                    {"{{slot_date}}"}, {"{{slot_time}}"}, {"{{location}}"},{" "}
                    {"{{school_instructions}}"}, {"{{offer_expires}}"}
                  </small>
                </div>
                <div className="message-template-destinations">
                  <label className="check-card compact-check-card">
                    <input
                      defaultChecked={template.send_in_app}
                      name="send_in_app"
                      type="checkbox"
                    />
                    <span><strong>In-app</strong></span>
                  </label>
                  <label className="check-card compact-check-card">
                    <input
                      defaultChecked={template.send_school_messaging}
                      name="send_school_messaging"
                      type="checkbox"
                    />
                    <span><strong>School Messaging</strong></span>
                  </label>
                  <label className="check-card compact-check-card">
                    <input
                      defaultChecked={template.send_email}
                      name="send_email"
                      type="checkbox"
                    />
                    <span><strong>Email</strong></span>
                  </label>
                  <label className="check-card compact-check-card">
                    <input
                      defaultChecked={template.active}
                      name="active"
                      type="checkbox"
                    />
                    <span><strong>Active</strong></span>
                  </label>
                </div>
                <button className="button button-dark" type="submit">
                  Save template
                </button>
              </form>
            </details>
          ))}
        </div>
      </section>

      <section className="panel owner-digest-now-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Owner review</p>
            <h2>Daily digest</h2>
            <p>Send the current 24-hour Owner review immediately.</p>
          </div>
        </div>
        <div className="panel-body form-stack">
          <div className="owner-digest-summary">
            <span>Recipient</span>
            <strong>{digest?.recipient_email || "Use Owner email"}</strong>
          </div>
          <div className="owner-digest-summary">
            <span>Scheduled delivery</span>
            <strong>
              {digest?.enabled
                ? `${digest.delivery_hour}:00 · ${digest.time_zone}`
                : "Scheduled digest disabled"}
            </strong>
          </div>
          <div className="owner-digest-summary">
            <span>Last sent</span>
            <strong>
              {digest?.last_sent_at
                ? new Date(digest.last_sent_at).toLocaleString("en-US")
                : "Not sent yet"}
            </strong>
          </div>
          <form action={sendOwnerDigestNow}>
            <button className="button button-gold" type="submit">
              Send daily digest now
            </button>
          </form>
          <a className="text-button" href="/portal/admin/setup?tab=workflows">
            Edit digest schedule and notification rules
          </a>
        </div>
      </section>
    </div>
  );
}
