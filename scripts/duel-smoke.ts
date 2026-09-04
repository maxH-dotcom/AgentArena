/**
 * DUEL engine smoke test — run with: pnpm tsx scripts/duel-smoke.ts
 *
 * Part 1 (pure engine): simulate full matches with simple policy AIs and assert
 *   - rounds always resolve within DUEL_ROUND_TICKS, matches always converge
 *   - HP never goes negative
 *   - same seed + same policies => byte-identical final state (determinism)
 *
 * Part 2 (DB layer): against the real dev SQLite (DATABASE_URL from .env,
 * default file:./db.sqlite) — create two temporary agents, run a full match
 * through createMatch/submitAction/advanceMatch on a synthetic clock, assert
 * DONE + notifications, and verify that seed + DuelTick rows replay to the
 * exact persisted final state. All rows are cleaned up afterwards.
 */

import assert from "node:assert/strict";

// Loads .env + defaults DATABASE_URL before any ~/ import (see scripts/load-env.ts).
import "./load-env";

import {
  createMatchState,
  step,
  type MatchState,
} from "../src/server/duel/engine";
import { DUEL_ROUND_TICKS, DUEL_TICK_MS, type DuelAction } from "../src/lib/constants";

// --- Policy AI ---------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function policy(rand: () => number, s: MatchState, side: "a" | "b"): DuelAction {
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

// --- Part 1: pure engine ------------------------------------------------------

function simulate(seed: number): MatchState {
  const rand = mulberry32(seed ^ 0x9e3779b9);
  let s = createMatchState(seed, 3);
  let steps = 0;
  while (s.status !== "MATCH_END") {
    assert.ok(steps++ < 4000, `match ${seed} must converge`);
    if (s.status === "IN_ROUND") {
      assert.ok(s.a.hp >= 0 && s.b.hp >= 0, "HP must never go negative");
      assert.ok(
        s.tickInRound < DUEL_ROUND_TICKS,
        `round ${s.round} exceeded ${DUEL_ROUND_TICKS} ticks`,
      );
      assert.ok(s.a.energy >= 0 && s.b.energy >= 0, "energy must never go negative");
      assert.ok(Math.abs(s.a.x - s.b.x) >= 2, "fighters must keep min distance");
      s = step(s, policy(rand, s, "a"), policy(rand, s, "b"));
    } else {
      s = step(s, "idle", "idle"); // ROUND_END transition
    }
  }
  assert.ok(s.winnerSide !== undefined, "winnerSide must be set at MATCH_END");
  return s;
}

function testEngine(): void {
  for (const seed of [1, 42, 1337, 987654321]) {
    const first = simulate(seed);
    const second = simulate(seed);
    assert.equal(
      JSON.stringify(second),
      JSON.stringify(first),
      `seed ${seed}: same seed must replay identically`,
    );
    console.log(
      `  seed ${seed}: ${first.winnerSide} wins ${first.roundWinsA}-${first.roundWinsB} in ${first.round} round(s)`,
    );
  }
  console.log("Part 1 OK: pure engine converges, HP >= 0, deterministic replay");
}

// --- Part 2: DB lifecycle -----------------------------------------------------

