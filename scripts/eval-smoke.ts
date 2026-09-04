/**
 * Smoke test for the evaluation subsystem (src/server/eval/*).
 *
 * Runs against the dev database (.env DATABASE_URL), creates temporary
 * arenas/entries/submissions, and verifies end-to-end:
 *   1. VOTE percentile computation (0/50/100 for 0/1/3 votes)
 *   2. AUTO full chain against a local fake agent endpoint (http server)
 *   3. AUTO fatal failure when the entry has no endpoint
 *   4. EXTERNAL full chain against a local fake judge endpoint
 *   5. Worker retry: flaky judge → attempts exhausted → FAILED
 *   6. HYBRID weighted finalScore (vote percentile × w + judge × w)
 *   7. closeArena: freeze scores, champion, camp winCount, notifications
 *
 * Pre-existing PENDING jobs (e.g. from prisma/seed.ts) are parked for the
 * duration of the run and restored afterwards. All temporary rows are deleted
 * in a finally block. Exits non-zero if any check fails.
 *
 * Run with: pnpm tsx scripts/eval-smoke.ts
 */

import "./load-env";

import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { ForbiddenError } from "~/server/actor";
import { db } from "~/server/db";
import { matchAnswer } from "~/server/eval/auto";
import {
  computeLiveScores,
  synthesizeFinalScore,
} from "~/server/eval/score";
import { ArenaStateError, closeArena } from "~/server/eval/settle";
import { parseJson } from "~/server/eval/types";
import { computeVoteScores, voteEvaluator } from "~/server/eval/vote";
import { MAX_EVAL_ATTEMPTS, claimPendingJob, processAll } from "~/server/eval/worker";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}`, detail === undefined ? "" : detail);
  }
}

const approx = (a: number | null, b: number) =>
  a !== null && Math.abs(a - b) < 1e-6;

const rid = Date.now().toString(36);

// Track every temporary row for cleanup.
const created = {
  camps: [] as string[],
  agents: [] as string[],
  arenas: [] as string[],
  entries: [] as string[],
  submissions: [] as string[],
  jobs: [] as string[],
  votes: [] as string[],
};

async function makeAgent(name: string, campId?: string, a2aEndpoint?: string) {
  const agent = await db.agent.create({
    data: {
      name: `smoke-${name}-${rid}`,
      apiKeyHash: createHash("sha256").update(`smoke-${name}-${rid}`).digest("hex"),
      agentCard: "{}",
      campId: campId ?? null,
      a2aEndpoint: a2aEndpoint ?? null,
    },
  });
  created.agents.push(agent.id);
  return agent;
}

async function makeArena(
  evalMode: string,
  evalConfig: unknown,
  creatorId: string,
) {
  const arena = await db.arena.create({
    data: {
      creatorType: "agent",
      creatorId,
      title: `smoke-${evalMode}-${rid}`,
      description: "smoke test arena",
      status: "OPEN",
      evalMode,
      evalConfig: JSON.stringify(evalConfig),
    },
  });
  created.arenas.push(arena.id);
  return arena;
}

async function makeEntry(arenaId: string, agentId: string, a2aEndpoint?: string) {
  const entry = await db.entry.create({
    data: { arenaId, agentId, a2aEndpoint: a2aEndpoint ?? null },
  });
  created.entries.push(entry.id);
  return entry;
}

async function makeSubmission(entryId: string, content: string, artifact?: unknown) {
  const submission = await db.submission.create({
    data: {
      entryId,
      content,
      artifact: artifact === undefined ? null : JSON.stringify(artifact),
    },
  });
  created.submissions.push(submission.id);
  return submission;
}

async function makeJob(submissionId: string) {
  const job = await db.evalJob.create({ data: { submissionId } });
  created.jobs.push(job.id);
  return job;
}

async function makeVote(voterKey: string, submissionId: string) {
  const vote = await db.vote.create({
    data: { voterType: "user", voterId: `smoke-${voterKey}-${rid}`, submissionId },
  });
  created.votes.push(vote.id);
  return vote;
}

// ---------------------------------------------------------------------------
// Fake agent endpoint + fake judge endpoint (plain HTTP, per eval contracts)
// ---------------------------------------------------------------------------

const AGENT_ANSWERS: Record<string, string> = {
  "2+2": "4",
  greet: "well hello there",
  code: "abc",
};

let lastAgentRequest: unknown = null;
let lastJudgeRequest: unknown = null;

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk.toString()));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function startFakeServers(): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    void (async () => {
      const body = parseJson<Record<string, unknown>>(await readBody(req), {});
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      switch (req.url) {
        case "/agent": {
          lastAgentRequest = body;
          const cases = (body.cases ?? []) as { input: string }[];
          send(200, { answers: cases.map((c) => AGENT_ANSWERS[c.input] ?? "") });
          break;
        }
        case "/judge":
          lastJudgeRequest = body;
          send(200, { score: 87.5, feedback: "solid work" });
          break;
        case "/agent-500":
        case "/judge-500":
          send(500, { error: "boom" });
          break;
        default:
          send(404, { error: "not found" });
      }
    })().catch(() => {
      res.writeHead(500).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${port}` };
}

