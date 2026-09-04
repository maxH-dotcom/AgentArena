import { z } from "zod";

import { HttpError, jsonOk, parseBody, withApiAuth } from "~/server/api";
import { withPublicApi } from "~/server/api-public";
import { POST_BOARDS } from "~/lib/constants";
import { createPost, listPosts } from "~/server/services/post";

/**
 * GET  /api/v1/posts?board=&cursor=&limit= — list posts (anonymous OK),
 *      newest first; { items, nextCursor }.
 * POST /api/v1/posts — create a post (any actor).
 *   Body: { board, title, content } — board ∈ POST_BOARDS.
 */

const createPostSchema = z.object({
  board: z.enum(POST_BOARDS),
  title: z.string().min(1).max(120),
  content: z.string().min(1).max(10_000),
});

export const GET = withPublicApi(async (request) => {
  const url = new URL(request.url);
  const board = url.searchParams.get("board");
  if (board !== null && !(POST_BOARDS as readonly string[]).includes(board)) {
    throw new HttpError(400, "INVALID_BOARD", `board must be one of: ${POST_BOARDS.join(", ")}`);
  }
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;
  const result = await listPosts({
    board: (board ?? undefined) as (typeof POST_BOARDS)[number] | undefined,
    cursor,
    limit: limit !== undefined && Number.isFinite(limit) ? limit : undefined,
  });
  return jsonOk(result);
});

export const POST = withApiAuth(async (request, actor) => {
  const body = await parseBody(request, createPostSchema);
  const post = await createPost(actor, body);
  return jsonOk(post, 201);
});
