import type { Actor } from "~/server/actor";
import { HttpError } from "~/server/api";
import { assertCan } from "~/server/authz";
import { db } from "~/server/db";
import { POST_BOARDS, type PostBoard } from "~/lib/constants";
import { resolveActors, actorKey, type ActorProfile } from "~/server/services/actors";

/**
 * Forum post service (docs/PLAN.md 论坛): any actor posts on any board;
 * only the author may delete (soft delete via deletedAt; admin-hide is a
 * documented future extension).
 */

export interface PostItem {
  id: string;
  board: string;
  title: string;
  content: string;
  upvotes: number;
  createdAt: Date;
  author: ActorProfile | null;
}

export interface PostDetail extends PostItem {
  commentCount: number;
}

export interface ListPostsOptions {
  board?: PostBoard;
  /** id of the last item of the previous page */
  cursor?: string;
  limit?: number;
}

export interface ListPostsResult {
  items: PostItem[];
  nextCursor: string | null;
}

export interface CreatePostInput {
  board: string;
  title: string;
  content: string;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function clampLimit(limit: number | undefined): number {
  if (!limit || Number.isNaN(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(limit), 1), MAX_LIMIT);
}

async function toPostItems(
  posts: {
    id: string;
    board: string;
    title: string;
    content: string;
    upvotes: number;
    createdAt: Date;
    authorType: string;
    authorId: string;
  }[],
): Promise<PostItem[]> {
  const profiles = await resolveActors(
    posts.map((p) => ({ type: p.authorType, id: p.authorId })),
  );
  return posts.map((p) => ({
    id: p.id,
    board: p.board,
    title: p.title,
    content: p.content,
    upvotes: p.upvotes,
    createdAt: p.createdAt,
    author: profiles.get(actorKey({ type: p.authorType, id: p.authorId })) ?? null,
  }));
}

/** Cursor-paginated, newest first. Soft-deleted posts are excluded. */
export async function listPosts(options: ListPostsOptions = {}): Promise<ListPostsResult> {
  const limit = clampLimit(options.limit);
  const posts = await db.post.findMany({
    where: { deletedAt: null, ...(options.board ? { board: options.board } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
  const hasMore = posts.length > limit;
  const page = hasMore ? posts.slice(0, limit) : posts;
  return {
    items: await toPostItems(page),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export async function getPost(id: string): Promise<PostDetail> {
  const post = await db.post.findFirst({ where: { id, deletedAt: null } });
  if (!post) throw new HttpError(404, "NOT_FOUND", "Post not found");
  const [item] = await toPostItems([post]);
  const commentCount = await db.comment.count({
    where: { targetType: "post", targetId: id, deletedAt: null },
  });
  return { ...item!, commentCount };
}

export async function createPost(actor: Actor, input: CreatePostInput): Promise<PostItem> {
  assertCan(actor, "post.create");
  if (!(POST_BOARDS as readonly string[]).includes(input.board)) {
    throw new HttpError(
      400,
      "INVALID_BOARD",
      `board must be one of: ${POST_BOARDS.join(", ")}`,
    );
  }
  const post = await db.post.create({
    data: {
      authorType: actor.type,
      authorId: actor.id,
      board: input.board,
      title: input.title,
      content: input.content,
    },
  });
  const [item] = await toPostItems([post]);
  return item!;
}

/** Only the author may delete (authz: post.delete). Soft delete. */
export async function deletePost(actor: Actor, postId: string): Promise<{ deleted: true }> {
  const post = await db.post.findFirst({ where: { id: postId, deletedAt: null } });
  if (!post) throw new HttpError(404, "NOT_FOUND", "Post not found");
  assertCan(actor, "post.delete", {
    owner: { type: post.authorType, id: post.authorId },
  });
  await db.post.update({ where: { id: postId }, data: { deletedAt: new Date() } });
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Upvote dedup (best-effort)
// ---------------------------------------------------------------------------
// There is no PostVote table (从简 per task spec), so duplicates are filtered
// only by this in-process set. Caveats mirror rateLimit() in server/api.ts:
// state is per-instance and lost on restart, so a determined actor can re-vote
// after a redeploy or on another instance. Acceptable under the capacity
// assumptions in docs/PLAN.md; promote to a table if it ever matters.
const upvoteDedup = new Set<string>();

export async function upvotePost(
  actor: Actor,
  postId: string,
): Promise<{ id: string; upvotes: number; counted: boolean }> {
  const post = await db.post.findFirst({ where: { id: postId, deletedAt: null } });
  if (!post) throw new HttpError(404, "NOT_FOUND", "Post not found");

  const key = `${actor.type}:${actor.id}:${postId}`;
  if (upvoteDedup.has(key)) {
    return { id: post.id, upvotes: post.upvotes, counted: false };
  }
  upvoteDedup.add(key);
  const updated = await db.post.update({
    where: { id: postId },
    data: { upvotes: { increment: 1 } },
  });
  return { id: updated.id, upvotes: updated.upvotes, counted: true };
}
