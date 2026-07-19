"use client";

import { useMemo, useState } from "react";

import { ownerUpdateAdjudicationReview, saveAllCategoryProposals, submitPanelForOwnerReview } from "@/app/portal/adjudication/[id]/workflow-actions";
import { ScheduleSubmitButton } from "@/components/schedule-submit-button";
import type { AppRole, ScoringCategory } from "@/lib/types";

type Proposal = { id: string; application_id: string; category_id: string; proposed_by: string; is_eligible: boolean; range_min: number | null; range_max: number | null; status: string; advisory_note: string | null; owner_override_note: string | null };
type Review = { status: string; owner_note: string | null } | null;
function statusLabel(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
const rangeOptions = Array.from({ length: 29 }, (_, index) => 1 + index * 0.25).filter((value) => value <= 8);

export function AdjudicationConsensusBar({ applicationId, role, categories, proposals, review }: { applicationId: string; role: AppRole; currentUserId: string; categories: ScoringCategory[]; proposals: Proposal[]; approvals: unknown[]; review: Review }) {
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const proposalByCategory = useMemo(() => new Map(proposals.map((proposal) => [proposal.category_id, proposal])), [proposals]);
  const unresolved = categories.filter((category) => { const proposal = proposalByCategory.get(category.id); return !proposal || !["approved", "overridden"].includes(proposal.status); }).length;
  const disputed = proposals.filter((proposal) => proposal.status === "disputed").length;
  const canSetDecisions = role === "advisory_member" || role === "owner";

  return (
    <>
      <div className="adjudication-consensus-bar consolidated-consensus-bar">
        <div className="consensus-summary"><strong>Eligibility &amp; two-point ranges</strong><span className={unresolved ? "badge badge-warning" : "badge badge-complete"}>{unresolved ? `${unresolved} unresolved` : "All approved"}</span>{disputed > 0 && <span className="badge badge-warning">{disputed} disputed</span>}{review && <span className="badge">{statusLabel(review.status)}</span>}</div>
        <div className="consensus-main-actions">{canSetDecisions && <button className="button button-secondary button-compact" onClick={() => setMatrixOpen(true)} type="button">Review all categories</button>}{canSetDecisions && <button className="button button-dark button-compact" onClick={() => setReviewOpen(true)} type="button">Panel review</button>}</div>
      </div>

      {matrixOpen && canSetDecisions && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMatrixOpen(false); }}>
          <div className="modal-card consensus-matrix-modal" role="dialog" aria-modal="true">
            <form action={saveAllCategoryProposals.bind(null, applicationId)}>
              <div className="modal-header sticky-modal-header"><div><p className="eyebrow">Advisory Committee review</p><h2>Eligibility &amp; two-point ranges</h2><p>Set every category, then save all decisions together.</p></div><div className="modal-header-actions"><ScheduleSubmitButton className="button button-gold" pendingLabel="Saving all decisions…">Save all category decisions</ScheduleSubmitButton><button className="modal-close" onClick={() => setMatrixOpen(false)} type="button">×</button></div></div>
              <div className="consensus-matrix-table-wrap"><table className="data-table consensus-matrix-table"><thead><tr><th>Category</th><th>Eligible</th><th>Two-point range</th><th>Status</th><th>Advisory note</th>{role === "owner" && <th>Owner override</th>}</tr></thead><tbody>{categories.map((category) => { const proposal = proposalByCategory.get(category.id); return <tr className={proposal?.status === "disputed" ? "consensus-row-disputed" : ""} key={category.id}><td><input type="hidden" name="category_id" value={category.id} /><strong>{category.title}</strong><small>{category.description}</small></td><td><label className="switch-control"><input defaultChecked={proposal?.is_eligible ?? true} name={`eligible_${category.id}`} type="checkbox" /><span>Eligible</span></label></td><td><select className="select" defaultValue={proposal?.range_min == null ? "" : String(proposal.range_min)} name={`range_${category.id}`}><option value="">No range</option>{rangeOptions.map((value) => <option key={value} value={value.toFixed(2)}>{value.toFixed(2)}–{(value + 2).toFixed(2)}</option>)}</select></td><td><span className={`badge ${proposal?.status === "approved" || proposal?.status === "overridden" ? "badge-complete" : "badge-warning"}`}>{proposal ? statusLabel(proposal.status) : "Not proposed"}</span></td><td><textarea className="textarea compact-textarea" defaultValue={proposal?.advisory_note ?? ""} name={`note_${category.id}`} placeholder="Context for adjudicators" /></td>{role === "owner" && <td><label className="inline-check"><input name={`override_${category.id}`} type="checkbox" defaultChecked={proposal?.status === "overridden"} /> Override</label><input className="input input-compact" defaultValue={proposal?.owner_override_note ?? ""} name={`override_note_${category.id}`} placeholder="Required override note" /></td>}</tr>; })}</tbody></table></div>
              <div className="sticky-modal-footer"><button className="button button-secondary" type="button" onClick={() => setMatrixOpen(false)}>Cancel</button><ScheduleSubmitButton className="button button-gold" pendingLabel="Saving all decisions…">Save all category decisions</ScheduleSubmitButton></div>
            </form>
          </div>
        </div>
      )}

      {reviewOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReviewOpen(false); }}><div className="modal-card" role="dialog" aria-modal="true"><div className="modal-header"><div><p className="eyebrow">Panel workflow</p><h2>Send adjudication to Owners</h2></div><button className="modal-close" onClick={() => setReviewOpen(false)} type="button">×</button></div><div className="consensus-review-checklist"><p><strong>Category decisions:</strong> {unresolved === 0 ? "Complete" : `${unresolved} unresolved`}</p><p><strong>Current status:</strong> {statusLabel(review?.status ?? "draft")}</p></div>{role === "advisory_member" && <form action={submitPanelForOwnerReview.bind(null, applicationId)}><button className="button button-dark" disabled={unresolved > 0} type="submit">Send to Owners for review</button></form>}{role === "owner" && <form action={ownerUpdateAdjudicationReview.bind(null, applicationId)} className="form-stack"><div className="field"><label>Owner note</label><textarea className="textarea" defaultValue={review?.owner_note ?? ""} name="owner_note" rows={5} /></div><div className="modal-actions"><button className="button button-danger" name="status" type="submit" value="returned">Return to Advisory Committee</button><button className="button button-secondary" name="status" type="submit" value="owner_review">Mark under Owner review</button><button className="button button-dark" name="status" type="submit" value="released">Mark workflow complete</button></div></form>}</div></div>
      )}
    </>
  );
}
