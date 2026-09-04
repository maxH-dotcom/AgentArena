import type { Actor } from "~/server/actor";
import { HttpError } from "~/server/api";
import { assertCan } from "~/server/authz";
import { db } from "~/server/db";
import { COMMENT_TARGET_TYPES, type CommentTargetType } from "~/lib/constants";
import { resolveActors, actorKey, type ActorProfile } from "~/server/services/actors";

/**
 * Comment service (docs/PLAN.md 数据模型 Comment): comments attach to arenas,
 * submissions or posts; parentId self-reference gives threads. Lists are
 * returned FLAT (oldest first) — the frontend assembles the tree.
 */

export interface CommentItem {
  id: string;
  targetType: string;
  targetId: string;
  parentId: string | null;
  content: string;
  createdAt: Date;
  author: ActorProfile | null;
}

export interface ListCommentsOptions {
  targetType: CommentTargetType;
  targetId: string;
  cursor?: string;
  limit?: number;
}

export interface ListCommentsResult {
  items: CommentItem[];
  nextCursor: string | null;
}

export interface CreateCommentInput {
  targetType: string;
  targetId: string;
  content: string;
  parentId?: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function clampLimit(limit: number | undefined): number {
  if (!limit || Number.isNaN(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(limit), 1), MAX_LIMIT);
}

async function toCommentItems(
  comments: {
    id: string;
    targetType: string;
    targetId: string;
    parentId: string | null;
    content: string;
    createdAt: Date;
    authorType: string;
    authorId: string;
  }[],
): Promise<CommentItem[]> {
  const profiles = await resolveActors(
    comments.map((c) => ({ type: c.authorType, id: c.authorId })),
  );
  return comments.map((c) => ({
    id: c.id,
    targetType: c.targetType,
    targetId: c.targetId,
    parentId: c.parentId,
    content: c.content,
    createdAt: c.createdAt,
    author: profiles.get(actorKey({ type: c.authorType, id: c.authorId })) ?? null,
  }));
}

async function assertTargetExists(targetType: string, targetId: string): Promise<void> {
  let exists = false;
  switch (targetType) {
    case "arena":
      exists = !!(await db.arena.findUnique({ where: { id: targetId }, select: { id: true } }));
      break;
    case "submission":
      exists = !!(await db.submission.findUnique({
        where: { id: targetId },
        select: { id: true },
      }));
      break;
    case "post":
      exists = !!(await db.post.findFirst({
        where: { id: targetId, deletedAt: null },
        select: { id: true },
      }));
      break;
  }
  if (!exists) {
    throw new HttpError(404, "TARGET_NOT_FOUND", `Comment target ${targetType}:${targetId} not found`);
  }
}

/** Flat list, oldest first (frontend assembles the tree via parentId). */
export async function listComments(
  options: ListCommentsOptions,
): Promise<ListCommentsResult> {
  if (!(COMMENT_TARGET_TYPES as readonly string[]).includes(options.targetType)) {
    throw new HttpError(
      400,
      "INVALID_TARGET_TYPE",
      `targetType must be one of: ${COMMENT_TARGET_TYPES.join(", ")}`,
    );
  }
  const limit = clampLimit(options.limit);
  const comments = await db.comment.findMany({
    where: {
      targetType: options.targetType,
      targetId: options.targetId,
      deletedAt: null,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
  const hasMore = comments.length > limit;
  const page = hasMore ? comments.slice(0, limit) : comments;
  return {
    items: await toCommentItems(page),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export async function createComment(
  actor: Actor,
  input: CreateCommentInput,
): Promise<CommentItem> {
  assertCan(actor, "comment.create");
  if (!(COMMENT_TARGET_TYPES as readonly string[]).includes(input.targetType)) {
    throw new HttpError(
      400,
      "INVALID_TARGET_TYPE",
      `targetType must be one of: ${COMMENT_TARGET_TYPES.join(", ")}`,
    );
  }
  await assertTargetExists(input.targetType, input.targetId);

  if (input.parentId) {
    const parent = await db.comment.findFirst({
      where: { id: input.parentId, deletedAt: null },
    });
    if (
      !parent ||
      parent.targetType !== input.targetType ||
      parent.targetId !== input.targetId
    ) {
      throw new HttpError(
        400,
        "INVALID_PARENT",
        "parentId must reference a live comment on the same target",
      );
    }
  }

  const comment = await db.comment.create({
    data: {
      authorType: actor.type,
      authorId: actor.id,
      targetType: input.targetType,
      targetId: input.targetId,
      content: input.content,
      parentId: input.parentId,
    },
  });
  const [item] = await toCommentItems([comment]);
  return item!;
}

/** Only the author may delete (authz: comment.delete). Soft delete. */
export async function deleteComment(
  actor: Actor,
  commentId: string,
): Promise<{ deleted: true }> {
  const comment = await db.comment.findFirst({ where: { id: commentId, deletedAt: null } });
  if (!comment) throw new HttpError(404, "NOT_FOUND", "Comment not found");
  assertCan(actor, "comment.delete", {
    owner: { type: comment.authorType, id: comment.authorId },
  });
  await db.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
  return { deleted: true };
}
