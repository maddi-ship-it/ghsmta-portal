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

export function AdjudicationConsensusBar({
  applicationId,
  role,
  currentUserId,
  categories,
  proposals,
  approvals,
  review,
  isScoringParticipant,
}: {
  applicationId: string;
  role: AppRole;
  currentUserId: string;
  categories: ScoringCategory[];
  proposals: Proposal[];
  approvals: Approval[];
  review: Review;
  isScoringParticipant: boolean;
}) {
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const proposalByCategory = useMemo(() => new Map(proposals.map((proposal) => [proposal.category_id, proposal])), [proposals]);
  const activeCategory = categories.find((category) => category.id === activeCategoryId) ?? null;
  const activeProposal = activeCategory ? proposalByCategory.get(activeCategory.id) ?? null : null;
  const ownApproval = activeProposal
    ? approvals.find((approval) => approval.proposal_id === activeProposal.id && approval.adjudicator_user_id === currentUserId)
    : null;
  const unresolved = categories.filter((category) => {
    const proposal = proposalByCategory.get(category.id);
    return !proposal || !["approved", "overridden"].includes(proposal.status);
  }).length;

  return (
    <>
      <div className="adjudication-consensus-bar">
        <div className="consensus-summary">
          <strong>Eligibility & range approvals</strong>
          <span className={unresolved ? "badge badge-warning" : "badge badge-complete"}>{unresolved ? `${unresolved} unresolved` : "All approved"}</span>
          {review && <span className="badge">{statusLabel(review.status)}</span>}
        </div>
        <div className="consensus-category-buttons">
          {categories.map((category) => {
            const proposal = proposalByCategory.get(category.id);
            return <button className={proposal?.status === "disputed" ? "consensus-category-button is-disputed" : proposal?.status === "approved" || proposal?.status === "overridden" ? "consensus-category-button is-approved" : "consensus-category-button"} key={category.id} onClick={() => setActiveCategoryId(category.id)} type="button"><span>{category.title}</span><small>{proposal ? statusLabel(proposal.status) : "Not proposed"}</small></button>;
          })}
        </div>
        {(role === "advisory_member" || role === "owner") && <button className="button button-dark button-compact" onClick={() => setReviewOpen(true)} type="button">Panel review</button>}
      </div>

      {activeCategory && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setActiveCategoryId(null); }}>
          <div className="modal-card consensus-modal" role="dialog" aria-modal="true">
            <div className="modal-header"><div><span className="eyebrow">Category decision</span><h2>{activeCategory.title}</h2></div><button className="modal-close" onClick={() => setActiveCategoryId(null)} type="button">×</button></div>
            {activeProposal && <div className={`consensus-alert consensus-alert-${activeProposal.status}`}><strong>{activeProposal.is_eligible ? `Eligible · ${Number(activeProposal.range_min).toFixed(2)}–${Number(activeProposal.range_max).toFixed(2)}` : "Not eligible"}</strong><p>{activeProposal.advisory_note ?? "No Advisory Committee note."}</p><span>{statusLabel(activeProposal.status)}</span></div>}

            {(role === "advisory_member" || role === "owner") && (
              <form action={saveCategoryProposal.bind(null, applicationId, activeCategory.id)} className="form-stack">
                <label className="check-card"><input defaultChecked={activeProposal?.is_eligible ?? true} name="is_eligible" type="checkbox" /><span><strong>Eligible</strong><small>Include this category in scoring.</small></span></label>
                <div className="field"><label>Two-point range</label><select className="select" name="range_min" defaultValue={activeProposal?.range_min == null ? "" : String(activeProposal.range_min)}><option value="">Select range</option>{Array.from({ length: 29 }, (_, index) => 1 + index * 0.25).filter((value) => value <= 8).map((value) => <option key={value} value={value.toFixed(2)}>{value.toFixed(2)}–{(value + 2).toFixed(2)}</option>)}</select></div>
                <div className="field"><label>Advisory Committee note</label><textarea className="textarea" name="advisory_note" defaultValue={activeProposal?.advisory_note ?? ""} rows={4} /></div>
                {role === "owner" && <><label className="check-card compact-check-card"><input name="owner_override" type="checkbox" /><span><strong>Owner override</strong><small>Finalize without unanimous approval.</small></span></label><div className="field"><label>Override note</label><textarea className="textarea compact-textarea" name="owner_override_note" defaultValue={activeProposal?.owner_override_note ?? ""} /></div></>}
                <button className="button button-dark" onClick={() => window.setTimeout(() => setActiveCategoryId(null), 100)} type="submit">Save proposal and alert adjudicators</button>
              </form>
            )}

            {isScoringParticipant && activeProposal && (
              <form action={respondCategoryProposal.bind(null, applicationId, activeProposal.id)} className="form-stack consensus-response-form">
                <div className="consensus-response-status"><strong>Your response</strong><span>{ownApproval ? statusLabel(ownApproval.response) : "Pending"}</span></div>
                <div className="field"><label>Comment</label><textarea className="textarea compact-textarea" name="comment" defaultValue={ownApproval?.comment ?? ""} placeholder="Required when disputing." /></div>
                <div className="modal-actions"><button className="button button-danger" name="response" onClick={(event) => { if (!window.confirm("Dispute this eligibility/range proposal and alert the Advisory Committee?")) event.preventDefault(); }} type="submit" value="disputed">Dispute</button><button className="button button-dark" name="response" type="submit" value="approved">Approve eligibility and range</button></div>
              </form>
            )}
          </div>
        </div>
      )}

      {reviewOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReviewOpen(false); }}>
          <div className="modal-card" role="dialog" aria-modal="true">
            <div className="modal-header"><div><span className="eyebrow">Panel workflow</span><h2>Send adjudication to Owners</h2></div><button className="modal-close" onClick={() => setReviewOpen(false)} type="button">×</button></div>
            <div className="consensus-review-checklist"><p><strong>Category decisions:</strong> {unresolved === 0 ? "Complete" : `${unresolved} unresolved`}</p><p><strong>Current status:</strong> {statusLabel(review?.status ?? "draft")}</p></div>
            {role === "advisory_member" && <form action={submitPanelForOwnerReview.bind(null, applicationId)}><button className="button button-dark" disabled={unresolved > 0} type="submit">Send to Owners for review</button></form>}
            {role === "owner" && <form action={ownerUpdateAdjudicationReview.bind(null, applicationId)} className="form-stack"><div className="field"><label>Owner note</label><textarea className="textarea" name="owner_note" defaultValue={review?.owner_note ?? ""} rows={5} /></div><div className="modal-actions"><button className="button button-danger" name="status" type="submit" value="returned">Return to Advisory Committee</button><button className="button button-secondary" name="status" type="submit" value="owner_review">Mark under Owner review</button><button className="button button-dark" name="status" type="submit" value="released">Mark workflow complete</button></div></form>}
          </div>
        </div>
      )}
    </>
  );
}
