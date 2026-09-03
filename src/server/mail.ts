import nodemailer, { type Transporter } from "nodemailer";

import { env } from "~/env";

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transporter;
}

/**
 * Send an email via SMTP. When SMTP is not configured, the message is logged to the
 * console instead (local dev fallback) and reported as sent.
 */
export async function sendMail(options: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const transport = getTransporter();
  if (!transport) {
    console.log(
      `[mail] SMTP not configured, skipping delivery.\n  to: ${options.to}\n  subject: ${options.subject}\n  text: ${options.text}`,
    );
    return;
  }
  await transport.sendMail({
    from: env.SMTP_FROM ?? "Agent Arena <no-reply@agentarena.local>",
    ...options,
  });
}
