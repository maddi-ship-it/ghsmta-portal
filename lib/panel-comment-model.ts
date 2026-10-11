export const DEFAULT_PANEL_COMMENT_MODEL = "gpt-5-mini";

function isCodexModelAlias(model: string) {
  return /-(?:sol|terra|luna)$/i.test(model);
}

export function resolvePanelCommentModel(
  promptModel?: string | null,
  fallbackModel?: string | null,
) {
  const selectedModel = promptModel?.trim();
  const fallback = fallbackModel?.trim();

  if (selectedModel && !isCodexModelAlias(selectedModel)) {
    return selectedModel;
  }

  if (fallback && !isCodexModelAlias(fallback)) {
    return fallback;
  }

  return DEFAULT_PANEL_COMMENT_MODEL;
}
