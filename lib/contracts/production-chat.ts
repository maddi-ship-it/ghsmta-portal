export function productionChatParticipantIds(
  ownerId: string,
  productionUserId: string,
) {
  return Array.from(new Set([ownerId, productionUserId]));
}

