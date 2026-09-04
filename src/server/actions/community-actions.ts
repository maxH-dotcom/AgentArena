"use server";

import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";

import { POST_BOARDS } from "~/lib/constants";
import {
  ForbiddenError,
  UnauthorizedError,
  requireActor,
} from "~/server/actor";
import { HttpError } from "~/server/api";
import { createCamp, joinCamp, leaveCamp } from "~/server/services/camp";
import { createComment, deleteComment } from "~/server/services/comment";
import { follow, unfollow } from "~/server/services/follow";
import { markRead } from "~/server/services/notification";
import { createPost, deletePost, upvotePost } from "~/server/services/post";

/**
 * Community server actions (camps / forum / comments / follows / notifications).
 * Web-UI wrappers over the domain services in src/server/services/*; the REST
 * /api/v1 routes call the same services. Errors are returned (not thrown) as
 * `{ ok: false, code, message }` so client components can map `code` to a
 * translated message and fall back to the server `message`.
 */

export type CommunityActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

async function run<T>(fn: () => Promise<T>): Promise<CommunityActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof HttpError) {
      return { ok: false, code: error.code, message: error.message };
    }
    if (error instanceof UnauthorizedError) {
      return { ok: false, code: "UNAUTHORIZED", message: error.message };
    }
    if (error instanceof ForbiddenError) {
      return { ok: false, code: "FORBIDDEN", message: error.message };
    }
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: issue?.message ?? "Invalid input",
      };
    }
    console.error("Community action failed", error);
    return { ok: false, code: "INTERNAL", message: "Internal server error" };
  }
}

/** Revalidate every locale variant of the community pages (layouts are locale-scoped). */
function revalidateCommunity(paths: string[]): void {
  for (const path of paths) {
    revalidatePath(`/[locale]${path}`, "page");
  }
}

// ---------------------------------------------------------------------------
// Camps
// ---------------------------------------------------------------------------

const createCampSchema = z.object({
  name: z.string().trim().min(1).max(40),
  slogan: z.string().trim().max(120).optional(),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "color must be a #rrggbb hex value"),
  description: z.string().trim().max(2_000).optional(),
});

export async function createCampAction(input: {
  name: string;
  slogan?: string;
  color: string;
  description?: string;
}): Promise<CommunityActionResult<{ id: string }>> {
  return run(async () => {
    const actor = await requireActor();
    const camp = await createCamp(actor, createCampSchema.parse(input));
    revalidateCommunity(["/camps", "/leaderboards"]);
    return { id: camp.id };
  });
}

export async function joinCampAction(
  campId: string,
): Promise<CommunityActionResult<{ campId: string; alreadyMember: boolean }>> {
  return run(async () => {
    const actor = await requireActor();
    const result = await joinCamp(actor, campId);
    revalidateCommunity(["/camps", `/camps/${campId}`, "/leaderboards"]);
    return result;
  });
}

export async function leaveCampAction(): Promise<
  CommunityActionResult<{ left: true }>
> {
  return run(async () => {
    const actor = await requireActor();
    const result = await leaveCamp(actor);
    revalidateCommunity(["/camps", "/leaderboards"]);
    return result;
  });
}

// ---------------------------------------------------------------------------
// Forum posts
// ---------------------------------------------------------------------------

const createPostSchema = z.object({
  board: z.enum(POST_BOARDS),
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(10_000),
});

export async function createPostAction(input: {
  board: string;
  title: string;
  content: string;
}): Promise<CommunityActionResult<{ id: string }>> {
  return run(async () => {
    const actor = await requireActor();
    const post = await createPost(actor, createPostSchema.parse(input));
    revalidateCommunity(["/forum", `/forum/${post.board}`]);
    return { id: post.id };
  });
}

export async function deletePostAction(
  postId: string,
): Promise<CommunityActionResult<{ deleted: true }>> {
  return run(async () => {
    const actor = await requireActor();
    const result = await deletePost(actor, postId);
    revalidateCommunity(["/forum"]);
    return result;
  });
}

export async function upvotePostAction(
  postId: string,
): Promise<CommunityActionResult<{ id: string; upvotes: number; counted: boolean }>> {
  return run(async () => {
    const actor = await requireActor();
    return upvotePost(actor, postId);
  });
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

const createCommentSchema = z.object({
  targetType: z.enum(["arena", "submission", "post"]),
  targetId: z.string().min(1),
  content: z.string().trim().min(1).max(5_000),
  parentId: z.string().min(1).optional(),
});

export async function createCommentAction(input: {
  targetType: string;
  targetId: string;
  content: string;
  parentId?: string;
}): Promise<CommunityActionResult<{ id: string }>> {
  return run(async () => {
    const actor = await requireActor();
    const comment = await createComment(actor, createCommentSchema.parse(input));
    return { id: comment.id };
  });
}

export async function deleteCommentAction(
  commentId: string,
): Promise<CommunityActionResult<{ deleted: true }>> {
  return run(async () => {
    const actor = await requireActor();
    return deleteComment(actor, commentId);
  });
}

// ---------------------------------------------------------------------------
// Follows
// ---------------------------------------------------------------------------

const followTargetSchema = z.object({
  targetType: z.enum(["user", "agent"]),
  targetId: z.string().min(1),
});

export async function followAction(input: {
  targetType: string;
  targetId: string;
}): Promise<CommunityActionResult<{ following: true }>> {
  return run(async () => {
    const actor = await requireActor();
    return follow(actor, followTargetSchema.parse(input));
  });
}

export async function unfollowAction(input: {
  targetType: string;
  targetId: string;
}): Promise<CommunityActionResult<{ following: false }>> {
  return run(async () => {
    const actor = await requireActor();
    return unfollow(actor, followTargetSchema.parse(input));
  });
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export async function markAllNotificationsReadAction(): Promise<
  CommunityActionResult<{ updated: number }>
> {
  return run(async () => {
    const actor = await requireActor();
    const result = await markRead(actor);
    revalidateCommunity(["/notifications"]);
    return result;
  });
}

export async function markNotificationReadAction(
  id: string,
): Promise<CommunityActionResult<{ updated: number }>> {
  return run(async () => {
    const actor = await requireActor();
    return markRead(actor, [id]);
  });
}
