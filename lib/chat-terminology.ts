export const SCHOOL_COMMUNITY_CHAT_LABEL = "School Community Chat";
export const GENERAL_ANNOUNCEMENTS_LABEL = "General Announcements";
export const ADJUDICATOR_CHANNELS_LABEL = "Adjudicator Channels";

export function chatChannelDisplayName(
  channelType: string,
  storedName: string,
) {
  if (channelType === "applicant_community") {
    return SCHOOL_COMMUNITY_CHAT_LABEL;
  }
  if (channelType === "general") {
    return GENERAL_ANNOUNCEMENTS_LABEL;
  }
  if (channelType === "direct_message") {
    return storedName || "Direct Chat";
  }
  if (channelType === "group_direct_message") {
    return storedName || "Group Chat";
  }
  return storedName;
}

export function chatChannelGroupLabel(
  channelType: string,
  storedLabel: string,
) {
  if (channelType === "general" || channelType === "networking") {
    return ADJUDICATOR_CHANNELS_LABEL;
  }
  if (channelType === "direct_message" || channelType === "group_direct_message") {
    return "Direct Messages";
  }
  return storedLabel;
}
