"use server";

import { randomInt } from "node:crypto";

import { hash } from "bcryptjs";
import { z } from "zod";

import { sha256 } from "~/server/agent-keys";
import { db } from "~/server/db";
import { sendMail } from "~/server/mail";

/**
 * Auth server actions: registration + password reset.
 * Return values carry stable error keys; UI maps them to translated messages.
 */
export type AuthActionResult =
  | { ok: true }
  | { ok: false; error: AuthErrorKey };

export type AuthErrorKey =
  | "invalidInput"
  | "nameTaken"
  | "emailTaken"
  | "emailRequired"
  | "codeInvalid"
  | "serverError";

const nameSchema = z
  .string()
  .trim()
  .min(2)
  .max(24)
  .regex(/^[\w\u4e00-\u9fa5-]+$/);

const registerSchema = z.object({
  name: nameSchema,
  email: z.union([z.literal(""), z.string().trim().email().max(120)]),
  password: z.string().min(8).max(72),
});

const requestResetSchema = z.object({
  email: z.string().trim().email().max(120),
});

const resetSchema = z.object({
  email: z.string().trim().email().max(120),
  code: z.string().trim().regex(/^\d{6}$/),
  password: z.string().min(8).max(72),
});

const RESET_CODE_TTL_MS = 10 * 60 * 1000;

export async function registerUser(input: {
  name: string;
  email: string;
  password: string;
}): Promise<AuthActionResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const { name, password } = parsed.data;
  const email = parsed.data.email === "" ? null : parsed.data.email;

  try {
    const nameClash = await db.user.findFirst({
      where: { name, deletedAt: null },
      select: { id: true },
    });
    if (nameClash) return { ok: false, error: "nameTaken" };

    if (email) {
      const emailClash = await db.user.findFirst({
        where: { email, deletedAt: null },
        select: { id: true },
      });
      if (emailClash) return { ok: false, error: "emailTaken" };
    }

    await db.user.create({
      data: { name, email, passwordHash: await hash(password, 10) },
    });
    return { ok: true };
  } catch (e) {
    console.error("registerUser failed", e);
    return { ok: false, error: "serverError" };
  }
}

/**
 * Request a 6-digit password reset code for the account bound to `email`.
 * Always reports success for existing-looking input to avoid leaking which
 * emails are registered.
 */
export async function requestPasswordReset(input: {
  email: string;
}): Promise<AuthActionResult> {
  const parsed = requestResetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  try {
    const user = await db.user.findFirst({
      where: { email: parsed.data.email, deletedAt: null },
    });
    if (!user) return { ok: true };

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    await db.passwordResetCode.create({
      data: {
        userId: user.id,
        codeHash: sha256(code),
        expiresAt: new Date(Date.now() + RESET_CODE_TTL_MS),
      },
    });
    await sendMail({
      to: user.email!,
      subject: "Agent Arena — password reset code",
      text: `Your password reset code is ${code}. It expires in 10 minutes.`,
    });
    return { ok: true };
  } catch (e) {
    console.error("requestPasswordReset failed", e);
    return { ok: false, error: "serverError" };
  }
}

export async function resetPassword(input: {
  email: string;
  code: string;
  password: string;
}): Promise<AuthActionResult> {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const { email, code, password } = parsed.data;

  try {
    const user = await db.user.findFirst({
      where: { email, deletedAt: null },
    });
    if (!user) return { ok: false, error: "codeInvalid" };

    const record = await db.passwordResetCode.findFirst({
      where: {
        userId: user.id,
        codeHash: sha256(code),
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!record) return { ok: false, error: "codeInvalid" };

    await db.$transaction([
      db.passwordResetCode.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      db.user.update({
        where: { id: user.id },
        data: { passwordHash: await hash(password, 10) },
      }),
    ]);
    return { ok: true };
  } catch (e) {
    console.error("resetPassword failed", e);
    return { ok: false, error: "serverError" };
  }
}
