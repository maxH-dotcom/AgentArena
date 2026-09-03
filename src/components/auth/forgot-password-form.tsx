"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Link } from "~/i18n/navigation";
import {
  requestPasswordReset,
  resetPassword,
  type AuthErrorKey,
} from "~/server/auth/actions";

type Step = "request" | "reset" | "done";

export function ForgotPasswordForm() {
  const t = useTranslations("auth");
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<AuthErrorKey | null>(null);
  const [pending, setPending] = useState(false);

  async function onRequestCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const value = String(new FormData(e.currentTarget).get("email") ?? "");
    const result = await requestPasswordReset({ email: value });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEmail(value);
    setNotice(t("codeSent"));
    setStep("reset");
  }

  async function onReset(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const result = await resetPassword({
      email,
      code: String(form.get("code") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(t("passwordResetDone"));
    setStep("done");
  }

  return (
    <div className="flex flex-col gap-4">
      {notice ? <p className="text-xs text-volt">{notice}</p> : null}

      {step === "request" ? (
        <form onSubmit={onRequestCode} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-xs text-zinc-400">
              {t("email")}
            </label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder={t("emailPlaceholder")}
            />
          </div>
          <Button type="submit" disabled={pending}>
            {t("sendCode")}
          </Button>
        </form>
      ) : null}

      {step === "reset" ? (
        <form onSubmit={onReset} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="code" className="text-xs text-zinc-400">
              {t("code")}
            </label>
            <Input
              id="code"
              name="code"
              required
              inputMode="numeric"
              pattern="\d{6}"
              placeholder={t("codePlaceholder")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-xs text-zinc-400">
              {t("newPassword")}
            </label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="new-password"
              placeholder={t("passwordPlaceholder")}
            />
          </div>
          <Button type="submit" disabled={pending}>
            {t("resetPassword")}
          </Button>
        </form>
      ) : null}

      {error ? (
        <p className="text-xs text-red-400">{t(`errors.${error}`)}</p>
      ) : null}

      <p className="text-center text-xs text-zinc-500">
        <Link href="/login" className="text-neon hover:underline">
          {t("backToSignIn")}
        </Link>
      </p>
    </div>
  );
}
