/**
 * Arena participation service layer: entries (报名), submissions (作品) and
 * votes (投票). Split from `arena.ts` (lifecycle + governance + queries) so the
 * Web UI server actions and `/api/v1` handlers can share both halves.
 */

import { z } from "zod";

import { type Actor, ForbiddenError } from "~/server/actor";
import { HttpError } from "~/server/api";
import { assertCan } from "~/server/authz";
import { db } from "~/server/db";
import { computeLiveScores } from "~/server/eval/score";
import { parseJson } from "~/server/eval/types";
import { getArenaOrThrow, type PageArgs } from "~/server/services/arena";

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export const enterArenaSchema = z.object({
  /** Required for user actors (must own the agent); ignored/self for agent actors. */
  agentId: z.string().min(1).optional(),
});

/**
 * Enter an agent into an OPEN arena. An agent actor enters itself; a user
 * actor may only enter an agent it owns. The agent's current a2aEndpoint is
 * snapshotted onto the entry. Re-entering hits the (arenaId, agentId) unique
 * constraint and returns 409.
 */
export async function enterArena(actor: Actor, arenaId: string, input: unknown) {
  const data = enterArenaSchema.parse(input ?? {});
  const arena = await getArenaOrThrow(arenaId);
  if (arena.status !== "OPEN") {
    throw new HttpError(
      409,
      "ARENA_NOT_OPEN",
      `Arena is ${arena.status}; only OPEN arenas accept entries`,
    );
  }
  assertCan(actor, "entry.create");

  let agentId: string;
  if (actor.type === "agent") {
    if (data.agentId && data.agentId !== actor.id) {
      throw new ForbiddenError("An agent can only enter itself");
    }
    agentId = actor.id;
  } else {
    if (!data.agentId) {
      throw new HttpError(
        400,
        "AGENT_REQUIRED",
        "User actors must pass agentId of an agent they own",
      );
    }
    agentId = data.agentId;
  }

  const agent = await db.agent.findFirst({
    where: { id: agentId, deletedAt: null },
  });
  if (!agent) {
    throw new HttpError(404, "AGENT_NOT_FOUND", `Agent ${agentId} not found`);
  }
  if (
    actor.type === "user" &&
    agent.ownerId !== actor.id
  ) {
    throw new ForbiddenError("You can only enter agents you own");
  }

  const existing = await db.entry.findUnique({
    where: { arenaId_agentId: { arenaId, agentId } },
  });
  if (existing) {
    throw new HttpError(
      409,
      "ALREADY_ENTERED",
      "This agent has already entered the arena",
    );
  }

  return db.entry.create({
    data: { arenaId, agentId, a2aEndpoint: agent.a2aEndpoint },
  });
}

export async function listEntries(arenaId: string, args: PageArgs = {}) {
  await getArenaOrThrow(arenaId);
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
  const rows = await db.entry.findMany({
    where: { arenaId },
    orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
    ...(args.cursor && { cursor: { id: args.cursor }, skip: 1 }),
    take: limit + 1,
    include: {
      agent: { select: { id: true, name: true, avatar: true } },
      _count: { select: { submissions: true } },
    },
  });
  const page = rows.slice(0, limit);
  return {
    items: page,
    nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

export const createSubmissionSchema = z.object({
  content: z.string().min(1).max(100_000),
  mediaUrl: z.string().url().optional(),
  artifact: z.record(z.unknown()).optional(),
});

/**
 * Submit a work for an entry. Only the entered agent itself — or its owning
 * user — may submit. The arena must be OPEN. AUTO/EXTERNAL/HYBRID submissions
 * get a PENDING EvalJob for the eval worker; VOTE (settled by votes) and DUEL
 * (settled by matches) need none.
 */
export async function createSubmission(
  actor: Actor,
  entryId: string,
  input: unknown,
) {
  const data = createSubmissionSchema.parse(input);
  const entry = await db.entry.findUnique({
    where: { id: entryId },
    include: { arena: true, agent: { select: { id: true, ownerId: true } } },
  });
  if (!entry) {
    throw new HttpError(404, "ENTRY_NOT_FOUND", `Entry ${entryId} not found`);
  }
  assertCan(actor, "submission.create");
  const ownsEntry =
    (actor.type === "agent" && actor.id === entry.agentId) ||
    (actor.type === "user" && entry.agent.ownerId === actor.id);
  if (!ownsEntry) {
    throw new ForbiddenError(
      "Only the entered agent (or its owning user) can submit for this entry",
    );
  }
  if (entry.arena.status !== "OPEN") {
    throw new HttpError(
      409,
      "ARENA_NOT_OPEN",
      "Submissions are only accepted while the arena is OPEN",
    );
  }
  const needsEvalJob =
    entry.arena.evalMode !== "VOTE" && entry.arena.evalMode !== "DUEL";
  return db.submission.create({
    data: {
      entryId,
      content: data.content,
      mediaUrl: data.mediaUrl ?? null,
      artifact: data.artifact ? JSON.stringify(data.artifact) : null,
      ...(needsEvalJob && { evalJobs: { create: {} } }),
    },
  });
}

/**
 * List an arena's submissions with read-time synthesized scores
 * (docs/PLAN.md 架构评审调整 #3): voteCount comes from the Vote table and
 * finalScore from `computeLiveScores()` — except on CLOSED arenas, where the
 * frozen `Submission.finalScore` is authoritative.
 */
export async function listSubmissions(arenaId: string, args: PageArgs = {}) {
  const arena = await getArenaOrThrow(arenaId);
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
  const rows = await db.submission.findMany({
    where: { entry: { arenaId } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    ...(args.cursor && { cursor: { id: args.cursor }, skip: 1 }),
    take: limit + 1,
    include: {
      entry: {
        include: {
          agent: { select: { id: true, name: true, avatar: true } },
        },
      },
      _count: { select: { votes: true } },
    },
  });
  const live = new Map(
    (await computeLiveScores(arenaId)).map((s) => [s.submissionId, s]),
  );
  const page = rows.slice(0, limit).map((s) => {
    const liveScore = live.get(s.id);
    return {
      ...s,
      artifact: parseJson<Record<string, unknown> | null>(s.artifact, null),
      metrics: parseJson<Record<string, unknown> | null>(s.metrics, null),
      voteCount: s._count.votes,
      finalScore:
        arena.status === "CLOSED" && s.finalScore !== null
          ? s.finalScore
          : (liveScore?.finalScore ?? null),
    };
  });
  return {
    items: page,
    nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// Votes
// ---------------------------------------------------------------------------

/**
 * Cast (or re-cast — upsert) a vote on a submission. The arena must be OPEN
 * and actors cannot vote for their own entry's work (authz `vote.cast`).
 */
export async function castVote(actor: Actor, submissionId: string) {
  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    include: { entry: { include: { arena: true } } },
  });
  if (!submission) {
    throw new HttpError(
      404,
      "SUBMISSION_NOT_FOUND",
      `Submission ${submissionId} not found`,
    );
  }
  if (submission.entry.arena.status !== "OPEN") {
    throw new HttpError(
      409,
      "ARENA_NOT_OPEN",
      "Votes are only accepted while the arena is OPEN",
    );
  }
  assertCan(actor, "vote.cast", {
    owner: { type: "agent", id: submission.entry.agentId },
  });
  return db.vote.upsert({
    where: {
      voterType_voterId_submissionId: {
        voterType: actor.type,
        voterId: actor.id,
        submissionId,
      },
    },
    create: { voterType: actor.type, voterId: actor.id, submissionId },
    update: {},
  });
}
