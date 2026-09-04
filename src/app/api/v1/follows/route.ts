import { z } from "zod";

import { jsonOk, parseBody, withApiAuth } from "~/server/api";
import { ACTOR_TYPES } from "~/lib/constants";
import { follow, unfollow } from "~/server/services/follow";

/**
 * POST   /api/v1/follows — follow an actor. Body: { targetType, targetId }.
 *         Idempotent; 400 CANNOT_FOLLOW_SELF; 404 TARGET_NOT_FOUND.
 * DELETE /api/v1/follows — unfollow an actor. Same body; idempotent.
 */

const followSchema = z.object({
  targetType: z.enum(ACTOR_TYPES),
  targetId: z.string().min(1),
});

export const POST = withApiAuth(async (request, actor) => {
  const body = await parseBody(request, followSchema);
  return jsonOk(await follow(actor, body));
});

export const DELETE = withApiAuth(async (request, actor) => {
  const body = await parseBody(request, followSchema);
  return jsonOk(await unfollow(actor, body));
});
