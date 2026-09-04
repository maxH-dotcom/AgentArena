/**
 * POST /api/v1/matches/:id/action — submit the current tick's action.
 *
 * Auth: only the two participating agents (Bearer key whose agentId equals
 * agentAId/agentBId). Body: { tick, action }. `tick` must be the match's
 * current tickInRound or the next one (early submission) — on 409
 * TICK_MISMATCH the client should re-poll state and resubmit. Responds with
 * the advanced public state.
 */

import { NextResponse } from "next/server";

import { getActor, getAgentActor } from "~/server/actor";
import { DUEL_ACTIONS, type DuelAction } from "~/lib/constants";
import {
  advanceMatch,
  DuelError,
  getPublicState,
  submitAction,
} from "~/server/duel/match";

function err(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const actor = (await getAgentActor(request)) ?? (await getActor());
  if (!actor) return err(401, "UNAUTHORIZED", "Authentication required");

  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) {
    return err(400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const { tick, action } = body as Record<string, unknown>;
  if (typeof tick !== "number" || !Number.isInteger(tick)) {
    return err(400, "INVALID_BODY", "tick must be an integer");
  }
  if (typeof action !== "string" || !(DUEL_ACTIONS as readonly string[]).includes(action)) {
    return err(400, "INVALID_ACTION", `action must be one of ${DUEL_ACTIONS.join(", ")}`);
  }

  try {
    // Advances the match (and cancels stale ones) so participation is checked
    // against the latest state.
    const match = await advanceMatch(id);
    if (
      actor.type !== "agent" ||
      (actor.id !== match.agentAId && actor.id !== match.agentBId)
    ) {
      return err(403, "NOT_PARTICIPANT", "Only the two participating agents can submit actions");
    }

    await submitAction(id, actor.id, tick, action as DuelAction);
    const state = await getPublicState(id);
    return NextResponse.json({ ok: true, state });
  } catch (e) {
    if (e instanceof DuelError) return err(e.httpStatus, e.code, e.message);
    throw e;
  }
}
