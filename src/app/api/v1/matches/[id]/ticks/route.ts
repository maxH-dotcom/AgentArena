/**
 * GET /api/v1/matches/:id/ticks — full tick history for replay (anonymous).
 *
 * Returns every DuelTick of the match ordered by round/tick ascending:
 *   { matchId, seed, bestOf, status, ticks: [{ round, tick, actionA, actionB }] }
 *
 * seed + bestOf + the action sequence deterministically replays the whole
 * match through the pure engine (src/server/duel/engine.ts) — no state
 * snapshots are stored or needed. A match of bestOf N has at most
 * (N + 2) * DUEL_ROUND_TICKS rows, so everything is returned in one response.
 */

import { HttpError, jsonOk } from "~/server/api";
import { withPublicApi } from "~/server/api-public";
import { db } from "~/server/db";

export const GET = withPublicApi<{ id: string }>(async (_request, _actor, ctx) => {
  const { id } = await ctx.params;

  const match = await db.duelMatch.findUnique({
    where: { id },
    select: { id: true, seed: true, bestOf: true, status: true },
  });
  if (!match) {
    throw new HttpError(404, "MATCH_NOT_FOUND", "Match does not exist");
  }

  const ticks = await db.duelTick.findMany({
    where: { matchId: id },
    orderBy: [{ round: "asc" }, { tick: "asc" }],
    select: { round: true, tick: true, actionA: true, actionB: true },
  });

  return jsonOk({
    matchId: match.id,
    seed: match.seed,
    bestOf: match.bestOf,
    status: match.status,
    ticks,
  });
});
