/**
 * Arena (议题) domain service layer (docs/PLAN.md 议题模块 / 标准 / 提案 / 协作者).
 *
 * Deliberately separated from the HTTP layer: `/api/v1` route handlers and
 * future Web UI server actions both call these functions. Permission checks
 * go through `assertCan()` (src/server/authz.ts) — humans and agents share
 * the exact same rules. Domain failures raise `HttpError` (404/409/400) or
 * `ForbiddenError`, which `mapApiError()` renders as `{error:{code,message}}`.
 *
 * Participation (entries / submissions / votes) lives in
 * `arena-participation.ts`; settlement of non-DUEL arenas is in
 * `src/server/eval/settle.ts` and only wrapped here.
 */

import { z } from "zod";

import { type Actor, isSameActor } from "~/server/actor";
import { HttpError } from "~/server/api";
import {
  assertCan,
  getArenaCollaboratorRefs,
  type ActorRef,
} from "~/server/authz";
import { db } from "~/server/db";
import {
  ArenaStateError,
  closeArena,
  type CloseArenaResult,
} from "~/server/eval/settle";
import {
  evalConfigSchemas,
  FatalEvalError,
  parseEvalConfig,
  parseJson,
} from "~/server/eval/types";
import { EVAL_MODES, type EvalMode } from "~/lib/constants";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export async function getArenaOrThrow(arenaId: string) {
  const arena = await db.arena.findUnique({ where: { id: arenaId } });
  if (!arena) {
    throw new HttpError(404, "ARENA_NOT_FOUND", `Arena ${arenaId} not found`);
  }
  return arena;
}

function creatorRef(arena: {
  creatorType: string;
  creatorId: string;
}): ActorRef {
  return { type: arena.creatorType, id: arena.creatorId };
}

/** Validate an evalConfig object against the schema of its evalMode; returns the serialized (defaults-applied) config. */
function validateEvalConfig(
  evalMode: string,
  config: Record<string, unknown>,
): string {
  const schema = evalConfigSchemas[evalMode as EvalMode];
  if (!schema) {
    throw new HttpError(400, "INVALID_EVAL_MODE", `Unknown evalMode ${evalMode}`);
  }
  try {
    const parsed = parseEvalConfig(schema, JSON.stringify(config), "(unsaved)");
    return JSON.stringify(parsed);
  } catch (error) {
    if (error instanceof FatalEvalError) {
      throw new HttpError(400, "INVALID_EVAL_CONFIG", error.message);
    }
    throw error;
  }
}

function serializeArena<T extends { evalConfig: string }>(arena: T) {
  return {
    ...arena,
    evalConfig: parseJson<Record<string, unknown>>(arena.evalConfig, {}),
  };
}

/** Resolve a polymorphic Actor ref to a display-ready object (null when deleted/unknown). */
export async function resolveActorRef(type: string, id: string) {
  if (type === "user") {
    const user = await db.user.findUnique({
      where: { id },
      select: { id: true, name: true, avatar: true },
    });
    return user ? { type: "user" as const, ...user } : null;
  }
  const agent = await db.agent.findUnique({
    where: { id },
    select: { id: true, name: true, avatar: true },
  });
  return agent ? { type: "agent" as const, ...agent } : null;
}

// ---------------------------------------------------------------------------
// create / update / state transitions
// ---------------------------------------------------------------------------

export const createArenaSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(20_000),
  campId: z.string().min(1).optional(),
  deadline: z.coerce.date().optional(),
  evalMode: z.enum(EVAL_MODES),
  evalConfig: z.record(z.unknown()).optional(),
  /** Content of the v1 standard, published automatically at creation. */
  initialStandard: z.string().trim().min(1).max(50_000),
});
export type CreateArenaInput = z.infer<typeof createArenaSchema>;

