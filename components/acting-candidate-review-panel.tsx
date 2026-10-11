"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";

import {
  respondActingCandidateReview,
  submitActingCandidateReview,
} from "@/app/portal/adjudication/[id]/candidate-actions";
import type {
  ActingCandidateReviewer,
  ActingCandidateReviewState,
} from "@/lib/acting-candidate-review";
import type { AppRole } from "@/lib/types";

function statusLabel(status: ActingCandidateReviewState["status"]) {
  if (status === "changes_requested") return "Changes requested";
  if (status === "approved") return "Panel approved";
  if (status === "pending") return "Panel approval in progress";
  return "Not submitted";
}

function CandidateActionButton({
  children,
  pendingLabel,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button {...props} disabled={disabled || pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}

export function ActingCandidateReviewPanel({
  applicationId,
  currentUserId,
  reviewers,
  role,
  state,
}: {
  applicationId: string;
  currentUserId: string;
  reviewers: ActingCandidateReviewer[];
  role: AppRole;
  state: ActingCandidateReviewState;
}) {
  const canEdit = role === "advisory_member";
  const canApprove = state.requiredApproverIds.includes(currentUserId);
  const reviewerById = new Map(
    reviewers.map((reviewer) => [reviewer.id, reviewer]),
  );
  const approvalByUserId = new Map(
    state.approvals.map((approval) => [approval.userId, approval]),
  );
  const approvedCount = state.requiredApproverIds.filter(
    (userId) => approvalByUserId.get(userId)?.response === "approved",
  ).length;
  const currentApproval = approvalByUserId.get(currentUserId);
  const hasRequestedChanges = state.approvals.some(
    (approval) => approval.response === "changes_requested",
  );

  return (
    <section className="acting-candidate-review-card">
      <header className="acting-candidate-review-header">
        <div>
          <span className="advisory-decision-category-number">
            Acting candidate confirmation
          </span>
          <h3>Panel-approved acting candidates</h3>
          <p>
            The school&apos;s submitted roster stays in effect until the full
            panel approves this exact list. A revision resets prior approvals.
          </p>
        </div>
        <div className="acting-candidate-review-status">
          <span
            className={`badge ${
              state.status === "approved"
                ? "badge-complete"
                : "badge-warning"
            }`}
          >
            {statusLabel(state.status)}
          </span>
          <small>
            {approvedCount}/{state.requiredApproverIds.length} panel approvals
          </small>
        </div>
      </header>

      <div className="acting-candidate-roster">
        {state.candidates.map((candidate) => (
          <article className="acting-candidate-row" key={candidate.slot}>
            <h4>{candidate.label}</h4>
            {canEdit ? (
              <div className="acting-candidate-fields">
                <label>
                  <span>Name</span>
                  <input
                    className="input input-compact"
                    defaultValue={candidate.name}
                    key={`${state.revision}-${candidate.slot}-name`}
                    name={`candidate_${candidate.slot}_name`}
                    required
                  />
                </label>
                <label>
                  <span>Pronouns</span>
                  <input
                    className="input input-compact"
                    defaultValue={candidate.pronouns}
                    key={`${state.revision}-${candidate.slot}-pronouns`}
                    name={`candidate_${candidate.slot}_pronouns`}
                  />
                </label>
                <label>
                  <span>Role</span>
                  <input
                    className="input input-compact"
                    defaultValue={candidate.role}
                    key={`${state.revision}-${candidate.slot}-role`}
                    name={`candidate_${candidate.slot}_role`}
                    required
                  />
                </label>
                <label>
                  <span>Grade level</span>
                  <input
                    className="input input-compact"
                    defaultValue={candidate.gradeLevel}
                    key={`${state.revision}-${candidate.slot}-grade`}
                    name={`candidate_${candidate.slot}_grade_level`}
                  />
                </label>
              </div>
            ) : (
              <dl className="acting-candidate-readonly-fields">
                <div>
                  <dt>Name</dt>
                  <dd>{candidate.name || "Not provided"}</dd>
                </div>
                <div>
                  <dt>Pronouns</dt>
                  <dd>{candidate.pronouns || "Not provided"}</dd>
                </div>
                <div>
                  <dt>Role</dt>
                  <dd>{candidate.role || "Not provided"}</dd>
                </div>
                <div>
                  <dt>Grade level</dt>
                  <dd>{candidate.gradeLevel || "Not provided"}</dd>
                </div>
              </dl>
            )}
          </article>
        ))}
      </div>

      <div className="acting-candidate-approval-grid">
        {state.requiredApproverIds.map((userId) => {
          const reviewer = reviewerById.get(userId);
          const approval = approvalByUserId.get(userId);
          return (
            <div className="acting-candidate-approval" key={userId}>
              <div>
                <strong>{reviewer?.name ?? "Panel member"}</strong>
                <small>
                  {reviewer?.role === "advisory_member"
                    ? "Advisory Committee"
                    : "Adjudicator"}
                </small>
              </div>
              <span
                className={`badge ${
                  approval?.response === "approved"
                    ? "badge-complete"
                    : "badge-warning"
                }`}
              >
                {approval?.response === "approved"
                  ? "Approved"
                  : approval?.response === "changes_requested"
                    ? "Changes requested"
                    : "Needs response"}
              </span>
              {approval?.comment && <p>{approval.comment}</p>}
            </div>
          );
        })}
      </div>

      {state.requiredApproverIds.length === 0 && (
        <div className="form-error">
          Assign the full adjudication panel before submitting this roster.
        </div>
      )}

      <div className="acting-candidate-review-actions">
        {canEdit && (
          <CandidateActionButton
            className="button button-gold"
            disabled={state.requiredApproverIds.length === 0}
            formAction={submitActingCandidateReview.bind(null, applicationId)}
            formNoValidate
            onClick={(event) => {
              const reviewCard = event.currentTarget.closest(
                ".acting-candidate-review-card",
              );
              const requiredFields = reviewCard?.querySelectorAll(
                "input[required]",
              );
              const firstInvalid = [...(requiredFields ?? [])].find(
                (field) =>
                  field instanceof HTMLInputElement && !field.value.trim(),
              );
              if (firstInvalid instanceof HTMLInputElement) {
                event.preventDefault();
                firstInvalid.reportValidity();
              }
            }}
            pendingLabel="Sending roster…"
            type="submit"
          >
            {state.revision === 0
              ? "Send acting candidates for panel approval"
              : "Save revision & send for full-panel approval"}
          </CandidateActionButton>
        )}

        {canApprove &&
          role !== "owner" &&
          state.status === "pending" &&
          currentApproval?.response !== "approved" && (
            <div className="acting-candidate-response-controls">
              <CandidateActionButton
                className="button button-gold"
                formAction={respondActingCandidateReview.bind(
                  null,
                  applicationId,
                  "approved",
                )}
                formNoValidate
                pendingLabel="Saving approval…"
                type="submit"
              >
                Approve acting candidates
              </CandidateActionButton>
              <details className="range-review-dispute">
                <summary>Request a candidate change</summary>
                <label htmlFor="candidate_change_request">
                  What should the ACM update?
                </label>
                <textarea
                  className="textarea compact-textarea"
                  id="candidate_change_request"
                  minLength={3}
                  name="candidate_change_request"
                  placeholder="Identify the candidate and requested correction"
                />
                <CandidateActionButton
                  className="button button-danger button-compact"
                  formAction={respondActingCandidateReview.bind(
                    null,
                    applicationId,
                    "changes_requested",
                  )}
                  formNoValidate
                  onClick={(event) => {
                    const field =
                      event.currentTarget.form?.elements.namedItem(
                        "candidate_change_request",
                      );
                    if (
                      field instanceof HTMLTextAreaElement &&
                      field.value.trim().length < 3
                    ) {
                      event.preventDefault();
                      field.setCustomValidity(
                        "Add a short note explaining the candidate change.",
                      );
                      field.reportValidity();
                    }
                  }}
                  pendingLabel="Sending request…"
                  type="submit"
                >
                  Send change request
                </CandidateActionButton>
              </details>
            </div>
          )}

        {state.status === "pending" &&
          currentApproval?.response === "approved" && (
            <p className="acting-candidate-action-note">
              You approved revision {state.revision}. Waiting for the rest of
              the panel.
            </p>
          )}
        {state.status === "changes_requested" && (
          <p className="acting-candidate-action-note">
            {canEdit
              ? "Update the roster above and send a new revision. Every panel member will approve the revised list."
              : "The ACM is updating this roster. Approval will reopen after the revised list is sent."}
          </p>
        )}
        {state.status === "approved" && (
          <p className="acting-candidate-action-note acting-candidate-action-note-complete">
            The full panel approved revision {state.revision}. The confirmation
            message was posted to the school channel.
          </p>
        )}
        {hasRequestedChanges && state.status === "pending" && (
          <p className="acting-candidate-action-note">
            A prior change request remains in this revision.
          </p>
        )}
      </div>
    </section>
  );
}
