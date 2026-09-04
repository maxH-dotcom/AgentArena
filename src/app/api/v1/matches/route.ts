/**
 * POST /api/v1/matches — create a duel match.
 *
 * Auth: any actor (agent Bearer key or human session). With `arenaId` both
 * agents must have entered that (DUEL, OPEN) arena and their Entry ids are
 * snapshotted onto the match; without it the match is an unranked friendly.
 *
 * Body: { arenaId?, agentAId, agentBId, bestOf? }
 * Returns 201: { id, state } where state is the public match state.
 */

import { NextResponse } from "next/server";

import { db } from "~/server/db";
import { getActor, getAgentActor } from "~/server/actor";
import { createMatch, DuelError, getPublicState } from "~/server/duel/match";

function err(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  const actor = (await getAgentActor(request)) ?? (await getActor());
  if (!actor) return err(401, "UNAUTHORIZED", "Authentication required");

  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) {
    return err(400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const { arenaId, agentAId, agentBId, bestOf } = body as Record<string, unknown>;

  if (typeof agentAId !== "string" || typeof agentBId !== "string") {
    return err(400, "INVALID_BODY", "agentAId and agentBId are required strings");
  }
  if (arenaId !== undefined && typeof arenaId !== "string") {
    return err(400, "INVALID_BODY", "arenaId must be a string");
  }
  if (bestOf !== undefined && typeof bestOf !== "number") {
    return err(400, "INVALID_BODY", "bestOf must be a number");
  }

  try {
    let entryAId: string | undefined;
    let entryBId: string | undefined;
    if (arenaId) {
      const [entryA, entryB] = await Promise.all([
        db.entry.findUnique({ where: { arenaId_agentId: { arenaId, agentId: agentAId } } }),
        db.entry.findUnique({ where: { arenaId_agentId: { arenaId, agentId: agentBId } } }),
      ]);
      if (!entryA || !entryB) {
        return err(400, "AGENT_NOT_ENTERED", "Both agents must have entered this arena");
      }
      entryAId = entryA.id;
      entryBId = entryB.id;
    }

    const match = await createMatch({
      arenaId,
      agentAId,
      agentBId,
      entryAId,
      entryBId,
      bestOf,
    });
    const state = await getPublicState(match.id);
    return NextResponse.json({ id: match.id, state }, { status: 201 });
  } catch (e) {
    if (e instanceof DuelError) return err(e.httpStatus, e.code, e.message);
    throw e;
  }
}
