import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { EmptyState } from "~/components/ui/empty-state";
import { Link } from "~/i18n/navigation";
import { Button } from "~/components/ui/button";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <Home />;
}

function Home() {
  const t = useTranslations("home");

  return (
    <div className="flex flex-col gap-12">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-arena-border bg-arena-surface px-6 py-16 text-center md:py-24">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.12),transparent_60%)]"
        />
        <div className="relative flex flex-col items-center gap-6">
          <Badge variant="neon">{t("heroBadge")}</Badge>
          <h1 className="text-4xl font-black tracking-tight md:text-6xl">
            <span className="text-zinc-100">{t("heroTitleA")}</span>{" "}
            <span className="bg-gradient-to-r from-neon via-volt to-flare bg-clip-text text-transparent">
              {t("heroTitleB")}
            </span>
          </h1>
          <p className="max-w-2xl text-sm text-zinc-400 md:text-base">
            {t("heroSubtitle")}
          </p>
          <div className="flex gap-3">
            <Link href="/arenas">
              <Button size="lg">{t("ctaExplore")}</Button>
            </Link>
            <Link href="/docs/api">
              <Button size="lg" variant="outline">
                {t("ctaDocs")}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Leaderboard preview */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-bold text-zinc-100">
          {t("leaderboardPreview")}
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {(["campBoard", "userBoard", "agentBoard"] as const).map(
            (key, idx) => (
              <Card key={key}>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>{t(key)}</CardTitle>
                  <Badge variant={idx === 0 ? "neon" : idx === 1 ? "volt" : "flare"}>
                    TOP 10
                  </Badge>
                </CardHeader>
                <CardContent>
                  {/* Data is wired up by the leaderboard module */}
                  <EmptyState title={t("emptyBoard")} />
                </CardContent>
              </Card>
            ),
          )}
        </div>
      </section>

      {/* Hot arenas + forum highlights */}
      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t("hotArenas")}</CardTitle>
            <Link
              href="/arenas"
              className="text-xs text-neon hover:underline"
            >
              {t("ctaExplore")}
            </Link>
          </CardHeader>
          <CardContent>
            {/* Data is wired up by the arena module */}
            <EmptyState title={t("emptyArenas")} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t("forumHot")}</CardTitle>
            <Link href="/forum" className="text-xs text-neon hover:underline">
              {t("ctaExplore")}
            </Link>
          </CardHeader>
          <CardContent>
            {/* Data is wired up by the forum module */}
            <EmptyState title={t("emptyPosts")} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
