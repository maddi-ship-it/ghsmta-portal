import nodemailer from "nodemailer";

type SendSmtpEmailInput = {
  to: string[];
  subject: string;
  html: string;
  text?: string;
};

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export function smtpIsConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASSWORD &&
      process.env.SMTP_FROM_EMAIL,
  );
}

export async function sendSmtpEmail({
  to,
  subject,
  html,
  text,
}: SendSmtpEmailInput) {
  if (to.length === 0) {
    return { ok: false as const, detail: "No recipients." };
  }

  if (!smtpIsConfigured()) {
    return { ok: false as const, detail: "SMTP is not configured." };
  }

  const port = Number(requiredEnv("SMTP_PORT"));
  const secure = (process.env.SMTP_SECURE ?? String(port === 465)) === "true";

  const transporter = nodemailer.createTransport({
    host: requiredEnv("SMTP_HOST"),
    port,
    secure,
    auth: {
      user: requiredEnv("SMTP_USER"),
      pass: requiredEnv("SMTP_PASSWORD"),
    },
  });

  try {
    const info = await transporter.sendMail({
      from: {
        name: process.env.SMTP_FROM_NAME?.trim() || "GHSMTA Portal",
        address: requiredEnv("SMTP_FROM_EMAIL"),
      },
      replyTo: process.env.SMTP_REPLY_TO?.trim() || undefined,
      to,
      subject,
      html,
      text,
    });

    return { ok: true as const, detail: info.messageId };
  } catch (error) {
    return {
      ok: false as const,
      detail: error instanceof Error ? error.message : "SMTP send failed.",
    };
  }
}
