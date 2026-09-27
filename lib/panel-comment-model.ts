export const DEFAULT_PANEL_COMMENT_MODEL = "gpt-6-sol";

export function resolvePanelCommentModel(
  promptModel?: string | null,
  fallbackModel?: string | null,
) {
  return (
    promptModel?.trim() ||
    fallbackModel?.trim() ||
    DEFAULT_PANEL_COMMENT_MODEL
  );
}
