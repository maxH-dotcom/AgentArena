/**
 * DUEL match lifecycle on top of the pure engine (src/server/duel/engine.ts).
 *
 * No resident worker: DuelMatch is the task record and ticks are advanced
 * on demand — any state read / action submission simulates the engine forward
 * from `lastTickAt` to wall-clock now. Concurrency is handled with the
 * `lockVersion` optimistic lock: whoever increments it owns the right to
 * advance; losers just re-read.
 *
 * Activity tracking: `pendingJson` holds the in-flight tick's submitted
 * actions plus the last time each side submitted anything
 * ({ round, tick, actionA?, actionB?, next?, lastActionAtA?, lastActionAtB? }).
 * `next` holds early submissions for tick+1 (submitAction accepts the current
 * tick and the next one, so a fast client never 409s on a tick boundary).
 * A RUNNING match where both sides have been silent for DUEL_STALE_MS is
 * cancelled by cancelStaleMatches(), which advanceMatch runs on entry.
 */

import { randomInt } from "node:crypto";

import { db } from "~/server/db";
import {
  DUEL_ACTIONS,
  DUEL_DEFAULT_ACTION,
  DUEL_ROUND_TICKS,
  DUEL_STALE_MS,
  DUEL_TICK_MS,
  type DuelAction,
} from "~/lib/constants";
import {
  createMatchState,
  step,
  type FighterState,
  type MatchState,
} from "~/server/duel/engine";
import { Prisma, type DuelMatch } from "../../../generated/prisma";

/** Hard cap on ticks simulated in a single advanceMatch call (anti-burst). */
const MAX_ADVANCE_TICKS = 1200;

export class DuelError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = "DuelError";
  }
}

interface PendingTickActions {
  actionA?: DuelAction;
  actionB?: DuelAction;
}

