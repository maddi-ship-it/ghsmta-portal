export const DEFAULT_OPENAI_TEXT_MODEL = "gpt-6-astra";
export const PLAYBILL_SONG_LIST_MODEL = "gpt-6-luna";

export const OPENAI_REASONING_EFFORT = {
  adjudicationSort: "low",
  handwriting: "medium",
  panelComment: "high",
  playbillSongList: "low",
  phonetic: "low",
} as const;
