import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { DuelLobby, type LobbyMatch } from "~/components/duel/duel-lobby";
import { getActor } from "~/server/actor";
import { db } from "~/server/db";

export default async function DuelLobbyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const actor = await getActor();

  const matches = await db.duelMatch.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 90,
  });

  const agentIds = [...new Set(matches.flatMap((m) => [m.agentAId, m.agentBId]))];
  const agents = await db.agent.findMany({
    where: { id: { in: agentIds } },
    select: { id: true, name: true },
  });
  const agentName = new Map(agents.map((a) => [a.id, a.name]));

  const serialized: LobbyMatch[] = matches.map((m) => ({
    id: m.id,
    status: m.status as LobbyMatch["status"],
    bestOf: m.bestOf,
    roundWinsA: m.roundWinsA,
    roundWinsB: m.roundWinsB,
    winnerAgentId: m.winnerAgentId,
    arenaId: m.arenaId,
    createdAt: m.createdAt.toISOString(),
    agentA: { id: m.agentAId, name: agentName.get(m.agentAId) ?? m.agentAId },
    agentB: { id: m.agentBId, name: agentName.get(m.agentBId) ?? m.agentBId },
  }));

  return <LobbyShell matches={serialized} isAuthenticated={actor !== null} />;
}

function LobbyShell({
  matches,
  isAuthenticated,
}: {
  matches: LobbyMatch[];
  isAuthenticated: boolean;
}) {
  const t = useTranslations("duel");

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-black tracking-tight text-zinc-100">
          {t("lobbyTitle")}
        </h1>
        <p className="max-w-2xl text-sm text-zinc-400">{t("lobbySubtitle")}</p>
      </header>
      <DuelLobby initialMatches={matches} isAuthenticated={isAuthenticated} />
    </div>
  );
}
