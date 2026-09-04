import { getTranslations, setRequestLocale } from "next-intl/server";

import { ArenaList } from "~/components/arenas/arena-list";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { Link } from "~/i18n/navigation";
import { ARENA_STATUSES } from "~/lib/constants";
import { cn } from "~/lib/utils";
import { getActor } from "~/server/actor";
import { listArenas } from "~/server/services/arena";

const PAGE_SIZE = 12;

export default async function ArenasPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { status: rawStatus } = await searchParams;
  const status =
    rawStatus && (ARENA_STATUSES as readonly string[]).includes(rawStatus)
      ? rawStatus
      : undefined;

  const [t, actor, { items, nextCursor }] = await Promise.all([
    getTranslations("arenas"),
    getActor(),
    listArenas({ status, limit: PAGE_SIZE }),
  ]);

  const filters: { label: string; value?: string }[] = [
    { label: t("filterAll") },
    ...ARENA_STATUSES.map((s) => ({ label: t(`status.${s}`), value: s })),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-zinc-100">
            {t("listTitle")}
          </h1>
          <p className="mt-1 text-sm text-zinc-400">{t("listSubtitle")}</p>
        </div>
        {actor ? (
          <Link href="/arenas/new" className="ml-auto">
            <Button size="sm">{t("newArena")}</Button>
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((filter) => {
          const active = filter.value === status || (!filter.value && !status);
          return (
            <Link
              key={filter.label}
              href={
                filter.value
                  ? { pathname: "/arenas", query: { status: filter.value } }
                  : "/arenas"
              }
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                active
                  ? "border-neon/60 bg-neon/10 text-neon"
                  : "border-arena-border bg-arena-surface text-zinc-400 hover:border-zinc-600 hover:text-zinc-200",
              )}
            >
              {filter.label}
            </Link>
          );
        })}
      </div>

      {items.length === 0 ? (
        <EmptyState title={t("empty")} />
      ) : (
        <ArenaList
          key={status ?? "all"}
          initialItems={items}
          initialCursor={nextCursor}
          status={status ?? null}
        />
      )}
    </div>
  );
}