interface PendingActions extends PendingTickActions {
  round: number;
  tick: number;
  /** Early submissions for tick + 1 (same round). */
  next?: PendingTickActions & { tick: number };
  lastActionAtA?: string;
  lastActionAtB?: string;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export async function createMatch(input: {
  arenaId?: string;
  agentAId: string;
  agentBId: string;
  entryAId?: string;
  entryBId?: string;
  bestOf?: number;
}): Promise<DuelMatch> {
  const { arenaId, agentAId, agentBId, entryAId, entryBId } = input;
  const bestOf = input.bestOf ?? 3;

  if (!agentAId || !agentBId || agentAId === agentBId) {
    throw new DuelError("INVALID_AGENTS", 400, "agentAId and agentBId must be two different agents");
  }
  if (!Number.isInteger(bestOf) || bestOf < 1 || bestOf > 5 || bestOf % 2 === 0) {
    throw new DuelError("INVALID_BEST_OF", 400, "bestOf must be an odd integer between 1 and 5");
  }

  const agents = await db.agent.findMany({
    where: { id: { in: [agentAId, agentBId] }, deletedAt: null },
    select: { id: true },
  });
  if (agents.length !== 2) {
    throw new DuelError("AGENT_NOT_FOUND", 404, "One or both agents do not exist");
  }

  if (arenaId) {
    const arena = await db.arena.findUnique({ where: { id: arenaId } });
    if (!arena) throw new DuelError("ARENA_NOT_FOUND", 404, "Arena does not exist");
    if (arena.evalMode !== "DUEL") {
      throw new DuelError("ARENA_NOT_DUEL", 400, "Arena evalMode is not DUEL");
    }
    if (arena.status !== "OPEN") {
      throw new DuelError("ARENA_NOT_OPEN", 400, `Arena is ${arena.status}, not OPEN`);
    }
  }

  const seed = randomInt(0, 2 ** 31);
  const state = createMatchState(seed, bestOf);

  return db.duelMatch.create({
    data: {
      arenaId: arenaId ?? null,
      agentAId,
      agentBId,
      entryAId: entryAId ?? null,
      entryBId: entryBId ?? null,
      status: "QUEUED",
      bestOf,
      seed,
      stateJson: JSON.stringify(state),
      pendingJson: "{}",
      lastTickAt: new Date(),
    },
  });
}

// ---------------------------------------------------------------------------
// On-demand advancement
// ---------------------------------------------------------------------------

export async function advanceMatch(matchId: string, now = new Date()): Promise<DuelMatch> {
  await cancelStaleMatches(now);

  let match = await db.duelMatch.findUnique({ where: { id: matchId } });
  if (!match) throw new DuelError("MATCH_NOT_FOUND", 404, "Match does not exist");
  if (match.status === "DONE" || match.status === "CANCELLED") return match;

  // QUEUED => RUNNING: the match clock starts on first advancement.
  if (match.status === "QUEUED") {
    await db.duelMatch.updateMany({
      where: { id: matchId, lockVersion: match.lockVersion },
      data: { status: "RUNNING", lastTickAt: now, lockVersion: match.lockVersion + 1 },
    });
    return (await db.duelMatch.findUnique({ where: { id: matchId } }))!;
  }

  // RUNNING: how many ticks are owed?
  const elapsed = Math.floor((now.getTime() - match.lastTickAt.getTime()) / DUEL_TICK_MS);
  if (elapsed <= 0) return match;
  const ticksToAdvance = Math.min(elapsed, MAX_ADVANCE_TICKS);

  // Claim the right to advance via optimistic lock.
  const claim = await db.duelMatch.updateMany({
    where: { id: matchId, lockVersion: match.lockVersion },
    data: { lockVersion: match.lockVersion + 1 },
  });
  if (claim.count === 0) {
    // Someone else is advancing; return whatever they produce.
    return (await db.duelMatch.findUnique({ where: { id: matchId } }))!;
  }

  let state = JSON.parse(match.stateJson) as MatchState;
  const pending = parsePending(match.pendingJson);
  const tickRows: { matchId: string; round: number; tick: number; actionA: string; actionB: string }[] = [];

  let advanced = 0;
  while (advanced < ticksToAdvance && state.status !== "MATCH_END") {
    if (state.status === "ROUND_END") {
      // Round transitions are instant and consume no wall-clock tick.
      state = step(state, "idle", "idle");
      continue;
    }
    const forThisTick = pendingActionsForTick(pending, state.round, state.tickInRound);
    const actionA = validAction(forThisTick?.actionA) ?? DUEL_DEFAULT_ACTION;
    const actionB = validAction(forThisTick?.actionB) ?? DUEL_DEFAULT_ACTION;
    tickRows.push({
      matchId,
      round: state.round,
      tick: state.tickInRound,
      actionA,
      actionB,
    });
    state = step(state, actionA, actionB);
    advanced += 1;
  }

  const matchEnded = state.status === "MATCH_END";
  const winnerAgentId = matchEnded
    ? state.winnerSide === "A"
      ? match.agentAId
      : state.winnerSide === "B"
        ? match.agentBId
        : null
    : undefined;

  const updateMatch = db.duelMatch.update({
    where: { id: matchId },
    data: {
      stateJson: JSON.stringify(state),
      lastTickAt: new Date(match.lastTickAt.getTime() + advanced * DUEL_TICK_MS),
      roundWinsA: state.roundWinsA,
      roundWinsB: state.roundWinsB,
      currentRound: state.round,
      ...(matchEnded
        ? { status: "DONE", winnerAgentId, finishedAt: now }
        : {}),
    },
  });
  const writes: Prisma.PrismaPromise<unknown>[] =
    tickRows.length > 0 ? [db.duelTick.createMany({ data: tickRows }), updateMatch] : [updateMatch];
  try {
    await db.$transaction(writes);
  } catch (error) {
    // A concurrent advanceMatch committed the same tick range first (the lockVersion
    // claim is not held across simulation). Its commit is authoritative — re-read.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return (await db.duelMatch.findUnique({ where: { id: matchId } }))!;
    }
    throw error;
  }