async function testDb(): Promise<void> {
  const { db } = await import("../src/server/db");
  const { DuelError, advanceMatch, createMatch, getPublicState, submitAction } = await import(
    "../src/server/duel/match"
  );

  const suffix = Date.now().toString(36);
  const agentA = await db.agent.create({
    data: { name: `duel-smoke-a-${suffix}`, agentCard: "{}", apiKeyHash: `smoke-${suffix}-a` },
  });
  const agentB = await db.agent.create({
    data: { name: `duel-smoke-b-${suffix}`, agentCard: "{}", apiKeyHash: `smoke-${suffix}-b` },
  });

  try {
    const match = await createMatch({ agentAId: agentA.id, agentBId: agentB.id });
    assert.equal(match.status, "QUEUED");
    await advanceMatch(match.id); // QUEUED -> RUNNING, match clock starts

    const rand = mulberry32(0xc0ffee);
    let safety = 0;
    let mismatchChecked = false;
    let earlyChecked = false;
    let earlyGuardFor: { round: number; tick: number } | null = null;

    for (;;) {
      assert.ok(safety++ < 5000, "DB match must converge");
      const m = await db.duelMatch.findUniqueOrThrow({ where: { id: match.id } });
      if (m.status === "DONE") break;
      assert.equal(m.status, "RUNNING");
      const s = JSON.parse(m.stateJson) as MatchState;

      if (s.status === "IN_ROUND") {
        if (!mismatchChecked && s.tickInRound >= 1) {
          mismatchChecked = true;
          // tick+1 is accepted (early submission); tick+2 must still 409.
          const wrongTick = (s.tickInRound + 2) % DUEL_ROUND_TICKS;
          await assert.rejects(
            submitAction(match.id, agentA.id, wrongTick, "light"),
            (e: unknown) => e instanceof DuelError && e.code === "TICK_MISMATCH" && e.httpStatus === 409,
          );
        }
        if (!earlyChecked && s.tickInRound >= 1 && s.tickInRound + 1 < DUEL_ROUND_TICKS) {
          // Early submission for the next tick must be accepted and then
          // consumed by the engine when that tick is simulated (B skips its
          // regular submission for that tick below).
          earlyChecked = true;
          earlyGuardFor = { round: s.round, tick: s.tickInRound + 1 };
          await submitAction(match.id, agentB.id, s.tickInRound + 1, "guard");
        }
        // A real-time advance inside submitAction can occasionally consume the
        // tick between the two submissions — a TICK_MISMATCH there is benign.
        await submitAction(match.id, agentA.id, s.tickInRound, policy(rand, s, "a")).catch(
          (e: unknown) => {
            if (!(e instanceof DuelError && e.code === "TICK_MISMATCH")) throw e;
          },
        );
        const skipB =
          earlyGuardFor !== null &&
          earlyGuardFor.round === s.round &&
          earlyGuardFor.tick === s.tickInRound;
        if (!skipB) {
          await submitAction(match.id, agentB.id, s.tickInRound, policy(rand, s, "b")).catch(
            (e: unknown) => {
              if (!(e instanceof DuelError && e.code === "TICK_MISMATCH")) throw e;
            },
          );
        }
      }

      // Synthetic clock: fast-forward exactly one tick per iteration.
      const refreshed = await db.duelMatch.findUniqueOrThrow({ where: { id: match.id } });
      await advanceMatch(match.id, new Date(refreshed.lastTickAt.getTime() + DUEL_TICK_MS));
    }

    const finalMatch = await db.duelMatch.findUniqueOrThrow({ where: { id: match.id } });
    assert.equal(finalMatch.status, "DONE");
    assert.ok(finalMatch.finishedAt, "finishedAt set");

    const pub = await getPublicState(match.id);
    assert.equal(pub.status, "DONE");

    // The early-submitted guard must have been consumed by the engine.
    assert.ok(earlyGuardFor, "early submission path was exercised");
    const earlyTick = await db.duelTick.findUnique({
      where: {
        matchId_round_tick: {
          matchId: match.id,
          round: earlyGuardFor.round,
          tick: earlyGuardFor.tick,
        },
      },
    });
    assert.equal(earlyTick?.actionB, "guard", "early-submitted action must land in the DuelTick log");
    console.log(
      `  DB match ${match.id}: winner=${finalMatch.winnerAgentId ?? "DRAW"} rounds ${finalMatch.roundWinsA}-${finalMatch.roundWinsB}`,
    );

    // Notifications for both agents.
    const notifications = await db.notification.findMany({
      where: { type: "duel_result", recipientId: { in: [agentA.id, agentB.id] } },
    });
    assert.equal(notifications.length, 2, "both agents get a duel_result notification");

    // Deterministic replay from seed + DuelTick rows must equal the persisted state.
    const ticks = await db.duelTick.findMany({
      where: { matchId: match.id },
      orderBy: [{ round: "asc" }, { tick: "asc" }],
    });
    assert.ok(ticks.length > 0, "DuelTick rows persisted");
    let replay = createMatchState(finalMatch.seed, finalMatch.bestOf);
    for (const t of ticks) {
      while (replay.status === "ROUND_END") replay = step(replay, "idle", "idle");
      assert.equal(replay.round, t.round);
      assert.equal(replay.tickInRound, t.tick);
      replay = step(replay, t.actionA as DuelAction, t.actionB as DuelAction);
    }
    assert.deepEqual(
      replay,
      JSON.parse(finalMatch.stateJson),
      "seed + DuelTick replay must equal persisted final state",
    );
    console.log(`  replay verified from ${ticks.length} DuelTick rows`);
    console.log("Part 2 OK: createMatch -> submitAction loop -> DONE, notifications, replay");
  } finally {
    await db.notification.deleteMany({
      where: { type: "duel_result", recipientId: { in: [agentA.id, agentB.id] } },
    });
    await db.duelMatch.deleteMany({ where: { OR: [{ agentAId: agentA.id }, { agentBId: agentB.id }] } });
    await db.agent.deleteMany({ where: { id: { in: [agentA.id, agentB.id] } } });
    await db.$disconnect();
  }
}

testEngine();
await testDb();
console.log("duel-smoke: ALL GREEN");
