"use client";

import { useLocale, useTranslations } from "next-intl";

import { usePathname, useRouter } from "~/i18n/navigation";
import { routing, type Locale } from "~/i18n/routing";

export function LanguageSwitcher() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  const next: Locale =
    routing.locales.find((l) => l !== locale) ?? routing.defaultLocale;

  return (
    <button
      type="button"
      onClick={() => router.replace(pathname, { locale: next })}
      className="rounded-lg border border-arena-border px-2.5 py-1 text-xs font-medium text-zinc-400 transition-colors hover:border-neon/60 hover:text-neon"
      aria-label="Switch language"
    >
      {t("switchLanguage")}
    </button>
  );
}