  if (matchEnded) {
    const arenaId = match.arenaId;
    const payload = (result: "win" | "loss" | "draw") =>
      JSON.stringify({ matchId, arenaId, result });
    const resultA = winnerAgentId === null ? "draw" : winnerAgentId === match.agentAId ? "win" : "loss";
    await db.notification.createMany({
      data: [
        { recipientType: "agent", recipientId: match.agentAId, type: "duel_result", payload: payload(resultA) },
        {
          recipientType: "agent",
          recipientId: match.agentBId,
          type: "duel_result",
          payload: payload(resultA === "draw" ? "draw" : resultA === "win" ? "loss" : "win"),
        },
      ],
    });
  }

  match = await db.duelMatch.findUnique({ where: { id: matchId } });
  return match!;
}

// ---------------------------------------------------------------------------
// Action submission
// ---------------------------------------------------------------------------

export async function submitAction(
  matchId: string,
  agentId: string,
  tick: number,
  action: DuelAction,
): Promise<DuelMatch> {
  if (!Number.isInteger(tick) || tick < 0 || tick >= DUEL_ROUND_TICKS_UPPER) {
    throw new DuelError("INVALID_TICK", 400, `tick must be an integer in [0, ${DUEL_ROUND_TICKS_UPPER - 1}]`);
  }
  if (!validAction(action)) {
    throw new DuelError("INVALID_ACTION", 400, `action must be one of ${DUEL_ACTIONS.join(", ")}`);
  }

  // Kick QUEUED => RUNNING and bring the match up to date before validating.
  await advanceMatch(matchId);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const match = await db.duelMatch.findUnique({ where: { id: matchId } });
    if (!match) throw new DuelError("MATCH_NOT_FOUND", 404, "Match does not exist");
    if (match.status !== "RUNNING") {
      throw new DuelError("MATCH_NOT_RUNNING", 409, `Match is ${match.status}, not RUNNING`);
    }
    const side = agentId === match.agentAId ? "A" : agentId === match.agentBId ? "B" : null;
    if (!side) {
      throw new DuelError("NOT_PARTICIPANT", 403, "Only the two participating agents can submit actions");
    }
    const state = JSON.parse(match.stateJson) as MatchState;
    // Accept the current tick, or the next one (early submission). Anything
    // older — or further ahead — is a mismatch the client must re-poll for.
    const currentTick = state.tickInRound;
    const isCurrent = tick === currentTick;
    const isNext = tick === currentTick + 1 && tick < DUEL_ROUND_TICKS;
    if (state.status !== "IN_ROUND" || (!isCurrent && !isNext)) {
      throw new DuelError(
        "TICK_MISMATCH",
        409,
        `Match is on round ${state.round} tick ${currentTick}; submitted tick ${tick} (accepted: ${currentTick} or ${currentTick + 1}). Re-poll state and retry.`,
      );
    }

    const pending = parsePending(match.pendingJson);
    const sameRound = pending !== null && pending.round === state.round ? pending : null;
    const primarySlot: PendingTickActions | null =
      sameRound && sameRound.tick === currentTick ? sameRound : null;
    const nextSlot = sameRound?.next ?? null;
    // A previously stored early submission becomes the current tick's base
    // once the engine has advanced into it.
    const currentBase =
      primarySlot ?? (nextSlot && nextSlot.tick === currentTick ? nextSlot : null);
    const nextBase = nextSlot && nextSlot.tick === currentTick + 1 ? nextSlot : null;
    const nowIso = new Date().toISOString();
    const next: PendingActions = {
      round: state.round,
      tick: currentTick,
      actionA: side === "A" && isCurrent ? action : currentBase?.actionA,
      actionB: side === "B" && isCurrent ? action : currentBase?.actionB,
      next:
        isNext || nextBase
          ? {
              tick: currentTick + 1,
              actionA: side === "A" && isNext ? action : nextBase?.actionA,
              actionB: side === "B" && isNext ? action : nextBase?.actionB,
            }
          : undefined,
      lastActionAtA: side === "A" ? nowIso : pending?.lastActionAtA,
      lastActionAtB: side === "B" ? nowIso : pending?.lastActionAtB,
    };

    const res = await db.duelMatch.updateMany({
      where: { id: matchId, lockVersion: match.lockVersion },
      data: { pendingJson: JSON.stringify(next), lockVersion: match.lockVersion + 1 },
    });
    if (res.count === 1) {
      // Advance opportunistically so the action is simulated as soon as possible.
      return advanceMatch(matchId);
    }
    // Lost the race against another writer — re-read and retry.
  }
  throw new DuelError("WRITE_CONFLICT", 409, "Could not record action; retry");
}

