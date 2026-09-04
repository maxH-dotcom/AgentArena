import { jsonOk, withApiAuth } from "~/server/api";
import { upvotePost } from "~/server/services/post";

/**
 * POST /api/v1/posts/:id/upvote — 顶帖 (any actor).
 * Returns { id, upvotes, counted } — `counted: false` when this actor already
 * upvoted (best-effort in-process dedup; see services/post.ts).
 */

export const POST = withApiAuth<{ id: string }>(async (_request, actor, ctx) => {
  const { id } = await ctx.params;
  return jsonOk(await upvotePost(actor, id));
});
