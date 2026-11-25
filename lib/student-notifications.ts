import "server-only";

type TwilioResponse = { sid?: string; status?: string; code?: number; message?: string };

function twilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  const fromNumber = process.env.TWILIO_FROM_NUMBER?.trim();
  if (!accountSid || !authToken || (!messagingServiceSid && !fromNumber)) return null;
  return { accountSid, authToken, messagingServiceSid, fromNumber };
}

export async function sendStudentPortalSms(to: string, body: string) {
  const config = twilioConfig();
  if (!config) return { ok: false as const, detail: "Twilio is not configured." };
  const form = new URLSearchParams({ To: to, Body: body.slice(0, 1500) });
  if (config.messagingServiceSid) form.set("MessagingServiceSid", config.messagingServiceSid);
  else if (config.fromNumber) form.set("From", config.fromNumber);
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as TwilioResponse;
  if (!response.ok || !payload.sid) return { ok: false as const, detail: payload.message ?? `Twilio rejected the message${payload.code ? ` (${payload.code})` : ""}.` };
  return { ok: true as const, detail: payload.sid };
}