export async function createArena(actor: Actor, input: unknown) {
  const data = createArenaSchema.parse(input);
  assertCan(actor, "arena.create");
  if (data.campId) {
    const camp = await db.camp.findUnique({ where: { id: data.campId } });
    if (!camp) {
      throw new HttpError(404, "CAMP_NOT_FOUND", `Camp ${data.campId} not found`);
    }
  }
  const evalConfig = validateEvalConfig(data.evalMode, data.evalConfig ?? {});
  return db.arena.create({
    data: {
      creatorType: actor.type,
      creatorId: actor.id,
      campId: data.campId ?? null,
      title: data.title,
      description: data.description,
      deadline: data.deadline ?? null,
      evalMode: data.evalMode,
      evalConfig,
      status: "DRAFT",
      standards: {
        create: {
          version: 1,
          content: data.initialStandard,
          editedByType: actor.type,
          editedById: actor.id,
          note: "Initial standard",
        },
      },
    },
  });
}

export const updateArenaSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(20_000).optional(),
  /** Pass null to detach the arena from its camp. */
  campId: z.string().min(1).nullable().optional(),
  deadline: z.coerce.date().nullable().optional(),
  evalMode: z.enum(EVAL_MODES).optional(),
  evalConfig: z.record(z.unknown()).optional(),
});
export type UpdateArenaInput = z.infer<typeof updateArenaSchema>;

export async function updateArena(actor: Actor, arenaId: string, patch: unknown) {
  const data = updateArenaSchema.parse(patch);
  const arena = await getArenaOrThrow(arenaId);
  assertCan(actor, "arena.edit", { owner: creatorRef(arena) });
  if (arena.status === "CLOSED") {
    throw new HttpError(409, "ARENA_CLOSED", "CLOSED arenas cannot be edited");
  }
  const touchesEval =
    data.evalMode !== undefined || data.evalConfig !== undefined;
  if (touchesEval && arena.status !== "DRAFT") {
    throw new HttpError(
      409,
      "ARENA_NOT_DRAFT",
      "evalMode/evalConfig can only be changed while the arena is DRAFT",
    );
  }
  if (data.campId) {
    const camp = await db.camp.findUnique({ where: { id: data.campId } });
    if (!camp) {
      throw new HttpError(404, "CAMP_NOT_FOUND", `Camp ${data.campId} not found`);
    }
  }
  const evalConfig = touchesEval
    ? validateEvalConfig(
        data.evalMode ?? arena.evalMode,
        data.evalConfig ??
          parseJson<Record<string, unknown>>(arena.evalConfig, {}),
      )
    : undefined;
  return db.arena.update({
    where: { id: arenaId },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.campId !== undefined && { campId: data.campId }),
      ...(data.deadline !== undefined && { deadline: data.deadline }),
      ...(data.evalMode !== undefined && { evalMode: data.evalMode }),
      ...(evalConfig !== undefined && { evalConfig }),
    },
  });
}

/** DRAFT -> OPEN. Creator only (authz `arena.open`). */
export async function openArena(actor: Actor, arenaId: string) {
  const arena = await getArenaOrThrow(arenaId);
  assertCan(actor, "arena.open", { owner: creatorRef(arena) });
  if (arena.status !== "DRAFT") {
    throw new HttpError(
      409,
      "ARENA_STATE",
      `Arena is ${arena.status}; only DRAFT arenas can be opened`,
    );
  }
  return db.arena.update({ where: { id: arenaId }, data: { status: "OPEN" } });
}

/**
 * OPEN -> CLOSED with full settlement (score freeze, champion, camp credit,
 * notifications) via src/server/eval/settle.ts. DUEL arenas are rejected here
 * and must go through `settleDuelArena()`.
 */
export async function closeArenaApi(
  actor: Actor,
  arenaId: string,
): Promise<CloseArenaResult> {
  const arena = await getArenaOrThrow(arenaId);
  if (arena.evalMode === "DUEL") {
    throw new HttpError(
      409,
      "DUEL_SETTLEMENT_REQUIRED",
      "DUEL arenas are settled from match results: finish all matches, then call settleDuelArena()",
    );
  }
  try {
    return await closeArena(arenaId, actor);
  } catch (error) {
    if (error instanceof ArenaStateError) {
      throw new HttpError(409, "ARENA_STATE", error.message);
    }
    throw error;
  }
}

export interface SettleDuelResult {
  arenaId: string;
  championEntryId: string | null;
  championAgentId: string | null;
  matchesCounted: number;
}

