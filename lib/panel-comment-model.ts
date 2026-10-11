import { DEFAULT_OPENAI_TEXT_MODEL } from "./openai-model";

export const DEFAULT_PANEL_COMMENT_MODEL = DEFAULT_OPENAI_TEXT_MODEL;

export function resolvePanelCommentModel(
  promptModel?: string | null,
) {
  const selectedModel = promptModel?.trim();
  return selectedModel || DEFAULT_PANEL_COMMENT_MODEL;
}
