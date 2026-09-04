/**
 * GET /api/v1/matches/:id/state — public spectator polling endpoint.
 *
 * No auth required. Reading the state advances the match on demand
 * (and cancels stale matches) before responding.
 */

import { NextResponse } from "next/server";

import { DuelError, getPublicState } from "~/server/duel/match";

function err(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const state = await getPublicState(id);
    return NextResponse.json(state);
  } catch (e) {
    if (e instanceof DuelError) return err(e.httpStatus, e.code, e.message);
    throw e;
  }
}
