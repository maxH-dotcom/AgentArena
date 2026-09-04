/**
 * DUEL engine — pure, deterministic, zero DB/IO dependencies.
 * See docs/PLAN.md 实时对决模块: same seed + same action sequence => same result,
 * so a whole match replays from `DuelTick` rows alone.
 *
 * Rules (one-dimensional arena, positions 0..DUEL_ARENA_SIZE):
 * - A starts at x=20 facing right, B at x=80 facing left. Fighters can never
 *   cross each other and must keep at least MIN_DISTANCE between them.
 * - Each tick both sides submit one action. Missing input => DUEL_DEFAULT_ACTION.
 * - Attacks have startup/active/recovery frames; a hit lands when an active
 *   frame finds the opponent within range.
 * - `guard` fully blocks light/heavy; special deals 50% chip damage through guard.
 * - Unguarded hits interrupt the victim's move and inflict hitstun (which also
 *   grants brief invulnerability, so multi-active-frame moves can't double-hit).
 * - Energy regens every tick; landing a damaging hit grants bonus energy.
 * - Both fighters may hit each other on the same tick; a double KO draws the round.
 * - Round ends on KO or after DUEL_ROUND_TICKS (higher HP wins; equal HP = draw).
 * - Match is best-of-N (first to floor(N/2)+1 round wins). Drawn rounds don't
 *   count; if N+2 rounds pass without a decision the match is a DRAW.
 *
 * The PRNG (mulberry32) is carried inside MatchState so serialization is enough
 * to resume/replay; it is only consumed for same-tick movement tie-breaks.
 */

import {
  DUEL_ACTIONS,
  DUEL_ARENA_SIZE,
  DUEL_DEFAULT_ACTION,
  DUEL_MAX_ENERGY,
  DUEL_MAX_HP,
  DUEL_ROUND_TICKS,
  type DuelAction,
} from "~/lib/constants";

export type DuelSide = "A" | "B";
export type MatchPhase = "IN_ROUND" | "ROUND_END" | "MATCH_END";
export type WinnerSide = DuelSide | "DRAW";

export interface FighterState {
  /** Position on the 1D arena axis, 0..DUEL_ARENA_SIZE */
  x: number;
  hp: number;
  energy: number;
  /** Move currently being executed (attacks lock until startup+active+recovery elapse) */
  action: DuelAction;
  /** Ticks elapsed in the current move (1-based while a move is running, else 0) */
  frame: number;
  /** Remaining ticks the fighter cannot act (and cannot be hit) */
  hitstun: number;
}

export interface MatchState {
  seed: number;
  bestOf: number;
  /** 1-based round number */
  round: number;
  /** Ticks completed in the current round (0..DUEL_ROUND_TICKS) */
  tickInRound: number;
  a: FighterState;
  b: FighterState;
  roundWinsA: number;
  roundWinsB: number;
  status: MatchPhase;
  winnerSide?: WinnerSide;
  /** Actions that were fed into the previous tick (for spectators) */
  lastActionA: DuelAction;
  lastActionB: DuelAction;
  /** mulberry32 PRNG state */
  rng: number;
}

// --- Fixed frame data (startup / active / recovery, in ticks) ---------------

type AttackName = "light" | "heavy" | "special";

interface AttackData {
  startup: number;
  active: number;
  recovery: number;
  damage: number;
  range: number;
  energyCost: number;
}

export const ATTACKS: Record<AttackName, AttackData> = {
  light: { startup: 1, active: 1, recovery: 2, damage: 6, range: 8, energyCost: 0 },
  heavy: { startup: 3, active: 1, recovery: 5, damage: 14, range: 10, energyCost: 0 },
  special: { startup: 5, active: 2, recovery: 8, damage: 25, range: 16, energyCost: 50 },
};

/** Ticks of hitstun (and invulnerability) after an unguarded hit */
export const HITSTUN_TICKS = 3;
/** Movement speed per tick for advance/retreat */
export const MOVE_SPEED = 3;
/** Fighters can never be closer than this */
export const MIN_DISTANCE = 2;
/** Energy regenerated per tick */
export const ENERGY_REGEN = 2;
/** Bonus energy for landing a damaging hit */
export const HIT_ENERGY_BONUS = 10;
/** Energy each fighter starts a round with */
export const START_ENERGY = 50;

