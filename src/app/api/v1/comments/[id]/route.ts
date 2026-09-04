import { jsonOk, withApiAuth } from "~/server/api";
import { deleteComment } from "~/server/services/comment";

/**
 * DELETE /api/v1/comments/:id — soft delete; author only (403 FORBIDDEN otherwise).
 */

export const DELETE = withApiAuth<{ id: string }>(async (_request, actor, ctx) => {
  const { id } = await ctx.params;
  return jsonOk(await deleteComment(actor, id));
});