// ---------------------------------------------------------------------------
// Smoke
// ---------------------------------------------------------------------------

async function main() {
  const { server, base } = await startFakeServers();

  // Park pre-existing PENDING jobs (e.g. seeded ones pointing at example.com)
  // so processAll() only touches rows created by this script.
  const parked = await db.evalJob.findMany({ where: { status: "PENDING" } });
  await db.evalJob.updateMany({
    where: { id: { in: parked.map((j) => j.id) } },
    data: { status: "RUNNING" },
  });

  try {
    // --- shared fixtures -------------------------------------------------
    const camp = await db.camp.create({
      data: {
        name: `smoke-camp-${rid}`,
        color: "#ff0066",
        createdByType: "agent",
        createdById: "smoke",
      },
    });
    created.camps.push(camp.id);

    const creator = await makeAgent("creator"); // arena creator, no camp
    const a1 = await makeAgent("a1", camp.id); // HYBRID champion
    const a2 = await makeAgent("a2");
    const a3 = await makeAgent("a3", camp.id); // VOTE champion

    // --- 1. VOTE percentile ----------------------------------------------
    console.log("\n[1] VOTE percentile");
    const arenaV = await makeArena("VOTE", {}, creator.id);
    const eV1 = await makeEntry(arenaV.id, a1.id);
    const eV2 = await makeEntry(arenaV.id, a2.id);
    const eV3 = await makeEntry(arenaV.id, a3.id);
    const sV1 = await makeSubmission(eV1.id, "sub with 0 votes");
    const sV2 = await makeSubmission(eV2.id, "sub with 1 vote");
    const sV3 = await makeSubmission(eV3.id, "sub with 3 votes");
    await makeVote("u1", sV2.id);
    await makeVote("u1", sV3.id);
    await makeVote("u2", sV3.id);
    await makeVote("u3", sV3.id);

    const tallies = await computeVoteScores(arenaV.id);
    check("0 votes → percentile 0", approx(tallies.get(sV1.id)?.voteScore ?? null, 0));
    check("1 vote → percentile 50", approx(tallies.get(sV2.id)?.voteScore ?? null, 50));
    check("3 votes → percentile 100", approx(tallies.get(sV3.id)?.voteScore ?? null, 100));
    check("top submission has rank 1", tallies.get(sV3.id)?.rank === 1);

    const voteResult = await voteEvaluator.evaluate({ arena: arenaV, entry: eV3, submission: sV3 });
    check("voteEvaluator returns voteScore 100", approx(voteResult.voteScore ?? null, 100));
    check(
      "voteEvaluator metrics include votes",
      (voteResult.metrics as { votes?: number } | undefined)?.votes === 3,
    );

    const voteJob = await makeJob(sV3.id);
    let stats = await processAll();
    const voteJobAfter = await db.evalJob.findUnique({ where: { id: voteJob.id } });
    const sV3After = await db.submission.findUnique({ where: { id: sV3.id } });
    check("worker drains VOTE job", stats.done === 1 && voteJobAfter?.status === "DONE");
    check("VOTE job persists voteScore snapshot", approx(sV3After?.voteScore ?? null, 100));

    // --- 2. AUTO full chain ----------------------------------------------
    console.log("\n[2] AUTO full chain (fake agent endpoint)");
    const autoCases = [
      { input: "2+2", expected: "4", match: "exact" },
      { input: "greet", expected: "hello", match: "contains" },
      { input: "code", expected: "^\\d+$", match: "regex" },
    ];
    const arenaA = await makeArena(
      "AUTO",
      { endpoint: `${base}/agent`, cases: autoCases, timeoutMs: 5000 },
      creator.id,
    );
    const eA1 = await makeEntry(arenaA.id, a1.id); // no a2aEndpoint → evalConfig.endpoint fallback
    const sA1 = await makeSubmission(eA1.id, "auto submission");
    const autoJob = await makeJob(sA1.id);
    stats = await processAll();

    const sA1After = await db.submission.findUnique({ where: { id: sA1.id } });
    const autoMetrics = parseJson<Record<string, unknown>>(sA1After?.metrics, {});
    check("AUTO job DONE", stats.done === 1);
    check(
      "autoScore = 2/3 * 100 (exact ✓ contains ✓ regex ✗)",
      approx(sA1After?.autoScore ?? null, (2 / 3) * 100),
    );
    check("metrics.matchedCases = 2", autoMetrics.matchedCases === 2);
    check("metrics.totalCases = 3", autoMetrics.totalCases === 3);
    check(
      "metrics.latencyMs recorded",
      typeof autoMetrics.latencyMs === "number" && autoMetrics.latencyMs >= 0,
    );
    const agentReq = lastAgentRequest as { taskId?: string; cases?: unknown[] } | null;
    check(
      "agent endpoint received { taskId, cases }",
      typeof agentReq?.taskId === "string" && agentReq.cases?.length === 3,
    );

    // matchAnswer unit checks (incl. invalid regex never matches)
    check("matchAnswer exact", matchAnswer("exact", "4", "4") && !matchAnswer("exact", "4", " 4"));
    check("matchAnswer contains", matchAnswer("contains", "ell", "hello"));
    check("matchAnswer regex", matchAnswer("regex", "^\\d+$", "42"));
    check("matchAnswer invalid regex → false", !matchAnswer("regex", "(", "anything"));

    // entry.a2aEndpoint snapshot path (no evalConfig.endpoint)
    const arenaA2 = await makeArena(
      "AUTO",
      { cases: [{ input: "2+2", expected: "4", match: "exact" }] },
      creator.id,
    );
    const eA2 = await makeEntry(arenaA2.id, a2.id, `${base}/agent`);
    const sA2 = await makeSubmission(eA2.id, "endpoint from entry snapshot");
    await makeJob(sA2.id);
    stats = await processAll();
    const sA2After = await db.submission.findUnique({ where: { id: sA2.id } });
    check("AUTO via entry.a2aEndpoint snapshot", stats.done === 1 && approx(sA2After?.autoScore ?? null, 100));

    // --- 3. AUTO fatal: entry without endpoint ----------------------------
    console.log("\n[3] AUTO fatal failure (no endpoint)");
    const arenaA3 = await makeArena(
      "AUTO",
      { cases: [{ input: "2+2", expected: "4", match: "exact" }] },
      creator.id,
    );
    const eA3 = await makeEntry(arenaA3.id, a3.id); // no a2aEndpoint anywhere
    const sA3 = await makeSubmission(eA3.id, "doomed submission");
    const fatalJob = await makeJob(sA3.id);
    await processAll();
    const fatalJobAfter = await db.evalJob.findUnique({ where: { id: fatalJob.id } });
    check("no-endpoint job is FAILED", fatalJobAfter?.status === "FAILED");
    check("fatal error does not retry (attempts = 1)", fatalJobAfter?.attempts === 1);
    check("lastError explains the cause", (fatalJobAfter?.lastError ?? "").includes("no endpoint"));

    // --- 4. EXTERNAL full chain -------------------------------------------
    console.log("\n[4] EXTERNAL full chain (fake judge endpoint)");
    const arenaE = await makeArena(
      "EXTERNAL",
      { judgeUrl: `${base}/judge` },
      creator.id,
    );
    const eE1 = await makeEntry(arenaE.id, a1.id);
    const sE1 = await makeSubmission(eE1.id, "judge me", { files: ["a.txt"] });
    await makeJob(sE1.id);
    stats = await processAll();

    const sE1After = await db.submission.findUnique({ where: { id: sE1.id } });
    const extMetrics = parseJson<Record<string, unknown>>(sE1After?.metrics, {});
    check("EXTERNAL job DONE", stats.done === 1);
    check("judgeScore = 87.5", approx(sE1After?.judgeScore ?? null, 87.5));
    check("feedback recorded in metrics", extMetrics.feedback === "solid work");
    check("latencyMs recorded", typeof extMetrics.latencyMs === "number");
    const judgeReq = lastJudgeRequest as {
      submissionId?: string;
      content?: string;
      artifact?: unknown;
    } | null;
    check(
      "judge received submission JSON (id/content/artifact)",
      judgeReq?.submissionId === sE1.id &&
        judgeReq.content === "judge me" &&
        JSON.stringify(judgeReq.artifact) === JSON.stringify({ files: ["a.txt"] }),
    );

    // --- 5. Worker retry ---------------------------------------------------
    console.log("\n[5] Worker retry: flaky judge exhausts attempts");
    const arenaF = await makeArena(
      "EXTERNAL",
      { judgeUrl: `${base}/judge-500`, timeoutMs: 3000 },
      creator.id,
    );
    const eF1 = await makeEntry(arenaF.id, a2.id);
    const sF1 = await makeSubmission(eF1.id, "unjudgeable");
    const flakyJob = await makeJob(sF1.id);
    stats = await processAll();
    const flakyJobAfter = await db.evalJob.findUnique({ where: { id: flakyJob.id } });
    check("flaky job ends FAILED", flakyJobAfter?.status === "FAILED");
    check(
      `retried up to MAX_EVAL_ATTEMPTS (${MAX_EVAL_ATTEMPTS})`,
      flakyJobAfter?.attempts === MAX_EVAL_ATTEMPTS,
      `attempts=${flakyJobAfter?.attempts}`,
    );
    check("lastError kept", (flakyJobAfter?.lastError ?? "").includes("HTTP 500"));
    check("queue drained: claimPendingJob() → null", (await claimPendingJob()) === null);

    // --- 6. HYBRID weighted finalScore -------------------------------------
    console.log("\n[6] HYBRID weighted synthesis");
    const arenaH = await makeArena(
      "HYBRID",
      { weights: { vote: 0.25, external: 0.75 }, external: { judgeUrl: `${base}/judge` } },
      creator.id,
    );
    const eH1 = await makeEntry(arenaH.id, a1.id);
    const eH2 = await makeEntry(arenaH.id, a2.id);
    const sH1 = await makeSubmission(eH1.id, "hybrid winner");
    const sH2 = await makeSubmission(eH2.id, "hybrid loser");
    await makeVote("u1", sH1.id);
    await makeJob(sH1.id);
    await makeJob(sH2.id);
    stats = await processAll();
    check("both HYBRID jobs DONE", stats.done === 2);

    const liveH = await computeLiveScores(arenaH.id);
    const liveH1 = liveH.find((s) => s.submissionId === sH1.id);
    const liveH2 = liveH.find((s) => s.submissionId === sH2.id);
    // 2 submissions, votes 1 vs 0 → percentiles 100 and 0
    check("HYBRID vote percentile 100 for voted sub", approx(liveH1?.voteScore ?? null, 100));
    check("HYBRID vote percentile 0 for unvoted sub", approx(liveH2?.voteScore ?? null, 0));
    check(
      "finalScore = 0.25*100 + 0.75*87.5 = 90.625",
      approx(liveH1?.finalScore ?? null, 90.625),
      liveH1?.finalScore,
    );
    check(
      "finalScore = 0.25*0 + 0.75*87.5 = 65.625",
      approx(liveH2?.finalScore ?? null, 65.625),
      liveH2?.finalScore,
    );
    const sH1After = await db.submission.findUnique({ where: { id: sH1.id } });
    check("HYBRID stored judgeScore sub-score", approx(sH1After?.judgeScore ?? null, 87.5));
    check(
      "HYBRID stored voteScore sub-score",
      approx(sH1After?.voteScore ?? null, 100),
      sH1After?.voteScore,
    );

    // synthesizeFinalScore unit checks
    check(
      "synthesize: missing component counts as 0, weight kept",
      approx(
        synthesizeFinalScore("HYBRID", { vote: 0.5, auto: 0.5 }, { voteScore: 80, autoScore: null, judgeScore: null }),
        40,
      ),
    );
    check(
      "synthesize: no scores at all → null",
      synthesizeFinalScore("HYBRID", { vote: 1 }, { voteScore: null, autoScore: null, judgeScore: null }) === null,
    );
    check(
      "synthesize: DUEL → null (settled elsewhere)",
      synthesizeFinalScore("DUEL", {}, { voteScore: 1, autoScore: 1, judgeScore: 1 }) === null,
    );

    // --- 7. closeArena ------------------------------------------------------
    console.log("\n[7] closeArena settlement");
    // permission: non-creator cannot close
    let forbidden = false;
    try {
      await closeArena(arenaH.id, { type: "agent", id: a1.id, name: "intruder" });
    } catch (error) {
      forbidden = error instanceof ForbiddenError;
    }
    check("non-creator close → ForbiddenError", forbidden);

    const campBefore = await db.camp.findUnique({ where: { id: camp.id } });
    const resultH = await closeArena(arenaH.id, { type: "agent", id: creator.id, name: "creator" });
    const arenaHAfter = await db.arena.findUnique({ where: { id: arenaH.id } });
    const sH1Frozen = await db.submission.findUnique({ where: { id: sH1.id } });
    const campAfterH = await db.camp.findUnique({ where: { id: camp.id } });
    check("HYBRID arena is CLOSED", arenaHAfter?.status === "CLOSED");
    check("finalScore frozen at 90.625", approx(sH1Frozen?.finalScore ?? null, 90.625));
    check("champion = entry with best finalScore", resultH.championEntryId === eH1.id);
    check(
      "champion's camp winCount +1",
      (campAfterH?.winCount ?? 0) === (campBefore?.winCount ?? 0) + 1,
    );
    const notifsH = await db.notification.findMany({
      where: { type: "arena_closed", recipientId: { in: [a1.id, a2.id] } },
    });
    const notifWinner = notifsH.find((n) => n.recipientId === a1.id);
    const notifLoser = notifsH.find((n) => n.recipientId === a2.id);
    check("one arena_closed notification per entered agent", notifsH.length === 2);
    check(
      "winner payload { arenaId, won: true }",
      parseJson<{ arenaId?: string; won?: boolean }>(notifWinner?.payload, {}).won === true &&
        parseJson<{ arenaId?: string }>(notifWinner?.payload, {}).arenaId === arenaH.id,
    );
    check(
      "loser payload won: false",
      parseJson<{ won?: boolean }>(notifLoser?.payload, {}).won === false,
    );

    // VOTE arena: champion decided by vote count, not finalScore
    const resultV = await closeArena(arenaV.id, { type: "agent", id: creator.id, name: "creator" });
    const sV3Frozen = await db.submission.findUnique({ where: { id: sV3.id } });
    const campAfterV = await db.camp.findUnique({ where: { id: camp.id } });
    check("VOTE arena champion = most-voted entry", resultV.championEntryId === eV3.id);
    check("VOTE arena finalScore frozen = vote percentile", approx(sV3Frozen?.finalScore ?? null, 100));
    check(
      "camp winCount incremented again (champion a3 in same camp)",
      (campAfterV?.winCount ?? 0) === (campBefore?.winCount ?? 0) + 2,
    );

    // closing twice → ArenaStateError; DUEL rejected
    let twice = false;
    try {
      await closeArena(arenaH.id, { type: "agent", id: creator.id, name: "creator" });
    } catch (error) {
      twice = error instanceof ArenaStateError;
    }
    check("closing a CLOSED arena → ArenaStateError", twice);

    const arenaD = await makeArena("DUEL", {}, creator.id);
    let duel = false;
    try {
      await closeArena(arenaD.id, { type: "agent", id: creator.id, name: "creator" });
    } catch (error) {
      duel = error instanceof ArenaStateError;
    }
    check("DUEL arena rejected by closeArena", duel);
  } finally {
    // --- cleanup ------------------------------------------------------------
    console.log("\ncleaning up temporary rows...");
    await db.vote.deleteMany({ where: { id: { in: created.votes } } });
    await db.evalJob.deleteMany({ where: { id: { in: created.jobs } } });
    await db.notification.deleteMany({
      where: { recipientType: "agent", recipientId: { in: created.agents }, type: "arena_closed" },
    });
    await db.submission.deleteMany({ where: { id: { in: created.submissions } } });
    await db.entry.deleteMany({ where: { id: { in: created.entries } } });
    await db.arena.deleteMany({ where: { id: { in: created.arenas } } });
    await db.agent.deleteMany({ where: { id: { in: created.agents } } });
    await db.camp.deleteMany({ where: { id: { in: created.camps } } });
    // restore parked pre-existing jobs
    for (const job of parked) {
      await db.evalJob.update({
        where: { id: job.id },
        data: { status: job.status, attempts: job.attempts, lastError: job.lastError },
      });
    }
    await db.$disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main().catch((error) => {
  console.error("smoke run crashed:", error);
  process.exit(1);
});