const ATTACK_NAMES = Object.keys(ATTACKS) as AttackName[];

function isAttack(action: DuelAction): action is AttackName {
  return (ATTACK_NAMES as string[]).includes(action);
}

function sanitizeAction(action: unknown): DuelAction {
  return typeof action === "string" && (DUEL_ACTIONS as readonly string[]).includes(action)
    ? (action as DuelAction)
    : DUEL_DEFAULT_ACTION;
}

function freshFighter(x: number): FighterState {
  return {
    x,
    hp: DUEL_MAX_HP,
    energy: START_ENERGY,
    action: "idle",
    frame: 0,
    hitstun: 0,
  };
}

/** mulberry32 — small deterministic PRNG; state is a uint32 carried in MatchState.rng */
function nextRandom(state: MatchState): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function createMatchState(seed: number, bestOf: number): MatchState {
  return {
    seed,
    bestOf,
    round: 1,
    tickInRound: 0,
    a: freshFighter(20),
    b: freshFighter(80),
    roundWinsA: 0,
    roundWinsB: 0,
    status: "IN_ROUND",
    lastActionA: "idle",
    lastActionB: "idle",
    rng: seed >>> 0,
  };
}

/**
 * Advance the match by one step. Pure: returns a new state, never mutates input.
 * - IN_ROUND: simulates one tick with the given actions.
 * - ROUND_END: transitions to the next round (actions ignored, consumes no tick).
 * - MATCH_END: no-op.
 */
export function step(state: MatchState, actionA: DuelAction, actionB: DuelAction): MatchState {
  const s = structuredClone(state);

  if (s.status === "MATCH_END") return s;

  if (s.status === "ROUND_END") {
    s.round += 1;
    s.tickInRound = 0;
    s.a = freshFighter(20);
    s.b = freshFighter(80);
    s.status = "IN_ROUND";
    return s;
  }

  const actA = sanitizeAction(actionA);
  const actB = sanitizeAction(actionB);
  s.lastActionA = actA;
  s.lastActionB = actB;

  // 1. Progress each fighter's action state (hitstun / ongoing move / new move).
  updateFighterAction(s.a, actA);
  updateFighterAction(s.b, actB);

  // 2. Movement. When both fighters move, the PRNG decides who resolves first
  //    so the min-distance rule stays deterministic.
  const aMoves = s.a.action === "advance" || s.a.action === "retreat";
  const bMoves = s.b.action === "advance" || s.b.action === "retreat";
  if (aMoves && bMoves) {
    if (nextRandom(s) < 0.5) {
      applyMovement(s.a, s.b, "A");
      applyMovement(s.b, s.a, "B");
    } else {
      applyMovement(s.b, s.a, "B");
      applyMovement(s.a, s.b, "A");
    }
  } else if (aMoves) {
    applyMovement(s.a, s.b, "A");
  } else if (bMoves) {
    applyMovement(s.b, s.a, "B");
  }

  // 3. Hit detection — computed simultaneously before any damage is applied.
  const aHit = connects(s.a, s.b) ? describeHit(s.a, s.b) : null;
  const bHit = connects(s.b, s.a) ? describeHit(s.b, s.a) : null;

  // 4. Apply damage (both sides at once: double KO is possible).
  if (aHit) applyHit(s.b, s.a, aHit);
  if (bHit) applyHit(s.a, s.b, bHit);

  // 5. Energy regen.
  s.a.energy = clamp(s.a.energy + ENERGY_REGEN, 0, DUEL_MAX_ENERGY);
  s.b.energy = clamp(s.b.energy + ENERGY_REGEN, 0, DUEL_MAX_ENERGY);

  // 6. Tick bookkeeping + round/match resolution.
  s.tickInRound += 1;
  const aDown = s.a.hp <= 0;
  const bDown = s.b.hp <= 0;
  if (aDown && bDown) {
    endRound(s, "DRAW");
  } else if (aDown) {
    endRound(s, "B");
  } else if (bDown) {
    endRound(s, "A");
  } else if (s.tickInRound >= DUEL_ROUND_TICKS) {
    endRound(s, s.a.hp > s.b.hp ? "A" : s.b.hp > s.a.hp ? "B" : "DRAW");
  }

  return s;
}

