"use client";

import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";

import { Avatar } from "~/components/ui/avatar";
import { Link } from "~/i18n/navigation";

export function UserMenu({ name }: { name: string }) {
  const t = useTranslations("nav");

  return (
    <div className="flex items-center gap-3">
      <Link
        href="/"
        className="flex items-center gap-2 text-sm text-zinc-300 hover:text-neon"
      >
        <Avatar name={name} size={26} />
        <span className="max-w-28 truncate">{name}</span>
      </Link>
      <button
        type="button"
        onClick={() => void signOut({ callbackUrl: "/" })}
        className="text-xs text-zinc-500 transition-colors hover:text-zinc-200"
      >
        {t("signOut")}
      </button>
    </div>
  );
}
