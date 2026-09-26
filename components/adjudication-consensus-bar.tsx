"use client";

import { useActionState, useMemo, useState } from "react";

import { assignPanelNarrativeReviewer } from "@/app/portal/adjudication/[id]/actions";
import {
  ownerUpdateAdjudicationReview,
  saveAllCategoryProposals,
  submitPanelForOwnerReview,
  type CategoryProposalSaveResult,
} from "@/app/portal/adjudication/[id]/workflow-actions";
import { ScheduleSubmitButton } from "@/components/schedule-submit-button";
import { formatTwoPointRangeStart } from "@/lib/adjudication-ranges";
import type { AppRole, ScoringCategory } from "@/lib/types";

type Proposal = {
  id: string;
  application_id: string;
  category_id: string;
  proposed_by: string;
  is_eligible: boolean;
  range_min: number | null;
  range_max: number | null;
  status: string;
  advisory_note: string | null;
  owner_override_note: string | null;
};

type Review = { status: string; owner_note: string | null } | null;

type PanelReviewer = {
  id: string;
  name: string;
  role: "adjudicator" | "advisory_member";
};

type NarrativeAssignment = {
  category_id: string;
  assigned_to: string | null;
};

function statusLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const rangeOptions = Array.from(
  { length: 29 },
  (_, index) => 1 + index * 0.25,
).filter((value) => value <= 8);

const initialCategorySaveResult: CategoryProposalSaveResult = { ok: false };

