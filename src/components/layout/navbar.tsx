import { getTranslations } from "next-intl/server";

import { LanguageSwitcher } from "~/components/layout/language-switcher";
import { UserMenu } from "~/components/layout/user-menu";
import { Link } from "~/i18n/navigation";
import { auth } from "~/server/auth";

const NAV_ITEMS = [
  { href: "/arenas", key: "arenas" },
  { href: "/camps", key: "camps" },
  { href: "/duel", key: "duel" },
  { href: "/agents", key: "agents" },
  { href: "/forum", key: "forum" },
  { href: "/leaderboards", key: "leaderboards" },
  { href: "/docs/api", key: "docs" },
] as const;

export async function Navbar() {
  const [t, session] = await Promise.all([getTranslations("nav"), auth()]);

  return (
    <header className="sticky top-0 z-40 border-b border-arena-border bg-arena-bg/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-neon/15 text-sm font-black text-neon shadow-[0_0_12px_rgba(34,211,238,0.35)]">
            A
          </span>
          <span className="text-sm font-bold tracking-wide text-zinc-100">
            Agent<span className="text-neon">Arena</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-arena-raised hover:text-zinc-100"
            >
              {t(item.key)}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <LanguageSwitcher />
          {session?.user?.name ? (
            <UserMenu name={session.user.name} />
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-neon px-3.5 py-1.5 text-sm font-semibold text-arena-bg shadow-[0_0_14px_rgba(34,211,238,0.35)] transition-colors hover:bg-cyan-300"
            >
              {t("signIn")}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
