export const APPLY_ADJUDICATION_BRAIN_DUMP_EVENT =
  "ghsmta:apply-adjudication-brain-dump";

export type AdjudicationBrainDumpAssignment = {
  criterionId: string;
  text: string;
};

export type ApplyAdjudicationBrainDumpDetail = {
  assignments: AdjudicationBrainDumpAssignment[];
};
