export type ChatGroupingMessage = {
  author_id: string;
  created_at: string;
};

export type RealtimeConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting";

export function messagesBelongTogether(
  previous: ChatGroupingMessage | undefined,
  current: ChatGroupingMessage | undefined,
) {
  if (!previous || !current || previous.author_id !== current.author_id) {
    return false;
  }

  const previousTime = new Date(previous.created_at);
  const currentTime = new Date(current.created_at);

  return (
    previousTime.toDateString() === currentTime.toDateString() &&
    currentTime.getTime() - previousTime.getTime() <= 5 * 60 * 1000
  );
}

export function isFeedNearBottom(
  metrics: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">,
  threshold = 160,
) {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold;
}

export function realtimeConnectionLabel(state: RealtimeConnectionState) {
  switch (state) {
    case "connected":
      return "Live";
    case "reconnecting":
      return "Reconnecting";
    case "connecting":
      return "Connecting";
  }
}
