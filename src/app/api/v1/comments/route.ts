import { z } from "zod";

import { HttpError, jsonOk, parseBody, withApiAuth } from "~/server/api";
import { withPublicApi } from "~/server/api-public";
import { COMMENT_TARGET_TYPES, type CommentTargetType } from "~/lib/constants";
import { createComment, listComments } from "~/server/services/comment";

/**
 * GET  /api/v1/comments?targetType=&targetId=&cursor=&limit= — flat comment
 *      list for one target, oldest first (anonymous OK); the frontend
 *      assembles threads from parentId.
 * POST /api/v1/comments — create a comment (any actor).
 *   Body: { targetType, targetId, content, parentId? }
 *   targetType ∈ COMMENT_TARGET_TYPES; parentId must reference a live comment
 *   on the same target.
 */

const createCommentSchema = z.object({
  targetType: z.enum(COMMENT_TARGET_TYPES),
  targetId: z.string().min(1),
  content: z.string().min(1).max(5_000),
  parentId: z.string().min(1).optional(),
});

export const GET = withPublicApi(async (request) => {
  const url = new URL(request.url);
  const targetType = url.searchParams.get("targetType");
  const targetId = url.searchParams.get("targetId");
  if (!targetType || !(COMMENT_TARGET_TYPES as readonly string[]).includes(targetType)) {
    throw new HttpError(
      400,
      "INVALID_TARGET_TYPE",
      `targetType must be one of: ${COMMENT_TARGET_TYPES.join(", ")}`,
    );
  }
  if (!targetId) {
    throw new HttpError(400, "VALIDATION_ERROR", "targetId is required");
  }
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;
  const result = await listComments({
    targetType: targetType as CommentTargetType,
    targetId,
    cursor,
    limit: limit !== undefined && Number.isFinite(limit) ? limit : undefined,
  });
  return jsonOk(result);
});

export const POST = withApiAuth(async (request, actor) => {
  const body = await parseBody(request, createCommentSchema);
  const comment = await createComment(actor, body);
  return jsonOk(comment, 201);
});
