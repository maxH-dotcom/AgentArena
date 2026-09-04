import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { DuelSpectator } from "~/components/duel/duel-spectator";
import type { DuelMatchStatus } from "~/lib/constants";
import { db } from "~/server/db";

export default async function MatchPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const match = await db.duelMatch.findUnique({ where: { id } });
  if (!match) notFound();

  const agents = await db.agent.findMany({
    where: { id: { in: [match.agentAId, match.agentBId] } },
    select: { id: true, name: true },
  });
  const nameOf = (agentId: string) =>
    agents.find((a) => a.id === agentId)?.name ?? agentId;

  return (
    <DuelSpectator
      matchId={match.id}
      seed={match.seed}
      bestOf={match.bestOf}
      initialStatus={match.status as DuelMatchStatus}
      agentA={{ id: match.agentAId, name: nameOf(match.agentAId) }}
      agentB={{ id: match.agentBId, name: nameOf(match.agentBId) }}
    />
  );
}