/**
 * Settle a DUEL arena (docs/PLAN.md 实时对决模块: 「DUEL 议题结算按 match 胜场排名,
 * 冠军阵营记阵营胜场」).
 *
 * Requires every DuelMatch of the arena to be DONE or CANCELLED. The champion
 * entry is the one with the most match wins; ties break on net round wins
 * (净胜局), then earliest entry. Draws and CANCELLED matches count toward no
 * one. The champion agent's current camp gets winCount+1, every entered agent
 * is notified, and the arena is set to CLOSED.
 */
export async function settleDuelArena(
  actor: Actor,
  arenaId: string,
): Promise<SettleDuelResult> {
  const arena = await getArenaOrThrow(arenaId);
  if (arena.evalMode !== "DUEL") {
    throw new HttpError(
      409,
      "NOT_DUEL_ARENA",
      `Arena ${arenaId} is ${arena.evalMode}; settleDuelArena only handles DUEL arenas`,
    );
  }
  assertCan(actor, "arena.close", { owner: creatorRef(arena) });
  if (arena.status !== "OPEN") {
    throw new HttpError(
      409,
      "ARENA_STATE",
      `Arena is ${arena.status}; only OPEN arenas can be settled`,
    );
  }

  const matches = await db.duelMatch.findMany({ where: { arenaId } });
  const unfinished = matches.filter(
    (m) => m.status === "QUEUED" || m.status === "RUNNING",
  );
  if (unfinished.length > 0) {
    throw new HttpError(
      409,
      "MATCHES_PENDING",
      `${unfinished.length} duel match(es) still QUEUED/RUNNING; settle after all matches finish`,
    );
  }

  const entries = await db.entry.findMany({
    where: { arenaId },
    include: { agent: { select: { id: true, campId: true } } },
  });

  const stats = new Map<string, { wins: number; netRounds: number }>();
  const bump = (entryId: string, wins: number, netRounds: number) => {
    const s = stats.get(entryId) ?? { wins: 0, netRounds: 0 };
    s.wins += wins;
    s.netRounds += netRounds;
    stats.set(entryId, s);
  };
  let matchesCounted = 0;
  for (const m of matches) {
    if (m.status !== "DONE" || !m.entryAId || !m.entryBId) continue;
    matchesCounted++;
    bump(m.entryAId, 0, m.roundWinsA - m.roundWinsB);
    bump(m.entryBId, 0, m.roundWinsB - m.roundWinsA);
    const winnerEntryId =
      m.winnerAgentId === m.agentAId
        ? m.entryAId
        : m.winnerAgentId === m.agentBId
          ? m.entryBId
          : null;
    if (winnerEntryId) bump(winnerEntryId, 1, 0);
  }

  const ranked = entries
    .map((entry) => ({
      entry,
      s: stats.get(entry.id) ?? { wins: 0, netRounds: 0 },
    }))
    .filter((x) => x.s.wins > 0)
    .sort(
      (a, b) =>
        b.s.wins - a.s.wins ||
        b.s.netRounds - a.s.netRounds ||
        a.entry.joinedAt.getTime() - b.entry.joinedAt.getTime(),
    );
  const champion = ranked[0]?.entry ?? null;

  await db.$transaction([
    db.arena.update({ where: { id: arenaId }, data: { status: "CLOSED" } }),
    ...(champion?.agent.campId
      ? [
          db.camp.update({
            where: { id: champion.agent.campId },
            data: { winCount: { increment: 1 } },
          }),
        ]
      : []),
    ...entries.map((entry) =>
      db.notification.create({
        data: {
          recipientType: "agent",
          recipientId: entry.agentId,
          type: "arena_closed",
          payload: JSON.stringify({ arenaId, won: entry.id === champion?.id }),
        },
      }),
    ),
  ]);

  return {
    arenaId,
    championEntryId: champion?.id ?? null,
    championAgentId: champion?.agent.id ?? null,
    matchesCounted,
  };
}

// ---------------------------------------------------------------------------
// Standards & proposals
// ---------------------------------------------------------------------------

export const publishStandardSchema = z.object({
  content: z.string().trim().min(1).max(50_000),
  note: z.string().trim().max(500).optional(),
});

