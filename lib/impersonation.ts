import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export const IMPERSONATION_COOKIE_NAME = "ghsmta-owner-impersonation";
export const IMPERSONATION_MAX_AGE_SECONDS = 60 * 60;

export type ImpersonationCookiePayload = {
  auditId: string;
  ownerId: string;
  ownerEmail: string | null;
  ownerName: string | null;
  ownerAccessToken: string;
  ownerRefreshToken: string;
  targetId: string;
  targetEmail: string | null;
  targetName: string | null;
  startedAt: string;
  reason: string;
};

export type ImpersonationBannerState = Pick<
  ImpersonationCookiePayload,
  | "auditId"
  | "ownerId"
  | "ownerEmail"
  | "ownerName"
  | "targetId"
  | "targetEmail"
  | "targetName"
  | "startedAt"
  | "reason"
>;

function signingSecret() {
  const secret = process.env.IMPERSONATION_COOKIE_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error("Impersonation signing secret is not configured.");
  }
  return secret;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value: string) {
  return createHmac("sha256", signingSecret()).update(value).digest("base64url");
}

export function serializeImpersonationCookie(payload: ImpersonationCookiePayload) {
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export function readImpersonationCookieValue(
  value: string | undefined,
): ImpersonationCookiePayload | null {
  if (!value) return null;

  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encoded)) as ImpersonationCookiePayload;
    const startedAt = new Date(payload.startedAt).getTime();
    const expired =
      !Number.isFinite(startedAt) ||
      Date.now() - startedAt > IMPERSONATION_MAX_AGE_SECONDS * 1000;

    return expired ? null : payload;
  } catch {
    return null;
  }
}

export function bannerStateFromImpersonation(
  payload: ImpersonationCookiePayload | null,
): ImpersonationBannerState | null {
  if (!payload) return null;

  return {
    auditId: payload.auditId,
    ownerId: payload.ownerId,
    ownerEmail: payload.ownerEmail,
    ownerName: payload.ownerName,
    targetId: payload.targetId,
    targetEmail: payload.targetEmail,
    targetName: payload.targetName,
    startedAt: payload.startedAt,
    reason: payload.reason,
  };
}
