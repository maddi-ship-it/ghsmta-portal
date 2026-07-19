"use client";

import { useMemo, useState } from "react";

import {
  ownerUpdateAdjudicationReview,
  respondCategoryProposal,
  saveCategoryProposal,
  submitPanelForOwnerReview,
} from "@/app/portal/adjudication/[id]/workflow-actions";
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

type Approval = {
  id: string;
  proposal_id: string;
  adjudicator_user_id: string;
  response: string;
  comment: string | null;
};

type Review = { status: string; owner_note: string | null } | null;

function statusLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const rangeOptions = Array.from({ length: 29 }, (_, index) => 1 + index * 0.25).filter((value) => value <= 8);

export function AdjudicationConsensusBar({
  applicationId,
  role,
  currentUserId,
  categories,
  proposals,
  approvals,
  review,
}: {
  applicationId: string;
  role: AppRole;
  currentUserId: string;
  categories: ScoringCategory[];
  proposals: Proposal[];
  approvals: Approval[];
  review: Review;
}) {
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const proposalByCategory = useMemo(() => new Map(proposals.map((proposal) => [proposal.category_id, proposal])), [proposals]);
  const unresolved = categories.filter((category) => {
    const proposal = proposalByCategory.get(category.id);
    return !proposal || !["approved", "overridden"].includes(proposal.status);
  }).length;
  const disputed = proposals.filter((proposal) => proposal.status === "disputed").length;

  return (
    <>
      <div className="adjudication-consensus-bar consolidated-consensus-bar">
        <div className="consensus-summary">
          <strong>Eligibility &amp; two-point ranges</strong>
          <span className={unresolved ? "badge badge-warning" : "badge badge-complete"}>{unresolved ? `${unresolved} unresolved` : "All approved"}</span>
          {disputed > 0 && <span className="badge badge-warning">{disputed} disputed</span>}
          {review && <span className="badge">{statusLabel(review.status)}</span>}
        </div>
        <div className="consensus-main-actions">
          <button className="button button-secondary button-compact" onClick={() => setMatrixOpen(true)} type="button">Review all categories</button>
          {(role === "advisory_member" || role === "owner") && <button className="button button-dark button-compact" onClick={() => setReviewOpen(true)} type="button">Panel review</button>}
        </div>
      </div>

      {matrixOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMatrixOpen(false); }}>
          <div className="modal-card consensus-matrix-modal" role="dialog" aria-modal="true">
            <div className="modal-header"><div><span className="eyebrow">Advisory Committee review</span><h2>Eligibility &amp; two-point ranges</h2><p>Complete every category in one workspace. Adjudicators can approve or dispute each row.</p></div><button className="modal-close" onClick={() => setMatrixOpen(false)} type="button">×</button></div>
            <div className="consensus-matrix-table-wrap">
              <table className="data-table consensus-matrix-table">
                <thead><tr><th>Category</th><th>Decision</th><th>Range</th><th>Status</th><th>Notes / response</th><th>Action</th></tr></thead>
                <tbody>
                  {categories.map((category) => {
                    const proposal = proposalByCategory.get(category.id) ?? null;
                    const ownApproval = proposal ? approvals.find((approval) => approval.proposal_id === proposal.id && approval.adjudicator_user_id === currentUserId) ?? null : null;
                    return (
                      <tr className={proposal?.status === "disputed" ? "consensus-row-disputed" : ""} key={category.id}>
                        <td><strong>{category.title}</strong><small>{category.description}</small></td>
                        {(role === "advisory_member" || role === "owner") ? (
                          <>
                            <td colSpan={5}>
                              <form action={saveCategoryProposal.bind(null, applicationId, category.id)} className="consensus-row-form">
                                <label className="inline-check"><input defaultChecked={proposal?.is_eligible ?? true} name="is_eligible" type="checkbox" /> Eligible</label>
                                <select className="select" defaultValue={proposal?.range_min == null ? "" : String(proposal.range_min)} name="range_min"><option value="">Select range</option>{rangeOptions.map((value) => <option key={value} value={value.toFixed(2)}>{value.toFixed(2)}–{(value + 2).toFixed(2)}</option>)}</select>
                                <span className={`badge ${proposal?.status === "approved" || proposal?.status === "overridden" ? "badge-complete" : "badge-warning"}`}>{proposal ? statusLabel(proposal.status) : "Not proposed"}</span>
                                <textarea className="textarea compact-textarea" defaultValue={proposal?.advisory_note ?? ""} name="advisory_note" placeholder="Advisory note" />
                                {role === "owner" && <div className="consensus-owner-override"><label className="inline-check"><input name="owner_override" type="checkbox" /> Override</label><input className="input input-compact" defaultValue={proposal?.owner_override_note ?? ""} name="owner_override_note" placeholder="Override note" /></div>}
                                <button className="button button-secondary button-compact" type="submit">Save</button>
                              </form>
                            </td>
                          </>
                        ) : (
                          <>
                            <td>{proposal ? (proposal.is_eligible ? "Eligible" : "Not eligible") : "Pending"}</td>
                            <td>{proposal?.is_eligible && proposal.range_min != null && proposal.range_max != null ? `${Number(proposal.range_min).toFixed(2)}–${Number(proposal.range_max).toFixed(2)}` : "—"}</td>
                            <td><span className={`badge ${proposal?.status === "approved" || proposal?.status === "overridden" ? "badge-complete" : "badge-warning"}`}>{proposal ? statusLabel(proposal.status) : "Not proposed"}</span></td>
                            <td>{proposal ? <form action={respondCategoryProposal.bind(null, applicationId, proposal.id)} className="consensus-response-inline"><input className="input input-compact" defaultValue={ownApproval?.comment ?? ""} name="comment" placeholder="Comment if disputing" /><button className="button button-danger button-compact" name="response" type="submit" value="disputed">Dispute</button><button className="button button-dark button-compact" name="response" type="submit" value="approved">Approve</button></form> : <span className="muted-copy">Awaiting Advisory Committee proposal.</span>}</td>
                            <td>{ownApproval ? statusLabel(ownApproval.response) : "Pending"}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {reviewOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReviewOpen(false); }}>
          <div className="modal-card" role="dialog" aria-modal="true">
            <div className="modal-header"><div><span className="eyebrow">Panel workflow</span><h2>Send adjudication to Owners</h2></div><button className="modal-close" onClick={() => setReviewOpen(false)} type="button">×</button></div>
            <div className="consensus-review-checklist"><p><strong>Category decisions:</strong> {unresolved === 0 ? "Complete" : `${unresolved} unresolved`}</p><p><strong>Current status:</strong> {statusLabel(review?.status ?? "draft")}</p></div>
            {role === "advisory_member" && <form action={submitPanelForOwnerReview.bind(null, applicationId)}><button className="button button-dark" disabled={unresolved > 0} type="submit">Send to Owners for review</button></form>}
            {role === "owner" && <form action={ownerUpdateAdjudicationReview.bind(null, applicationId)} className="form-stack"><div className="field"><label>Owner note</label><textarea className="textarea" defaultValue={review?.owner_note ?? ""} name="owner_note" rows={5} /></div><div className="modal-actions"><button className="button button-danger" name="status" type="submit" value="returned">Return to Advisory Committee</button><button className="button button-secondary" name="status" type="submit" value="owner_review">Mark under Owner review</button><button className="button button-dark" name="status" type="submit" value="released">Mark workflow complete</button></div></form>}
          </div>
        </div>
      )}
    </>
  );
}
