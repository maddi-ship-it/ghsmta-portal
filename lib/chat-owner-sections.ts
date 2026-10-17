export const OWNER_CHAT_SECTIONS = [
  {
    value: "direct_messages",
    label: "Direct Messages",
    description: "Private conversations and working groups",
  },
  {
    value: "community",
    label: "Community",
    description: "Shared community initiatives",
  },
  {
    value: "adjudicator_channels",
    label: "Adjudicator Channels",
    description: "Adjudicator and event coordination",
  },
  {
    value: "advisory_committee",
    label: "Advisory Committee",
    description: "Committee planning and review",
  },
  {
    value: "portal_updates",
    label: "Portal Updates",
    description: "Owner-led portal communication",
  },
] as const;

export type OwnerChatSection = (typeof OWNER_CHAT_SECTIONS)[number]["value"];

export function isOwnerChatSection(value: string): value is OwnerChatSection {
  return OWNER_CHAT_SECTIONS.some((section) => section.value === value);
}
