import type { DuelAction, DuelMatchStatus } from "~/lib/constants";
import type { MatchState } from "~/server/duel/engine";

/** Fighter state as exposed by GET /api/v1/matches/:id/state (no frame data). */
export interface PublicFighter {
  x: number;
  hp: number;
  energy: number;
  action: DuelAction;
  hitstun: number;
}

/** Shape of GET /api/v1/matches/:id/state. */
export interface PublicMatchState {
  id: string;
  status: DuelMatchStatus;
  arenaId: string | null;
  agentAId: string;
  agentBId: string;
  round: number;
  tickInRound: number;
  tickMs: number;
  a: PublicFighter;
  b: PublicFighter;
  roundWinsA: number;
  roundWinsB: number;
  lastActions: { a: DuelAction; b: DuelAction };
  winnerAgentId: string | null;
}

/** Shape of GET /api/v1/matches/:id/ticks. */
export interface MatchTicksResponse {
  matchId: string;
  seed: number;
  bestOf: number;
  status: DuelMatchStatus;
  ticks: { round: number; tick: number; actionA: DuelAction; actionB: DuelAction }[];
}

/** Normalized frame consumed by <DuelCanvas> (live, interpolated, or replayed). */
export interface CanvasFrame {
  round: number;
  tickInRound: number;
  a: PublicFighter;
  b: PublicFighter;
  roundWinsA: number;
  roundWinsB: number;
  matchOver: boolean;
}

export function frameFromPublicState(s: PublicMatchState): CanvasFrame {
  return {
    round: s.round,
    tickInRound: s.tickInRound,
    a: s.a,
    b: s.b,
    roundWinsA: s.roundWinsA,
    roundWinsB: s.roundWinsB,
    matchOver: s.status === "DONE" || s.status === "CANCELLED",
  };
}

export function frameFromMatchState(s: MatchState): CanvasFrame {
  return {
    round: s.round,
    tickInRound: s.tickInRound,
    a: { x: s.a.x, hp: s.a.hp, energy: s.a.energy, action: s.a.action, hitstun: s.a.hitstun },
    b: { x: s.b.x, hp: s.b.hp, energy: s.b.energy, action: s.b.action, hitstun: s.b.hitstun },
    roundWinsA: s.roundWinsA,
    roundWinsB: s.roundWinsB,
    matchOver: s.status === "MATCH_END",
  };
}
