import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";

import { ActorLink } from "~/components/community/actor-link";
import { EmptyState } from "~/components/ui/empty-state";
import { Link } from "~/i18n/navigation";
import { cn } from "~/lib/utils";
import {
  getLeaderboard,
  type ActorLeaderboardRow,
  type CampLeaderboardRow,
  type LeaderboardType,
} from "~/server/services/leaderboard";

const TYPES: LeaderboardType[] = ["camp", "user", "agent"];

function parseType(raw: string | undefined): LeaderboardType {
  return TYPES.includes(raw as LeaderboardType) ? (raw as LeaderboardType) : "camp";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "community" });
  return { title: t("leaderboards.title") };
}

export default async function LeaderboardsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { locale } = await params;
  const { type: rawType } = await searchParams;
  setRequestLocale(locale);
  const type = parseType(rawType);

  const t = await getTranslations("community");
  const rows = await getLeaderboard(type);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-black tracking-tight text-zinc-100">
          {t("leaderboards.title")}
        </h1>
        <p className="max-w-2xl text-sm text-zinc-400">{t("leaderboards.subtitle")}</p>
      </header>

      <div className="flex gap-1 rounded-lg border border-arena-border bg-arena-surface p-1">
        {TYPES.map((tab) => (
          <Link
            key={tab}
            href={`/leaderboards?type=${tab}`}
            className={cn(
              "flex-1 rounded-md px-4 py-2 text-center text-sm font-medium transition-colors",
              tab === type
                ? "bg-neon/15 text-neon"
                : "text-zinc-400 hover:bg-arena-raised hover:text-zinc-100",
            )}
          >
            {t(`leaderboards.tabs.${tab}`)}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState title={t("leaderboards.empty")} />
      ) : type === "camp" ? (
        <CampBoard rows={rows as CampLeaderboardRow[]} />
      ) : (
        <ActorBoard rows={rows as ActorLeaderboardRow[]} type={type} />
      )}
    </div>
  );
}

async function CampBoard({ rows }: { rows: CampLeaderboardRow[] }) {
  const t = await getTranslations("community");
  return (
    <div className="overflow-hidden rounded-xl border border-arena-border bg-arena-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-arena-border text-left text-xs text-zinc-500">
            <th className="px-5 py-3 font-medium">{t("leaderboards.rank")}</th>
            <th className="px-5 py-3 font-medium">{t("leaderboards.tabs.camp")}</th>
            <th className="px-5 py-3 text-right font-medium">{t("leaderboards.wins")}</th>
            <th className="px-5 py-3 text-right font-medium">{t("leaderboards.members")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-arena-border">
          {rows.map((row) => (
            <tr key={row.camp.id} className="transition-colors hover:bg-arena-raised/40">
              <td className="px-5 py-3">
                <RankBadge rank={row.rank} />
              </td>
              <td className="px-5 py-3">
                <Link
                  href={`/camps/${row.camp.id}`}
                  className="inline-flex items-center gap-2 font-semibold text-zinc-100 transition-colors hover:text-neon"
                >
                  <span
                    aria-hidden
                    className="inline-block h-3 w-3 rounded-sm"
                    style={{ backgroundColor: row.camp.color }}
                  />
                  {row.camp.name}
                </Link>
                {row.camp.slogan ? (
                  <p className="mt-0.5 text-xs italic text-zinc-500">{row.camp.slogan}</p>
                ) : null}
              </td>
              <td className="px-5 py-3 text-right font-bold text-volt">{row.wins}</td>
              <td className="px-5 py-3 text-right text-zinc-300">{row.camp.memberCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function ActorBoard({
  rows,
  type,
}: {
  rows: ActorLeaderboardRow[];
  type: "user" | "agent";
}) {
  const t = await getTranslations("community");
  return (
    <div className="overflow-hidden rounded-xl border border-arena-border bg-arena-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-arena-border text-left text-xs text-zinc-500">
            <th className="px-5 py-3 font-medium">{t("leaderboards.rank")}</th>
            <th className="px-5 py-3 font-medium">{t(`leaderboards.tabs.${type}`)}</th>
            <th className="px-5 py-3 text-right font-medium">{t("leaderboards.wins")}</th>
            <th className="px-5 py-3 text-right font-medium">{t("leaderboards.avgScore")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-arena-border">
          {rows.map((row) => (
            <tr key={row.actor.id} className="transition-colors hover:bg-arena-raised/40">
              <td className="px-5 py-3">
                <RankBadge rank={row.rank} />
              </td>
              <td className="px-5 py-3">
                <ActorLink
                  actor={row.actor}
                  size={24}
                  showTypeBadge
                  typeBadgeLabel={t("common.agentBadge")}
                />
                {type === "user" && row.agentIds?.length ? (
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {t("leaderboards.viaAgents", { count: row.agentIds.length })}
                  </p>
                ) : null}
              </td>
              <td className="px-5 py-3 text-right font-bold text-volt">{row.wins}</td>
              <td className="px-5 py-3 text-right text-zinc-300">
                {row.avgFinalScore === null ? "—" : row.avgFinalScore.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-xs font-black",
        rank === 1 && "bg-volt/15 text-volt",
        rank === 2 && "bg-neon/15 text-neon",
        rank === 3 && "bg-flare/15 text-flare",
        rank > 3 && "bg-arena-raised text-zinc-400",
      )}
    >
      {rank}
    </span>
  );
}
