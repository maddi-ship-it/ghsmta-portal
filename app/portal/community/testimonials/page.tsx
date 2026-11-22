import { requireProfile } from "@/lib/auth";
import { roleLabel } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  reviewCommunityTestimonial,
  submitCommunityTestimonial,
} from "./actions";

type TestimonialQuery = {
  error?: string;
  saved?: string;
};

type TestimonialRow = {
  id: string;
  submitted_by: string;
  testimonial: string;
  attribution_name: string;
  organization: string | null;
  relationship: string;
  status: "pending" | "approved" | "declined";
  owner_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  student: "Student",
  educator: "Educator or school staff",
  adjudicator: "Adjudicator",
  advisory_member: "Advisory Committee member",
  production_team: "Production team member",
  parent_guardian: "Parent or guardian",
  community_partner: "Community partner",
  other: "Other",
};

function defaultRelationship(role: string) {
  if (role === "adjudicator") return "adjudicator";
  if (role === "advisory_member") return "advisory_member";
  if (role === "production") return "production_team";
  if (role === "applicant" || role === "program_manager") return "educator";
  return "other";
}

function statusLabel(status: TestimonialRow["status"]) {
  if (status === "approved") return "Approved";
  if (status === "declined") return "Not selected";
  return "Pending review";
}

export default async function CommunityTestimonialsPage({
  searchParams,
}: {
  searchParams: Promise<TestimonialQuery>;
}) {
  const profile = await requireProfile();
  const query = await searchParams;
  const admin = createAdminClient();
  let testimonialQuery = admin
    .from("community_testimonials")
    .select(
      "id,submitted_by,testimonial,attribution_name,organization,relationship,status,owner_notes,created_at,reviewed_at",
    )
    .order("created_at", { ascending: false });

  if (profile.role !== "owner") {
    testimonialQuery = testimonialQuery.eq("submitted_by", profile.id);
  }

  const { data, error } = await testimonialQuery;
  if (error) throw new Error(error.message);
  const testimonials = (data ?? []) as TestimonialRow[];
  const pendingCount = testimonials.filter(
    (testimonial) => testimonial.status === "pending",
  ).length;

  return (
    <div className="page-stack community-testimonials-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Community</span>
          <h1>Share your GHSMTA story</h1>
          <p>
            Tell us about an experience, connection, or moment that made
            GHSMTA meaningful to you.
          </p>
        </div>
      </header>

      {query.saved ? (
        <div className="notice page-message" role="status">
          {query.saved}
        </div>
      ) : null}
      {query.error ? (
        <div className="form-error page-message" role="alert">
          {query.error}
        </div>
      ) : null}

      <section className="panel testimonial-submission-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Testimonial submission</span>
            <h2>What would you like people to know?</h2>
            <p>
              Your submission is reviewed by the GHSMTA team before it is used
              anywhere publicly.
            </p>
          </div>
        </div>
        <div className="panel-body">
          <form action={submitCommunityTestimonial} className="form-stack testimonial-form">
            <div className="field">
              <label htmlFor="testimonial">Your testimonial</label>
              <textarea
                className="textarea"
                id="testimonial"
                maxLength={4000}
                minLength={50}
                name="testimonial"
                placeholder="Share a specific moment, impact, or experience..."
                required
                rows={8}
              />
              <small>At least 50 characters. Specific stories are especially helpful.</small>
            </div>

            <div className="testimonial-form-grid">
              <div className="field">
                <label htmlFor="attribution_name">Name shown with your testimonial</label>
                <input
                  className="input"
                  defaultValue={
                    profile.preferred_name ??
                    profile.full_name ??
                    profile.email ??
                    ""
                  }
                  id="attribution_name"
                  maxLength={150}
                  name="attribution_name"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="organization">School or organization</label>
                <input
                  className="input"
                  defaultValue={profile.organization ?? ""}
                  id="organization"
                  maxLength={180}
                  name="organization"
                  placeholder="Optional"
                />
              </div>
              <div className="field">
                <label htmlFor="relationship">Your connection to GHSMTA</label>
                <select
                  className="select"
                  defaultValue={defaultRelationship(profile.role)}
                  id="relationship"
                  name="relationship"
                  required
                >
                  {Object.entries(RELATIONSHIP_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="testimonial-account-context">
                <span>Submitting as</span>
                <strong>{profile.full_name ?? profile.email}</strong>
                <small>{roleLabel(profile.role)}</small>
              </div>
            </div>

            <label className="testimonial-permission-card">
              <input name="permission_to_publish" required type="checkbox" />
              <span>
                <strong>I give GHSMTA permission to use this testimonial.</strong>
                <small>
                  GHSMTA may edit it lightly for length or clarity while
                  preserving its meaning. Nothing is published automatically.
                </small>
              </span>
            </label>

            <div className="form-actions">
              <button className="button button-gold" type="submit">
                Submit testimonial
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">
              {profile.role === "owner" ? "Owner review" : "Your submissions"}
            </span>
            <h2>
              {profile.role === "owner"
                ? `${pendingCount} awaiting review`
                : "Submission history"}
            </h2>
            <p>
              {profile.role === "owner"
                ? "Approve testimonials for future GHSMTA use or mark them as not selected."
                : "See the review status of testimonials you have shared."}
            </p>
          </div>
        </div>
        <div className="panel-body testimonial-review-list">
          {testimonials.length ? (
            testimonials.map((testimonial) => (
              <article className="testimonial-review-card" key={testimonial.id}>
                <div className="testimonial-review-heading">
                  <div>
                    <strong>{testimonial.attribution_name}</strong>
                    <span>
                      {[
                        testimonial.organization,
                        RELATIONSHIP_LABELS[testimonial.relationship],
                      ].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  <span className={`badge testimonial-status-${testimonial.status}`}>
                    {statusLabel(testimonial.status)}
                  </span>
                </div>
                <blockquote>{testimonial.testimonial}</blockquote>
                <small>
                  Submitted {new Intl.DateTimeFormat("en-US", {
                    dateStyle: "medium",
                  }).format(new Date(testimonial.created_at))}
                </small>

                {profile.role === "owner" ? (
                  <form
                    action={reviewCommunityTestimonial.bind(null, testimonial.id)}
                    className="testimonial-owner-review"
                  >
                    <div className="field">
                      <label htmlFor={`owner_notes_${testimonial.id}`}>
                        Review note (visible to submitter)
                      </label>
                      <textarea
                        className="textarea"
                        defaultValue={testimonial.owner_notes ?? ""}
                        id={`owner_notes_${testimonial.id}`}
                        maxLength={4000}
                        name="owner_notes"
                        placeholder="Optional message for the submitter"
                        rows={2}
                      />
                    </div>
                    <div className="testimonial-review-actions">
                      <button className="button button-secondary" name="decision" type="submit" value="declined">
                        Not selected
                      </button>
                      <button className="button button-gold" name="decision" type="submit" value="approved">
                        Approve testimonial
                      </button>
                    </div>
                  </form>
                ) : testimonial.owner_notes ? (
                  <div className="owner-response">
                    <strong>GHSMTA note</strong>
                    <p>{testimonial.owner_notes}</p>
                  </div>
                ) : null}
              </article>
            ))
          ) : (
            <div className="empty-state">
              <h3>No testimonials yet</h3>
              <p>
                {profile.role === "owner"
                  ? "New community submissions will appear here for review."
                  : "Your submitted testimonials will appear here."}
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