function updateFighterAction(f: FighterState, chosen: DuelAction): void {
  if (f.hitstun > 0) {
    f.hitstun -= 1;
    f.action = "idle";
    f.frame = 0;
    return;
  }
  if (isAttack(f.action)) {
    const data = ATTACKS[f.action];
    if (f.frame < data.startup + data.active + data.recovery) {
      f.frame += 1;
      return; // move still in progress; new input is ignored
    }
  }
  if (isAttack(chosen)) {
    const data = ATTACKS[chosen];
    if (f.energy < data.energyCost) {
      f.action = "idle";
      f.frame = 0;
      return;
    }
    f.energy -= data.energyCost;
    f.action = chosen;
    f.frame = 1;
    return;
  }
  f.action = chosen;
  f.frame = 0;
}

function applyMovement(mover: FighterState, opponent: FighterState, side: DuelSide): void {
  const toward = side === "A" ? 1 : -1;
  const dir = mover.action === "advance" ? toward : -toward;
  let x = clamp(mover.x + dir * MOVE_SPEED, 0, DUEL_ARENA_SIZE);
  // Never cross the opponent, keep MIN_DISTANCE.
  x = side === "A" ? Math.min(x, opponent.x - MIN_DISTANCE) : Math.max(x, opponent.x + MIN_DISTANCE);
  mover.x = clamp(x, 0, DUEL_ARENA_SIZE);
}

function isInActiveWindow(f: FighterState): boolean {
  if (!isAttack(f.action)) return false;
  const data = ATTACKS[f.action];
  return f.frame > data.startup && f.frame <= data.startup + data.active;
}

function connects(attacker: FighterState, defender: FighterState): boolean {
  if (!isInActiveWindow(attacker)) return false;
  if (defender.hitstun > 0) return false; // hitstun grants invulnerability
  return Math.abs(attacker.x - defender.x) <= ATTACKS[attacker.action as AttackName].range;
}

interface Hit {
  damage: number;
  blocked: boolean;
}

function describeHit(attacker: FighterState, defender: FighterState): Hit {
  const data = ATTACKS[attacker.action as AttackName];
  if (defender.action === "guard") {
    // guard fully blocks light/heavy; special chips for 50%
    return attacker.action === "special"
      ? { damage: Math.floor(data.damage / 2), blocked: true }
      : { damage: 0, blocked: true };
  }
  return { damage: data.damage, blocked: false };
}

function applyHit(defender: FighterState, attacker: FighterState, hit: Hit): void {
  if (hit.damage > 0) {
    defender.hp = Math.max(0, defender.hp - hit.damage);
    attacker.energy = clamp(attacker.energy + HIT_ENERGY_BONUS, 0, DUEL_MAX_ENERGY);
  }
  if (!hit.blocked) {
    // Unguarded hit: interrupt whatever the defender was doing.
    defender.hitstun = HITSTUN_TICKS;
    defender.action = "idle";
    defender.frame = 0;
  }
}

function endRound(s: MatchState, winner: WinnerSide): void {
  if (winner === "A") s.roundWinsA += 1;
  else if (winner === "B") s.roundWinsB += 1;

  const winsNeeded = Math.floor(s.bestOf / 2) + 1;
  if (s.roundWinsA >= winsNeeded) {
    s.status = "MATCH_END";
    s.winnerSide = "A";
  } else if (s.roundWinsB >= winsNeeded) {
    s.status = "MATCH_END";
    s.winnerSide = "B";
  } else if (s.round >= s.bestOf + 2) {
    // Round cap reached without a decision: most round wins takes it, else draw.
    s.status = "MATCH_END";
    s.winnerSide =
      s.roundWinsA > s.roundWinsB ? "A" : s.roundWinsB > s.roundWinsA ? "B" : "DRAW";
  } else {
    s.status = "ROUND_END";
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
