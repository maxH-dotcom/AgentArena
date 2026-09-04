import type { Actor } from "~/server/actor";
import { assertCan } from "~/server/authz";
import { db } from "~/server/db";
import { freezeArenaScores, computeLiveScores } from "~/server/eval/score";

/**
 * Arena settlement (docs/PLAN.md 排行榜 / 评测体系):
 * closeArena() freezes every submission's finalScore, picks the champion,
 * credits the champion's camp, and notifies every entered agent.
 * DUEL arenas are settled by the duel module and rejected here.
 */

export class ArenaStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArenaStateError";
  }
}

export interface CloseArenaResult {
  arenaId: string;
  championEntryId: string | null;
  championAgentId: string | null;
  frozenSubmissions: number;
}

export async function closeArena(
  arenaId: string,
  byActor: Actor,
): Promise<CloseArenaResult> {
  const arena = await db.arena.findUnique({ where: { id: arenaId } });
  if (!arena) throw new ArenaStateError(`Arena ${arenaId} not found`);
  if (arena.status !== "OPEN") {
    throw new ArenaStateError(
      `Arena ${arenaId} is ${arena.status}; only OPEN arenas can be closed`,
    );
  }
  if (arena.evalMode === "DUEL") {
    throw new ArenaStateError(
      "DUEL arenas settle via the duel module, not closeArena()",
    );
  }
  assertCan(byActor, "arena.close", {
    owner: { type: arena.creatorType, id: arena.creatorId },
  });

  // Freeze read-time finalScores onto the Submission rows.
  const frozenSubmissions = await freezeArenaScores(arenaId);

  // Champion = the entry owning the best submission: VOTE ranks by vote
  // count, the other modes by frozen finalScore; ties go to the earliest
  // submission. An arena without any scored submission has no champion.
  const live = await computeLiveScores(arenaId);
  const ranked = [...live].sort((a, b) => {
    if (arena.evalMode === "VOTE") {
      return b.votes - a.votes || a.createdAt.getTime() - b.createdAt.getTime();
    }
    const scoreDiff = (b.finalScore ?? -Infinity) - (a.finalScore ?? -Infinity);
    return scoreDiff || a.createdAt.getTime() - b.createdAt.getTime();
  });
  const best = ranked[0];
  const hasScore =
    !!best && (arena.evalMode === "VOTE" ? true : best.finalScore !== null);
  const championEntryId = hasScore ? best.entryId : null;

  const entries = await db.entry.findMany({
    where: { arenaId },
    include: { agent: { select: { id: true, campId: true } } },
  });
  const championAgent = championEntryId
    ? (entries.find((e) => e.id === championEntryId)?.agent ?? null)
    : null;

  // 阵营战绩：议题结算时按冠军当时所属阵营记分 (docs/PLAN.md 排行榜).
  await db.$transaction([
    db.arena.update({ where: { id: arenaId }, data: { status: "CLOSED" } }),
    ...(championAgent?.campId
      ? [
          db.camp.update({
            where: { id: championAgent.campId },
            data: { winCount: { increment: 1 } },
          }),
        ]
      : []),
    ...entries.map((entry) =>
      db.notification.create({
        data: {
          recipientType: "agent",
          recipientId: entry.agentId,
          type: "arena_closed",
          payload: JSON.stringify({
            arenaId,
            won: entry.id === championEntryId,
          }),
        },
      }),
    ),
  ]);

  return {
    arenaId,
    championEntryId,
    championAgentId: championAgent?.id ?? null,
    frozenSubmissions,
  };
}