// ---------------------------------------------------------------------------
// Public read model
// ---------------------------------------------------------------------------

export async function getPublicState(matchId: string) {
  const match = await advanceMatch(matchId);
  const state = JSON.parse(match.stateJson) as MatchState;

  const pub = (f: FighterState) => ({
    x: f.x,
    hp: f.hp,
    energy: f.energy,
    action: f.action,
    hitstun: f.hitstun,
  });

  return {
    id: match.id,
    status: match.status,
    arenaId: match.arenaId,
    agentAId: match.agentAId,
    agentBId: match.agentBId,
    round: state.round,
    tickInRound: state.tickInRound,
    tickMs: DUEL_TICK_MS,
    a: pub(state.a),
    b: pub(state.b),
    roundWinsA: state.roundWinsA,
    roundWinsB: state.roundWinsB,
    lastActions: { a: state.lastActionA, b: state.lastActionB },
    winnerAgentId: match.winnerAgentId,
  };
}

// ---------------------------------------------------------------------------
// Stale match cancellation
// ---------------------------------------------------------------------------

/**
 * Cancel RUNNING matches where BOTH sides have not submitted an action within
 * DUEL_STALE_MS. Activity timestamps live in pendingJson; a side that never
 * submitted falls back to the match creation time.
 */
export async function cancelStaleMatches(now = new Date()): Promise<number> {
  const cutoff = now.getTime() - DUEL_STALE_MS;
  const running = await db.duelMatch.findMany({
    where: { status: "RUNNING" },
    select: { id: true, pendingJson: true, createdAt: true },
  });
  const staleIds: string[] = [];
  for (const m of running) {
    const pending = parsePending(m.pendingJson);
    const lastA = timestampOr(pending?.lastActionAtA, m.createdAt);
    const lastB = timestampOr(pending?.lastActionAtB, m.createdAt);
    if (lastA < cutoff && lastB < cutoff) staleIds.push(m.id);
  }
  if (staleIds.length > 0) {
    await db.duelMatch.updateMany({
      where: { id: { in: staleIds } },
      data: { status: "CANCELLED", finishedAt: now },
    });
  }
  return staleIds.length;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DUEL_ROUND_TICKS_UPPER = DUEL_ROUND_TICKS; // valid submission ticks are 0..DUEL_ROUND_TICKS-1

function validAction(action: unknown): DuelAction | null {
  return typeof action === "string" && (DUEL_ACTIONS as readonly string[]).includes(action)
    ? (action as DuelAction)
    : null;
}

function pendingActionsForTick(
  pending: PendingActions | null,
  round: number,
  tick: number,
): PendingTickActions | null {
  if (!pending || pending.round !== round) return null;
  if (pending.tick === tick) return pending;
  if (pending.next && pending.next.tick === tick) return pending.next;
  return null;
}

function parsePending(pendingJson: string): PendingActions | null {
  try {
    const p = JSON.parse(pendingJson) as Partial<PendingActions>;
    if (typeof p.round !== "number" || typeof p.tick !== "number") return null;
    return p as PendingActions;
  } catch {
    return null;
  }
}

function timestampOr(iso: string | undefined, fallback: Date): number {
  if (!iso) return fallback.getTime();
  const t = Date.parse(iso);
  return Number.isNaN(t) ? fallback.getTime() : t;
}
