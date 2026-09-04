import { Prisma } from "../../../generated/prisma";

import type { Actor } from "~/server/actor";
import { HttpError } from "~/server/api";
import { assertCan } from "~/server/authz";
import { db } from "~/server/db";
import { CAMP_SWITCH_COOLDOWN_MS } from "~/lib/constants";
import type { ActorProfile } from "~/server/services/actors";

/**
 * Camp service (docs/PLAN.md 阵营体系): every Actor may belong to at most one
 * camp; switching camps has a 7-day cooldown (CAMP_SWITCH_COOLDOWN_MS) tracked
 * via `campChangedAt` on User/Agent — a first-ever join is unrestricted.
 *
 * Errors are thrown as HttpError (status + stable code) so the REST layer can
 * map them verbatim and server actions can pattern-match on `code`.
 */

export interface CampSummary {
  id: string;
  name: string;
  slogan: string | null;
  color: string;
  description: string | null;
  createdByType: string;
  createdById: string;
  memberCount: number;
  winCount: number;
  createdAt: Date;
}

export interface CampDetail extends CampSummary {
  /** users + agents merged into one list */
  members: ActorProfile[];
  /** number of arenas hanging under this camp (旗下议题数) */
  arenaCount: number;
}

export interface CreateCampInput {
  name: string;
  slogan?: string;
  color: string;
  description?: string;
}

export interface JoinCampResult {
  campId: string;
  /** true when the actor was already in this camp (idempotent no-op) */
  alreadyMember: boolean;
}

function toSummary(camp: {
  id: string;
  name: string;
  slogan: string | null;
  color: string;
  description: string | null;
  createdByType: string;
  createdById: string;
  memberCount: number;
  winCount: number;
  createdAt: Date;
}): CampSummary {
  return { ...camp };
}

/** All camps, ordered by winCount then memberCount (mirrors the camp leaderboard). */
export async function listCamps(): Promise<CampSummary[]> {
  const camps = await db.camp.findMany({
    orderBy: [{ winCount: "desc" }, { memberCount: "desc" }, { createdAt: "asc" }],
  });
  return camps.map(toSummary);
}

export async function getCampDetail(id: string): Promise<CampDetail> {
  const camp = await db.camp.findUnique({
    where: { id },
    include: {
      users: {
        where: { deletedAt: null },
        select: { id: true, name: true, avatar: true, image: true },
      },
      agents: {
        where: { deletedAt: null },
        select: { id: true, name: true, avatar: true },
      },
      _count: { select: { arenas: true } },
    },
  });
  if (!camp) throw new HttpError(404, "NOT_FOUND", "Camp not found");

  const members: ActorProfile[] = [
    ...camp.users.map((u) => ({
      type: "user" as const,
      id: u.id,
      name: u.name,
      avatar: u.avatar ?? u.image,
    })),
    ...camp.agents.map((a) => ({
      type: "agent" as const,
      id: a.id,
      name: a.name,
      avatar: a.avatar,
    })),
  ];
  return { ...toSummary(camp), members, arenaCount: camp._count.arenas };
}

/**
 * Create a camp. The creator does NOT auto-join (从简, per task spec) — joining
 * is a separate joinCamp() call. Duplicate names → 409 NAME_TAKEN.
 */
export async function createCamp(
  actor: Actor,
  input: CreateCampInput,
): Promise<CampSummary> {
  assertCan(actor, "camp.create");

  const existing = await db.camp.findUnique({ where: { name: input.name } });
  if (existing) {
    throw new HttpError(409, "NAME_TAKEN", `Camp name "${input.name}" is already taken`);
  }
  try {
    const camp = await db.camp.create({
      data: {
        name: input.name,
        slogan: input.slogan,
        color: input.color,
        description: input.description,
        createdByType: actor.type,
        createdById: actor.id,
      },
    });
    return toSummary(camp);
  } catch (error) {
    // unique constraint race on name
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "NAME_TAKEN", `Camp name "${input.name}" is already taken`);
    }
    throw error;
  }
}

/** Load the caller's own User/Agent row (campId + campChangedAt). */
async function loadActorRow(actor: Actor, tx: DbOrTx = db) {
  const row =
    actor.type === "user"
      ? await tx.user.findUnique({
          where: { id: actor.id },
          select: { campId: true, campChangedAt: true, deletedAt: true },
        })
      : await tx.agent.findUnique({
          where: { id: actor.id },
          select: { campId: true, campChangedAt: true, deletedAt: true },
        });
  if (!row || row.deletedAt) {
    throw new HttpError(404, "ACTOR_NOT_FOUND", "Actor record not found");
  }
  return row;
}

type DbOrTx = Pick<typeof db, "user" | "agent" | "camp">;

/**
 * Join (or switch to) a camp.
 * - already a member of this camp → idempotent no-op
 * - switching camps (or re-joining after leave) requires the 7-day cooldown
 *   measured from `campChangedAt`; a first-ever join (campChangedAt == null)
 *   is unrestricted
 * - memberCount is maintained on both the old and the new camp
 */
export async function joinCamp(actor: Actor, campId: string): Promise<JoinCampResult> {
  assertCan(actor, "camp.join");

  const camp = await db.camp.findUnique({ where: { id: campId } });
  if (!camp) throw new HttpError(404, "NOT_FOUND", "Camp not found");

  return db.$transaction(async (tx) => {
    const me = await loadActorRow(actor, tx);
    if (me.campId === campId) return { campId, alreadyMember: true };

    if (
      me.campChangedAt &&
      Date.now() - me.campChangedAt.getTime() < CAMP_SWITCH_COOLDOWN_MS
    ) {
      const retryAt = new Date(me.campChangedAt.getTime() + CAMP_SWITCH_COOLDOWN_MS);
      throw new HttpError(
        409,
        "CAMP_COOLDOWN",
        `Camp switch cooldown active until ${retryAt.toISOString()}`,
      );
    }

    const now = new Date();
    const updateActor =
      actor.type === "user"
        ? tx.user.update({ where: { id: actor.id }, data: { campId, campChangedAt: now } })
        : tx.agent.update({ where: { id: actor.id }, data: { campId, campChangedAt: now } });
    await Promise.all([
      updateActor,
      tx.camp.update({ where: { id: campId }, data: { memberCount: { increment: 1 } } }),
      ...(me.campId
        ? [
            tx.camp.update({
              where: { id: me.campId },
              data: { memberCount: { decrement: 1 } },
            }),
          ]
        : []),
    ]);
    return { campId, alreadyMember: false };
  });
}

/** Leave the current camp. Leaving also stamps campChangedAt, so the next join is cooled down. */
export async function leaveCamp(actor: Actor): Promise<{ left: true }> {
  return db.$transaction(async (tx) => {
    const me = await loadActorRow(actor, tx);
    if (!me.campId) {
      throw new HttpError(409, "NOT_IN_CAMP", "Actor is not in a camp");
    }
    const now = new Date();
    const updateActor =
      actor.type === "user"
        ? tx.user.update({
            where: { id: actor.id },
            data: { campId: null, campChangedAt: now },
          })
        : tx.agent.update({
            where: { id: actor.id },
            data: { campId: null, campChangedAt: now },
          });
    await Promise.all([
      updateActor,
      tx.camp.update({
        where: { id: me.campId },
        data: { memberCount: { decrement: 1 } },
      }),
    ]);
    return { left: true };
  });
}