export function AdjudicationConsensusBar({
  applicationId,
  categories,
  narrativeAssignments,
  narrativesReady,
  panelReviewers,
  proposals,
  review,
  role,
}: {
  applicationId: string;
  role: AppRole;
  currentUserId: string;
  categories: ScoringCategory[];
  proposals: Proposal[];
  approvals: unknown[];
  review: Review;
  narrativesReady: boolean;
  narrativeAssignments: NarrativeAssignment[];
  panelReviewers: PanelReviewer[];
}) {
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const saveCategoryAction = useMemo(
    () => saveAllCategoryProposals.bind(null, applicationId),
    [applicationId],
  );
  const [categorySaveResult, categorySaveAction] = useActionState(
    saveCategoryAction,
    initialCategorySaveResult,
  );
  const proposalByCategory = useMemo(
    () => new Map(proposals.map((proposal) => [proposal.category_id, proposal])),
    [proposals],
  );
  const assignmentByCategory = useMemo(
    () =>
      new Map(
        narrativeAssignments.map((assignment) => [
          assignment.category_id,
          assignment.assigned_to,
        ]),
      ),
    [narrativeAssignments],
  );
  const reviewerById = useMemo(
    () => new Map(panelReviewers.map((reviewer) => [reviewer.id, reviewer])),
    [panelReviewers],
  );
  const unresolved = categories.filter((category) => {
    const proposal = proposalByCategory.get(category.id);
    return !proposal || !["approved", "overridden"].includes(proposal.status);
  }).length;
  const disputed = proposals.filter(
    (proposal) => proposal.status === "disputed",
  ).length;
  const canSetDecisions = role === "advisory_member" || role === "owner";

  return (
    <>
      <div className="adjudication-consensus-bar consolidated-consensus-bar">
        <div className="consensus-summary">
          <strong>Eligibility &amp; two-point ranges</strong>
          <span
            className={unresolved ? "badge badge-warning" : "badge badge-complete"}
          >
            {unresolved ? `${unresolved} unresolved` : "All approved"}
          </span>
          {disputed > 0 && (
            <span className="badge badge-warning">{disputed} disputed</span>
          )}
          {review && <span className="badge">{statusLabel(review.status)}</span>}
        </div>
        <div className="consensus-main-actions">
          {canSetDecisions && (
            <button
              className="button button-secondary button-compact"
              onClick={() => setMatrixOpen(true)}
              type="button"
            >
              Review all categories
            </button>
          )}
          {canSetDecisions && (
            <button
              className="button button-dark button-compact"
              onClick={() => setReviewOpen(true)}
              type="button"
            >
              Panel review
            </button>
          )}
        </div>
      </div>

      {categorySaveResult.ok && categorySaveResult.message && (
        <div
          aria-live="polite"
          className="notice-banner success-banner page-message"
          role="status"
        >
          {categorySaveResult.message}
        </div>
      )}

      {matrixOpen && canSetDecisions && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMatrixOpen(false);
          }}
        >
          <div
            aria-modal="true"
            className="modal-card consensus-matrix-modal"
            role="dialog"
          >
            <form action={categorySaveAction}>
              <div className="modal-header sticky-modal-header">
                <div>
                  <p className="eyebrow">Advisory Committee review</p>
                  <h2>Eligibility, ranges &amp; final comments</h2>
                  <p>
                    Set category decisions and assign each final comment before
                    the Owner sends it to the panel.
                  </p>
                </div>
                <div className="modal-header-actions">
                  <ScheduleSubmitButton
                    className="button button-gold"
                    pendingLabel="Saving all decisions…"
                  >
                    Save all category decisions
                  </ScheduleSubmitButton>
                  <button
                    className="modal-close"
                    onClick={() => setMatrixOpen(false)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              </div>

              {!categorySaveResult.ok && categorySaveResult.error && (
                <div className="form-error page-message" role="alert">
                  {categorySaveResult.error}
                </div>
              )}
              {categorySaveResult.ok && categorySaveResult.message && (
                <div
                  className="notice-banner success-banner page-message"
                  role="status"
                >
                  {categorySaveResult.message}
                </div>
              )}

              <div className="consensus-matrix-table-wrap">
                <table className="data-table consensus-matrix-table">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Eligible</th>
                      <th>Two-point range</th>
                      <th>Final comment reviewer</th>
                      <th>Status</th>
                      <th>Advisory note</th>
                      {role === "owner" && <th>Owner override</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((category) => {
                      const proposal = proposalByCategory.get(category.id);
                      const assigneeId = assignmentByCategory.get(category.id);
                      const assignedReviewer = assigneeId
                        ? reviewerById.get(assigneeId)
                        : undefined;
                      const assigneeFieldName = `assigned_to_${category.id}`;

                      return (
                        <tr
                          className={
                            proposal?.status === "disputed"
                              ? "consensus-row-disputed"
                              : ""
                          }
                          key={category.id}
                        >
                          <td>
                            <input
                              name="category_id"
                              type="hidden"
                              value={category.id}
                            />
                            <strong>{category.title}</strong>
                            <small>{category.description}</small>
                          </td>
                          <td>
                            <label className="switch-control">
                              <input
                                defaultChecked={proposal?.is_eligible ?? true}
                                name={`eligible_${category.id}`}
                                type="checkbox"
                              />
                              <span>Eligible</span>
                            </label>
                          </td>
                          <td>
                            <select
                              className="select"
                              defaultValue={formatTwoPointRangeStart(
                                proposal?.range_min,
                              )}
                              name={`range_${category.id}`}
                            >
                              <option value="">No range</option>
                              {rangeOptions.map((value) => (
                                <option key={value} value={value.toFixed(2)}>
                                  {value.toFixed(2)}–{(value + 2).toFixed(2)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            {role === "advisory_member" ? (
                              <div className="consensus-comment-assignment">
                                <select
                                  aria-label={`Final comment reviewer for ${category.title}`}
                                  className="select"
                                  defaultValue={assigneeId ?? ""}
                                  name={assigneeFieldName}
                                >
                                  <option value="">Choose panel member</option>
                                  {panelReviewers.map((reviewer) => (
                                    <option key={reviewer.id} value={reviewer.id}>
                                      {reviewer.name}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  className="text-button"
                                  formAction={assignPanelNarrativeReviewer.bind(
                                    null,
                                    applicationId,
                                    category.id,
                                    assigneeFieldName,
                                  )}
                                  formNoValidate
                                  type="submit"
                                >
                                  Save assignment
                                </button>
                              </div>
                            ) : (
                              <span>
                                {assignedReviewer?.name ?? "Unassigned"}
                              </span>
                            )}
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                proposal?.status === "approved" ||
                                proposal?.status === "overridden"
                                  ? "badge-complete"
                                  : "badge-warning"
                              }`}
                            >
                              {proposal
                                ? statusLabel(proposal.status)
                                : "Not proposed"}
                            </span>
                          </td>
                          <td>
                            <textarea
                              className="textarea compact-textarea"
                              defaultValue={proposal?.advisory_note ?? ""}
                              name={`note_${category.id}`}
                              placeholder="Context for adjudicators"
                            />
                          </td>
                          {role === "owner" && (
                            <td>
                              <label className="inline-check">
                                <input
                                  defaultChecked={
                                    proposal?.status === "overridden"
                                  }
                                  name={`override_${category.id}`}
                                  type="checkbox"
                                />
                                Override
                              </label>
                              <input
                                className="input input-compact"
                                defaultValue={
                                  proposal?.owner_override_note ?? ""
                                }
                                name={`override_note_${category.id}`}
                                placeholder="Required override note"
                              />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="sticky-modal-footer">
                <button
                  className="button button-secondary"
                  onClick={() => setMatrixOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <ScheduleSubmitButton
                  className="button button-gold"
                  pendingLabel="Saving all decisions…"
                >
                  Save all category decisions
                </ScheduleSubmitButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {reviewOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setReviewOpen(false);
          }}
        >
          <div aria-modal="true" className="modal-card" role="dialog">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Panel workflow</p>
                <h2>Send adjudication to Owners</h2>
              </div>
              <button
                className="modal-close"
                onClick={() => setReviewOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="consensus-review-checklist">
              <p>
                <strong>Category decisions:</strong>{" "}
                {unresolved === 0 ? "Complete" : `${unresolved} unresolved`}
              </p>
              <p>
                <strong>Final comments:</strong>{" "}
                {narrativesReady ? "All panel approved" : "Approval in progress"}
              </p>
              <p>
                <strong>Current status:</strong>{" "}
                {statusLabel(review?.status ?? "draft")}
              </p>
            </div>
            {role === "advisory_member" && (
              <form action={submitPanelForOwnerReview.bind(null, applicationId)}>
                <button
                  className="button button-dark"
                  disabled={unresolved > 0 || !narrativesReady}
                  type="submit"
                >
                  Send to Owners for review
                </button>
              </form>
            )}
            {role === "owner" && (
              <form
                action={ownerUpdateAdjudicationReview.bind(null, applicationId)}
                className="form-stack"
              >
                <div className="field">
                  <label>Owner note</label>
                  <textarea
                    className="textarea"
                    defaultValue={review?.owner_note ?? ""}
                    name="owner_note"
                    rows={5}
                  />
                </div>
                <div className="modal-actions">
                  <button
                    className="button button-danger"
                    name="status"
                    type="submit"
                    value="returned"
                  >
                    Return to Advisory Committee
                  </button>
                  <button
                    className="button button-secondary"
                    name="status"
                    type="submit"
                    value="owner_review"
                  >
                    Mark under Owner review
                  </button>
                  <button
                    className="button button-dark"
                    name="status"
                    type="submit"
                    value="released"
                  >
                    Mark workflow complete
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
