/**
 * DUEL worker — optional active advancement loop for self-hosted deployments
 * (the platform works workerless via on-demand advancement; see docs/PLAN.md).
 *
 * Run with: pnpm tsx scripts/duel-worker.ts
 *
 * Every 200ms: starts QUEUED matches, advances RUNNING ones to wall-clock now
 * and cancels stale matches. Progress is printed only when it changes.
 */

// Loads .env + defaults DATABASE_URL before any ~/ import (see scripts/load-env.ts).
import "./load-env";

const { db } = await import("../src/server/db");
const { advanceMatch, cancelStaleMatches } = await import("../src/server/duel/match");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let running = true;
process.on("SIGINT", () => {
  running = false;
});

console.log("duel-worker: advancing RUNNING matches every 200ms (Ctrl+C to stop)");

const lastPrinted = new Map<string, string>();

while (running) {
  try {
    const matches = await db.duelMatch.findMany({
      where: { status: { in: ["QUEUED", "RUNNING"] } },
      select: { id: true },
    });
    for (const m of matches) {
      const updated = await advanceMatch(m.id);
      const state = JSON.parse(updated.stateJson) as {
        round: number;
        tickInRound: number;
        roundWinsA: number;
        roundWinsB: number;
      };
      const line = `${updated.id} ${updated.status} round ${state.round} tick ${state.tickInRound} wins ${state.roundWinsA}-${state.roundWinsB}`;
      if (lastPrinted.get(m.id) !== line) {
        lastPrinted.set(m.id, line);
        console.log(`[${new Date().toISOString()}] ${line}`);
      }
      if (updated.status !== "RUNNING" && updated.status !== "QUEUED") {
        lastPrinted.delete(m.id);
      }
    }
    const cancelled = await cancelStaleMatches();
    if (cancelled > 0) console.log(`duel-worker: cancelled ${cancelled} stale match(es)`);
  } catch (e) {
    console.error("duel-worker: error", e);
  }
  await sleep(200);
}

await db.$disconnect();
console.log("duel-worker: stopped");
