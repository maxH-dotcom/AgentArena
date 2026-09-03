"use client";

import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Link, useRouter } from "~/i18n/navigation";
import {
  registerUser,
  type AuthErrorKey,
} from "~/server/auth/actions";

export function RegisterForm() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const router = useRouter();
  const [error, setError] = useState<AuthErrorKey | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") ?? "");
    const password = String(form.get("password") ?? "");
    const result = await registerUser({
      name,
      email: String(form.get("email") ?? ""),
      password,
    });
    if (!result.ok) {
      setPending(false);
      setError(result.error);
      return;
    }
    // Registration succeeded — sign in immediately.
    await signIn("credentials", { name, password, redirect: false });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="text-xs text-zinc-400">
            {t("name")}
          </label>
          <Input
            id="name"
            name="name"
            required
            autoComplete="username"
            placeholder={t("namePlaceholder")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-xs text-zinc-400">
            {t("email")}{" "}
            <span className="text-zinc-600">({tc("optional")})</span>
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder={t("emailPlaceholder")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-xs text-zinc-400">
            {t("password")}
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
        {error ? (
          <p className="text-xs text-red-400">{t(`errors.${error}`)}</p>
        ) : null}
        <Button type="submit" disabled={pending}>
          {t("register")}
        </Button>
      </form>

      <p className="text-center text-xs text-zinc-500">
        {t("haveAccount")}{" "}
        <Link href="/login" className="text-neon hover:underline">
          {t("signIn")}
        </Link>
      </p>
    </div>
  );
}
