/**
 * Helpers for prisma/seed.ts: deterministic offline DUEL simulation.
 *
 * simulateMatch() runs a whole match through the pure engine
 * (src/server/duel/engine.ts) with two simple policy AIs and returns the
 * DuelTick rows plus the final engine snapshot, so the seed can persist a
 * finished match that the /matches/[id] replay page can play back from
 * seed + tick rows alone.
 */

import {
  createMatchState,
  step,
  type MatchState,
} from "../src/server/duel/engine";
import type { DuelAction } from "../src/lib/constants";

export interface SimulatedTick {
  round: number;
  tick: number;
  actionA: DuelAction;
  actionB: DuelAction;
}

export interface SimulatedMatch {
  ticks: SimulatedTick[];
  finalState: MatchState;
}

/** Same PRNG family as the engine, but an independent stream for the policies. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Simple policy AI (same shape as scripts/duel-smoke.ts): close distance, poke, guard. */
export function duelPolicy(
  rand: () => number,
  s: MatchState,
  side: "a" | "b",
): DuelAction {
  const me = side === "a" ? s.a : s.b;
  const opp = side === "a" ? s.b : s.a;
  const dist = Math.abs(me.x - opp.x);
  if (me.hitstun > 0) return "guard";
  if (me.energy >= 50 && dist <= 16 && rand() < 0.4) return "special";
  if (dist > 10) return "advance";
  const r = rand();
  if (r < 0.35) return "light";
  if (r < 0.6) return "heavy";
  if (r < 0.8) return "guard";
  return "retreat";
}

/**
 * Run one full match offline. Tick rows are keyed by the pre-step
 * (round, tickInRound) — exactly how advanceMatch() persists them, so
 * seed + rows replay byte-identically (see scripts/duel-smoke.ts Part 2).
 */
export function simulateMatch(seed: number, bestOf = 3): SimulatedMatch {
  const rand = mulberry32(seed ^ 0x9e3779b9);
  let state = createMatchState(seed, bestOf);
  const ticks: SimulatedTick[] = [];

  let guard = 0;
  while (state.status !== "MATCH_END") {
    if (guard++ > 5000) {
      throw new Error(`simulateMatch(seed=${seed}) did not converge`);
    }
    if (state.status === "ROUND_END") {
      // Round transitions are instant and consume no tick row.
      state = step(state, "idle", "idle");
      continue;
    }
    const actionA = duelPolicy(rand, state, "a");
    const actionB = duelPolicy(rand, state, "b");
    ticks.push({ round: state.round, tick: state.tickInRound, actionA, actionB });
    state = step(state, actionA, actionB);
  }

  return { ticks, finalState: state };
}
