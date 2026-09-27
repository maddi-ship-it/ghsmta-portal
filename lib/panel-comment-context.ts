import {
  average,
  formatScore,
  formatScoreAverage,
} from "./adjudication";
import type {
  AdjudicationScore,
  AdjudicationScorecard,
  ProgramType,
  ScoringCriterion,
  ScoringRubric,
  ScoringScaleLevel,
} from "./types";

export const DEFAULT_PANEL_COMMENT_USER_TEMPLATE = `SCHOOL: {{school_name}}
PRODUCTION: {{production_title}}
ADJUDICATION CATEGORY: {{category_title}}
PROGRAM TRACK: {{program_track}}
SCORING MODE: {{scoring_mode}}
AVERAGE PANEL SCORE: {{average_panel_score}}

OFFICIAL SCORING GUIDE:
{{scoring_guide}}

CATEGORY CRITERIA:
{{criteria}}

RAW COMMENTS ORGANIZED BY CRITERION:
{{raw_comments}}`;

export function calculateLivePanelCategoryAverage(
  categoryId: string,
  criteria: ScoringCriterion[],
  scorecards: AdjudicationScorecard[],
  scores: AdjudicationScore[],
) {
  const criterionIds = new Set(
    criteria
      .filter((criterion) => criterion.category_id === categoryId)
      .map((criterion) => criterion.id),
  );
  const scorecardIds = new Set(scorecards.map((scorecard) => scorecard.id));

  return average(
    scores
      .filter(
        (score) =>
          scorecardIds.has(score.scorecard_id) &&
          criterionIds.has(score.criterion_id),
      )
      .map((score) => score.score),
  );
}

export function buildScoringGuideContext(
  rubric: Pick<ScoringRubric, "name" | "score_min" | "score_max">,
  levels: ScoringScaleLevel[],
) {
  const scale = [...levels]
    .sort((left, right) => right.score - left.score)
    .map(
      (level) =>
        `${formatScore(level.score)} — ${level.label}${
          level.description ? `: ${level.description}` : ""
        }`,
    );

  return [
    `Rubric: ${rubric.name}`,
    `Score range: ${formatScore(rubric.score_min)}–${formatScore(rubric.score_max)}`,
    ...scale,
  ].join("\n");
}

export function resolvePanelCommentScoringContext({
  selectedTrack,
  cycleProgramType,
  panelAverage,
}: {
  selectedTrack: string | null;
  cycleProgramType: ProgramType;
  panelAverage: number | null;
}) {
  const mentorshipOnly =
    cycleProgramType === "mentorship" ||
    selectedTrack?.toLowerCase().includes("mentor") === true;

  if (mentorshipOnly) {
    return {
      programTrack: selectedTrack || "Mentorship Track",
      scoringMode: "MENTORSHIP ONLY",
      averagePanelScore:
        "Not supplied because this application is mentorship only.",
    };
  }

  return {
    programTrack: selectedTrack || "Competition Track",
    scoringMode: "COMPETITIVELY SCORED",
    averagePanelScore:
      panelAverage == null
        ? "Not yet available. Use the raw evidence without score calibration."
        : formatScoreAverage(panelAverage),
  };
}
