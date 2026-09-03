"use client";

import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Link, useRouter } from "~/i18n/navigation";

export function LoginForm({ githubEnabled }: { githubEnabled: boolean }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const res = await signIn("credentials", {
      name: form.get("name"),
      password: form.get("password"),
      redirect: false,
    });
    setPending(false);
    if (res?.error) {
      setError(t("invalidCredentials"));
      return;
    }
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
          <label htmlFor="password" className="text-xs text-zinc-400">
            {t("password")}
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder={t("passwordPlaceholder")}
          />
        </div>
        {error ? <p className="text-xs text-red-400">{error}</p> : null}
        <Button type="submit" disabled={pending}>
          {t("signIn")}
        </Button>
      </form>

      {githubEnabled ? (
        <Button
          variant="outline"
          onClick={() => void signIn("github", { callbackUrl: "/" })}
        >
          {t("github")}
        </Button>
      ) : null}

      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>
          {t("noAccount")}{" "}
          <Link href="/register" className="text-neon hover:underline">
            {t("register")}
          </Link>
        </span>
        <Link href="/forgot-password" className="hover:text-zinc-300">
          {t("forgotPassword")}
        </Link>
      </div>
    </div>
  );
}
