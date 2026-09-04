import type { Actor } from "~/server/actor";
import { HttpError } from "~/server/api";
import { db } from "~/server/db";
import { ACTOR_TYPES, type ActorType } from "~/lib/constants";
import {
  resolveActors,
  getActorProfile,
  actorKey,
  type ActorProfile,
} from "~/server/services/actors";

/**
 * Follow service: any actor may follow any actor (user or agent). Both
 * follow() and unfollow() are idempotent — repeating them is a no-op, not
 * an error.
 */

export interface FollowTarget {
  targetType: ActorType;
  targetId: string;
}

export interface FollowListItem {
  actor: ActorProfile | null;
  createdAt: Date;
}

export interface FollowListResult {
  items: FollowListItem[];
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function clampLimit(limit: number | undefined): number {
  if (!limit || Number.isNaN(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(limit), 1), MAX_LIMIT);
}

function assertValidTarget(target: FollowTarget): void {
  if (!(ACTOR_TYPES as readonly string[]).includes(target.targetType)) {
    throw new HttpError(
      400,
      "INVALID_TARGET_TYPE",
      `targetType must be one of: ${ACTOR_TYPES.join(", ")}`,
    );
  }
}

/** Idempotent: following twice succeeds and creates exactly one row. */
export async function follow(
  actor: Actor,
  target: FollowTarget,
): Promise<{ following: true }> {
  assertValidTarget(target);
  if (actor.type === target.targetType && actor.id === target.targetId) {
    throw new HttpError(400, "CANNOT_FOLLOW_SELF", "Cannot follow yourself");
  }
  const profile = await getActorProfile({ type: target.targetType, id: target.targetId });
  if (!profile) throw new HttpError(404, "TARGET_NOT_FOUND", "Follow target not found");

  await db.follow.upsert({
    where: {
      followerType_followerId_targetType_targetId: {
        followerType: actor.type,
        followerId: actor.id,
        targetType: target.targetType,
        targetId: target.targetId,
      },
    },
    create: {
      followerType: actor.type,
      followerId: actor.id,
      targetType: target.targetType,
      targetId: target.targetId,
    },
    update: {},
  });
  return { following: true };
}

/** Idempotent: unfollowing a non-followed target succeeds. */
export async function unfollow(
  actor: Actor,
  target: FollowTarget,
): Promise<{ following: false }> {
  assertValidTarget(target);
  await db.follow.deleteMany({
    where: {
      followerType: actor.type,
      followerId: actor.id,
      targetType: target.targetType,
      targetId: target.targetId,
    },
  });
  return { following: false };
}

async function listFollowPage(
  where: { followerType: string; followerId: string } | { targetType: string; targetId: string },
  resolveField: "follower" | "target",
  cursor: string | undefined,
  limit: number | undefined,
): Promise<FollowListResult> {
  const take = clampLimit(limit);
  const rows = await db.follow.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const refs = page.map((f) =>
    resolveField === "follower"
      ? { type: f.followerType, id: f.followerId }
      : { type: f.targetType, id: f.targetId },
  );
  const profiles = await resolveActors(refs);
  return {
    items: page.map((f, i) => ({
      actor: profiles.get(actorKey(refs[i]!)) ?? null,
      createdAt: f.createdAt,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/** Who follows `actor`. */
export async function listFollowers(
  actor: Actor,
  options: { cursor?: string; limit?: number } = {},
): Promise<FollowListResult> {
  return listFollowPage(
    { targetType: actor.type, targetId: actor.id },
    "follower",
    options.cursor,
    options.limit,
  );
}

/** Whom `actor` follows. */
export async function listFollowing(
  actor: Actor,
  options: { cursor?: string; limit?: number } = {},
): Promise<FollowListResult> {
  return listFollowPage(
    { followerType: actor.type, followerId: actor.id },
    "target",
    options.cursor,
    options.limit,
  );
}
