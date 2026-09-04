/**
 * Arena (议题) domain smoke test — run with: pnpm tsx scripts/arena-smoke.ts
 *
 * Exercises the service layer (src/server/services/arena*.ts) end to end
 * against the real dev SQLite (DATABASE_URL from .env):
 *
 *   Part 1 (VOTE arena): create (writes standard v1) → update → collaborator
 *     apply/approve → delegate publishes v2 → proposal → review(merge) → v3 →
 *     open → enter (agent self + owner user; 403/409 guards) → submit (VOTE
 *     creates no EvalJob) → vote (self-vote 403, re-vote stays one vote) →
 *     closeArenaApi settles: CLOSED, champion by votes, Camp.winCount +1,
 *     notifications, finalScore frozen.
 *
 *   Part 2 (DUEL arena): closeArenaApi rejects with DUEL_SETTLEMENT_REQUIRED;
 *     settleDuelArena rejects while a match is QUEUED, then settles once all
 *     matches are DONE/CANCELLED — champion by match wins, camp credited again.
 *
 * All rows are cleaned up afterwards.
 */

import assert from "node:assert/strict";

// Loads .env + defaults DATABASE_URL before any ~/ import (see scripts/load-env.ts).
import "./load-env";

import { ForbiddenError, type Actor } from "~/server/actor";
import { HttpError } from "~/server/api";
import { db } from "~/server/db";
import {
  applyCollaborator,
  closeArenaApi,
  createArena,
  getArenaDetail,
  listArenas,
  openArena,
  publishStandard,
  reviewCollaborator,
  reviewProposal,
  settleDuelArena,
  submitProposal,
  updateArena,
} from "~/server/services/arena";
import {
  castVote,
  createSubmission,
  enterArena,
  listSubmissions,
} from "~/server/services/arena-participation";

function isHttp(status: number, code: string) {
  return (e: unknown) =>
    e instanceof HttpError && e.status === status && e.code === code;
}

const suffix = Date.now().toString(36);

const camp = await db.camp.create({
  data: {
    name: `arena-smoke-camp-${suffix}`,
    color: "#ff0055",
    createdByType: "user",
    createdById: "arena-smoke",
  },
});
const userA = await db.user.create({ data: { name: `arena-smoke-userA-${suffix}` } });
const userB = await db.user.create({ data: { name: `arena-smoke-userB-${suffix}` } });
const agent1 = await db.agent.create({
  data: {
    name: `arena-smoke-agent1-${suffix}`,
    agentCard: "{}",
    apiKeyHash: `arena-smoke-${suffix}-1`,
    ownerId: userA.id,
    campId: camp.id,
    a2aEndpoint: "https://agent1.example.com/a2a",
  },
});
const agent2 = await db.agent.create({
  data: {
    name: `arena-smoke-agent2-${suffix}`,
    agentCard: "{}",
    apiKeyHash: `arena-smoke-${suffix}-2`,
    a2aEndpoint: "https://agent2.example.com/a2a",
  },
});

const creator: Actor = { type: "user", id: userA.id, name: userA.name };
const voter: Actor = { type: "user", id: userB.id, name: userB.name };
const agentActor: Actor = { type: "agent", id: agent2.id, name: agent2.name };

const arenaIds: string[] = [];

