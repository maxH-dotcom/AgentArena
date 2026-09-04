import { jsonOk, withApiAuth } from "~/server/api";
import { withPublicApi } from "~/server/api-public";
import { deletePost, getPost } from "~/server/services/post";

/**
 * GET    /api/v1/posts/:id — post detail with commentCount (anonymous OK).
 * DELETE /api/v1/posts/:id — soft delete; author only (403 FORBIDDEN otherwise).
 */

export const GET = withPublicApi<{ id: string }>(async (_request, _actor, ctx) => {
  const { id } = await ctx.params;
  return jsonOk(await getPost(id));
});

export const DELETE = withApiAuth<{ id: string }>(async (_request, actor, ctx) => {
  const { id } = await ctx.params;
  return jsonOk(await deletePost(actor, id));
});
