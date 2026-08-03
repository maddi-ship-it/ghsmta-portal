export const INVOICE_SCHOOL_CHAT_CHANNEL_TYPE = "school_dm" as const;

export function isInvoiceSchoolChatChannel(channelType: string) {
  return channelType === INVOICE_SCHOOL_CHAT_CHANNEL_TYPE;
}
