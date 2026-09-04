import type { DuelAction } from "~/lib/constants";
import { createMatchState, step, type MatchState } from "~/server/duel/engine";

import { frameFromMatchState, type CanvasFrame } from "./types";

export interface ReplayTick {
  round: number;
  tick: number;
  actionA: DuelAction;
  actionB: DuelAction;
}

/**
 * Deterministically replay a match client-side from its DuelTick rows.
 *
 * The engine (src/server/duel/engine.ts) is pure and free of node-only
 * imports, so it is reused directly in the browser: same seed + same action
 * sequence => same states. Round transitions (ROUND_END -> next round)
 * consume no tick rows, so they are stepped through between rounds.
 *
 * Returns one CanvasFrame per simulated tick, plus the initial frame at
 * index 0. Ticks that don't match the engine's position are skipped
 * defensively (e.g. a CANCELLED match with truncated history).
 */
export function buildReplayFrames(
  seed: number,
  bestOf: number,
  ticks: ReplayTick[],
): CanvasFrame[] {
  const frames: CanvasFrame[] = [];
  let state: MatchState = createMatchState(seed, bestOf);
  frames.push(frameFromMatchState(state));

  for (const row of ticks) {
    if (state.status === "MATCH_END") break;
    // Round transitions are instant and consume no tick rows.
    while (state.status === "ROUND_END" && state.round < row.round) {
      state = step(state, "idle", "idle");
    }
    if (state.status !== "IN_ROUND") break;
    if (state.round !== row.round || state.tickInRound !== row.tick) continue;
    state = step(state, row.actionA, row.actionB);
    frames.push(frameFromMatchState(state));
  }

  return frames;
}
