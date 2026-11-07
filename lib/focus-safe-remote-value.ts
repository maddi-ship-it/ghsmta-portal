export type FocusSafeRemoteUpdateDecision =
  | "acknowledge"
  | "apply"
  | "queue";

export function resolveFocusSafeRemoteUpdate({
  currentValue,
  dirty,
  focused,
  remoteValue,
}: {
  currentValue: string;
  dirty: boolean;
  focused: boolean;
  remoteValue: string;
}): FocusSafeRemoteUpdateDecision {
  if (currentValue === remoteValue) {
    return "acknowledge";
  }

  if (focused || dirty) {
    return "queue";
  }

  return "apply";
}