/** Publish a new standard version (version = max+1). Creator or APPROVED collaborator. */
export async function publishStandard(
  actor: Actor,
  arenaId: string,
  input: unknown,
) {
  const data = publishStandardSchema.parse(input);
  const arena = await getArenaOrThrow(arenaId);
  assertCan(actor, "arena.publishStandard", {
    owner: creatorRef(arena),
    delegates: await getArenaCollaboratorRefs(arenaId),
  });
  const { _max } = await db.arenaStandard.aggregate({
    where: { arenaId },
    _max: { version: true },
  });
  return db.arenaStandard.create({
    data: {
      arenaId,
      version: (_max.version ?? 0) + 1,
      content: data.content,
      editedByType: actor.type,
      editedById: actor.id,
      note: data.note ?? null,
    },
  });
}

export const submitProposalSchema = z.object({
  content: z.string().trim().min(1).max(50_000),
  rationale: z.string().trim().max(2_000).optional(),
});

/** Any actor may propose a standard change; starts PENDING. */
export async function submitProposal(
  actor: Actor,
  arenaId: string,
  input: unknown,
) {
  const data = submitProposalSchema.parse(input);
  await getArenaOrThrow(arenaId);
  assertCan(actor, "proposal.create");
  return db.standardProposal.create({
    data: {
      arenaId,
      authorType: actor.type,
      authorId: actor.id,
      content: data.content,
      rationale: data.rationale ?? null,
    },
  });
}

export const reviewProposalSchema = z.object({
  approve: z.boolean(),
  reviewNote: z.string().trim().max(2_000).optional(),
});

/**
 * Review a PENDING proposal (creator or APPROVED collaborator). Approving
 * marks it MERGED and publishes its content as the next standard version in
 * the same transaction.
 */
export async function reviewProposal(
  actor: Actor,
  proposalId: string,
  input: unknown,
) {
  const data = reviewProposalSchema.parse(input);
  const proposal = await db.standardProposal.findUnique({
    where: { id: proposalId },
  });
  if (!proposal) {
    throw new HttpError(
      404,
      "PROPOSAL_NOT_FOUND",
      `Proposal ${proposalId} not found`,
    );
  }
  const arena = await getArenaOrThrow(proposal.arenaId);
  assertCan(actor, "arena.reviewProposal", {
    owner: creatorRef(arena),
    delegates: await getArenaCollaboratorRefs(arena.id),
  });
  if (proposal.status !== "PENDING") {
    throw new HttpError(
      409,
      "PROPOSAL_ALREADY_REVIEWED",
      `Proposal is already ${proposal.status}`,
    );
  }

  if (!data.approve) {
    const rejected = await db.standardProposal.update({
      where: { id: proposalId },
      data: { status: "REJECTED", reviewNote: data.reviewNote ?? null },
    });
    return { proposal: rejected, standard: null };
  }

  const { _max } = await db.arenaStandard.aggregate({
    where: { arenaId: arena.id },
    _max: { version: true },
  });
  const [merged, standard] = await db.$transaction([
    db.standardProposal.update({
      where: { id: proposalId },
      data: { status: "MERGED", reviewNote: data.reviewNote ?? null },
    }),
    db.arenaStandard.create({
      data: {
        arenaId: arena.id,
        version: (_max.version ?? 0) + 1,
        content: proposal.content,
        editedByType: actor.type,
        editedById: actor.id,
        note: data.reviewNote ?? `Merged proposal ${proposalId}`,
      },
    }),
  ]);
  return { proposal: merged, standard };
}

// ---------------------------------------------------------------------------
// Collaborators
// ---------------------------------------------------------------------------

/** Apply to become a collaborator of an arena (any actor except the creator). */
export async function applyCollaborator(actor: Actor, arenaId: string) {
  const arena = await getArenaOrThrow(arenaId);
  assertCan(actor, "collaborator.apply");
  if (isSameActor(actor, creatorRef(arena))) {
    throw new HttpError(
      409,
      "ALREADY_CREATOR",
      "The arena creator already has full rights",
    );
  }
  const existing = await db.arenaCollaborator.findUnique({
    where: {
      arenaId_applicantType_applicantId: {
        arenaId,
        applicantType: actor.type,
        applicantId: actor.id,
      },
    },
  });
  if (existing) {
    throw new HttpError(
      409,
      existing.status === "APPROVED" ? "ALREADY_COLLABORATOR" : "ALREADY_APPLIED",
      `Application already ${existing.status}`,
    );
  }
  return db.arenaCollaborator.create({
    data: { arenaId, applicantType: actor.type, applicantId: actor.id },
  });
}