try {
  // --- Part 1: VOTE arena -------------------------------------------------

  await assert.rejects(
    createArena(creator, {
      title: "bad",
      description: "bad",
      evalMode: "AUTO",
      evalConfig: {},
      initialStandard: "rules",
    }),
    isHttp(400, "INVALID_EVAL_CONFIG"),
    "AUTO without cases must fail evalConfig validation",
  );

  const arena = await createArena(creator, {
    title: `Smoke Arena ${suffix}`,
    description: "vote arena",
    evalMode: "VOTE",
    initialStandard: "Rules v1",
  });
  arenaIds.push(arena.id);
  assert.equal(arena.status, "DRAFT");
  const v1 = await db.arenaStandard.findUnique({
    where: { arenaId_version: { arenaId: arena.id, version: 1 } },
  });
  assert.equal(v1?.content, "Rules v1", "createArena writes standard v1");

  await updateArena(creator, arena.id, { title: `Smoke Arena ${suffix} (renamed)` });
  await assert.rejects(
    updateArena(agentActor, arena.id, { title: "hijack" }),
    (e: unknown) => e instanceof ForbiddenError,
    "non-creator cannot edit",
  );

  await applyCollaborator(agentActor, arena.id);
  await assert.rejects(
    applyCollaborator(agentActor, arena.id),
    isHttp(409, "ALREADY_APPLIED"),
  );
  const collab = await reviewCollaborator(creator, arena.id, "agent", agent2.id, true);
  assert.equal(collab?.status, "APPROVED");

  // APPROVED collaborator may publish standards (authz delegate rule).
  const v2 = await publishStandard(agentActor, arena.id, { content: "Rules v2" });
  assert.equal(v2.version, 2);

  const proposal = await submitProposal(voter, arena.id, {
    content: "Rules v3",
    rationale: "tighter judging",
  });
  assert.equal(proposal.status, "PENDING");
  const reviewed = await reviewProposal(creator, proposal.id, { approve: true });
  assert.equal(reviewed.proposal.status, "MERGED");
  assert.equal(reviewed.standard?.version, 3, "merge publishes a new version");
  assert.equal(reviewed.standard?.content, "Rules v3");
  await assert.rejects(
    reviewProposal(creator, proposal.id, { approve: true }),
    isHttp(409, "PROPOSAL_ALREADY_REVIEWED"),
  );

  await openArena(creator, arena.id);
  await assert.rejects(openArena(creator, arena.id), isHttp(409, "ARENA_STATE"));
  await assert.rejects(
    updateArena(creator, arena.id, { evalMode: "AUTO", evalConfig: { cases: [{ input: "a", expected: "a", match: "exact" }] } }),
    isHttp(409, "ARENA_NOT_DRAFT"),
    "evalMode is frozen once the arena leaves DRAFT",
  );

  const entryA = await enterArena(agentActor, arena.id, {});
  assert.equal(entryA.agentId, agent2.id);
  assert.equal(entryA.a2aEndpoint, agent2.a2aEndpoint, "endpoint snapshot");
  const entryB = await enterArena(creator, arena.id, { agentId: agent1.id });
  assert.equal(entryB.agentId, agent1.id);
  await assert.rejects(
    enterArena(creator, arena.id, { agentId: agent2.id }),
    (e: unknown) => e instanceof ForbiddenError,
    "users can only enter their own agents",
  );
  await assert.rejects(
    enterArena(agentActor, arena.id, {}),
    isHttp(409, "ALREADY_ENTERED"),
  );

  const subA = await createSubmission(agentActor, entryA.id, { content: "answer A" });
  const subB = await createSubmission(creator, entryB.id, { content: "answer B" });
  await assert.rejects(
    createSubmission(voter, entryA.id, { content: "intruder" }),
    (e: unknown) => e instanceof ForbiddenError,
  );
  const evalJobs = await db.evalJob.count({
    where: { submissionId: { in: [subA.id, subB.id] } },
  });
  assert.equal(evalJobs, 0, "VOTE arenas need no EvalJob");

  await castVote(creator, subA.id); // A: 1
  await castVote(voter, subB.id); //   B: 1
  await castVote(agentActor, subB.id); // B: 2 (agent votes other's work)
  await castVote(creator, subA.id); // re-vote: still one vote
  await assert.rejects(
    castVote(agentActor, subA.id),
    (e: unknown) => e instanceof ForbiddenError,
    "cannot vote for one's own entry",
  );
  assert.equal(await db.vote.count({ where: { submissionId: subA.id } }), 1);
  assert.equal(await db.vote.count({ where: { submissionId: subB.id } }), 2);

  const detail = await getArenaDetail(arena.id);
  assert.equal(detail.effectiveStandard?.version, 3);
  assert.equal(detail.proposalCount, 1);
  assert.equal(detail.entries.length, 2);
  assert.equal(detail.creator?.name, userA.name);

  const subs = await listSubmissions(arena.id, {});
  const liveB = subs.items.find((s) => s.id === subB.id);
  assert.equal(liveB?.voteCount, 2);
  assert.equal(liveB?.finalScore, 100, "most-voted submission scores 100 read-time");

  const closeResult = await closeArenaApi(creator, arena.id);
  assert.equal(closeResult.championEntryId, entryB.id, "champion = most votes");
  assert.equal(closeResult.championAgentId, agent1.id);

  const campAfter = await db.camp.findUniqueOrThrow({ where: { id: camp.id } });
  assert.equal(campAfter.winCount, 1, "champion's camp gets winCount +1");
  const closedArena = await db.arena.findUniqueOrThrow({ where: { id: arena.id } });
  assert.equal(closedArena.status, "CLOSED");
  const frozenB = await db.submission.findUniqueOrThrow({ where: { id: subB.id } });
  assert.equal(frozenB.finalScore, 100, "finalScore frozen on close");
  const notifications = await db.notification.count({
    where: { type: "arena_closed", recipientId: { in: [agent1.id, agent2.id] } },
  });
  assert.equal(notifications, 2, "both entered agents notified");

  const listing = await listArenas({ status: "CLOSED", limit: 5 });
  assert.ok(Array.isArray(listing.items));
  assert.ok(
    listing.items.some((a) => a.id === arena.id),
    "listArenas finds the closed arena",
  );
  console.log("Part 1 OK: VOTE arena full lifecycle, settlement, camp credit");

  // --- Part 2: DUEL arena -------------------------------------------------

  const duelArena = await createArena(creator, {
    title: `Smoke Duel Arena ${suffix}`,
    description: "duel arena",
    evalMode: "DUEL",
    initialStandard: "fight rules",
  });
  arenaIds.push(duelArena.id);
  await openArena(creator, duelArena.id);
  const dEntry1 = await enterArena(creator, duelArena.id, { agentId: agent1.id });
  const dEntry2 = await enterArena(agentActor, duelArena.id, {});

  await assert.rejects(
    closeArenaApi(creator, duelArena.id),
    isHttp(409, "DUEL_SETTLEMENT_REQUIRED"),
    "closeArena must refuse DUEL arenas",
  );

  const match = await db.duelMatch.create({
    data: {
      arenaId: duelArena.id,
      agentAId: agent1.id,
      agentBId: agent2.id,
      entryAId: dEntry1.id,
      entryBId: dEntry2.id,
      status: "QUEUED",
      seed: 1,
    },
  });
  await assert.rejects(
    settleDuelArena(creator, duelArena.id),
    isHttp(409, "MATCHES_PENDING"),
    "cannot settle while matches are unfinished",
  );

  await db.duelMatch.update({
    where: { id: match.id },
    data: {
      status: "DONE",
      winnerAgentId: agent1.id,
      roundWinsA: 2,
      roundWinsB: 1,
      finishedAt: new Date(),
    },
  });
  const duelResult = await settleDuelArena(creator, duelArena.id);
  assert.equal(duelResult.championEntryId, dEntry1.id);
  assert.equal(duelResult.championAgentId, agent1.id);
  assert.equal(duelResult.matchesCounted, 1);

  const campFinal = await db.camp.findUniqueOrThrow({ where: { id: camp.id } });
  assert.equal(campFinal.winCount, 2, "DUEL champion's camp also gets +1");
  const duelClosed = await db.arena.findUniqueOrThrow({ where: { id: duelArena.id } });
  assert.equal(duelClosed.status, "CLOSED");
  console.log("Part 2 OK: DUEL settlement via settleDuelArena (match wins)");

  console.log("arena-smoke: ALL GREEN");
} finally {
  await db.notification.deleteMany({
    where: { type: "arena_closed", recipientId: { in: [agent1.id, agent2.id] } },
  });
  for (const arenaId of arenaIds) {
    await db.duelMatch.deleteMany({ where: { arenaId } });
    // Arena delete cascades: standards, proposals, collaborators, entries
    // (→ submissions → votes / evalJobs).
    await db.arena.deleteMany({ where: { id: arenaId } });
  }
  await db.agent.deleteMany({ where: { id: { in: [agent1.id, agent2.id] } } });
  await db.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  await db.camp.deleteMany({ where: { id: camp.id } });
  await db.$disconnect();
}