/**
 * Approve or reject a PENDING collaborator application (creator or APPROVED
 * collaborator). The schema has no REJECTED status, so rejecting deletes the
 * application row. Returns the updated row, or null when rejected.
 */
export async function reviewCollaborator(
  actor: Actor,
  arenaId: string,
  applicantType: string,
  applicantId: string,
  approve: boolean,
) {
  const arena = await getArenaOrThrow(arenaId);
  assertCan(actor, "arena.manageCollaborators", {
    owner: creatorRef(arena),
    delegates: await getArenaCollaboratorRefs(arenaId),
  });
  const row = await db.arenaCollaborator.findUnique({
    where: {
      arenaId_applicantType_applicantId: { arenaId, applicantType, applicantId },
    },
  });
  if (!row) {
    throw new HttpError(404, "APPLICATION_NOT_FOUND", "No such application");
  }
  if (row.status !== "PENDING") {
    throw new HttpError(
      409,
      "APPLICATION_ALREADY_REVIEWED",
      `Application is already ${row.status}`,
    );
  }
  if (!approve) {
    await db.arenaCollaborator.delete({ where: { id: row.id } });
    return null;
  }
  return db.arenaCollaborator.update({
    where: { id: row.id },
    data: { status: "APPROVED" },
  });
}

// ---------------------------------------------------------------------------
// Queries (shared by /api/v1 and the Web UI)
// ---------------------------------------------------------------------------

export interface PageArgs {
  cursor?: string;
  limit?: number;
}

function takeLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? 20, 1), 100);
}

export async function listArenas(
  args: { status?: string; campId?: string } & PageArgs = {},
) {
  const limit = takeLimit(args.limit);
  const rows = await db.arena.findMany({
    where: {
      ...(args.status && { status: args.status }),
      ...(args.campId && { campId: args.campId }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    ...(args.cursor && { cursor: { id: args.cursor }, skip: 1 }),
    take: limit + 1,
    include: {
      camp: { select: { id: true, name: true, color: true } },
      _count: { select: { entries: true, proposals: true } },
    },
  });
  const page = rows.slice(0, limit);
  return {
    items: page.map(serializeArena),
    nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/**
 * Full arena detail: serialized arena + resolved creator + the effective
 * standard (latest version) + full standard history + entries (with agents) +
 * approved collaborators + proposal count.
 */
export async function getArenaDetail(arenaId: string) {
  const arena = await db.arena.findUnique({
    where: { id: arenaId },
    include: {
      camp: { select: { id: true, name: true, color: true } },
      standards: { orderBy: { version: "desc" } },
      entries: {
        orderBy: { joinedAt: "asc" },
        include: {
          agent: { select: { id: true, name: true, avatar: true } },
        },
      },
      collaborators: { where: { status: "APPROVED" } },
      _count: { select: { proposals: true, entries: true } },
    },
  });
  if (!arena) {
    throw new HttpError(404, "ARENA_NOT_FOUND", `Arena ${arenaId} not found`);
  }
  const creator = await resolveActorRef(arena.creatorType, arena.creatorId);
  const { standards, ...rest } = arena;
  return {
    ...serializeArena(rest),
    creator,
    effectiveStandard: standards[0] ?? null,
    standards,
    proposalCount: arena._count.proposals,
  };
}

export async function listProposals(
  arenaId: string,
  args: { status?: string } & PageArgs = {},
) {
  await getArenaOrThrow(arenaId);
  const limit = takeLimit(args.limit);
  const rows = await db.standardProposal.findMany({
    where: { arenaId, ...(args.status && { status: args.status }) },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    ...(args.cursor && { cursor: { id: args.cursor }, skip: 1 }),
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  const items = await Promise.all(
    page.map(async (p) => ({
      ...p,
      author: await resolveActorRef(p.authorType, p.authorId),
    })),
  );
  return {
    items,
    nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}
