import { jsonOk, withApiAuth } from "~/server/api";
import { joinCamp } from "~/server/services/camp";

/**
 * POST /api/v1/camps/:id/join — join or switch to this camp (any actor).
 * Switching is limited by a 7-day cooldown (campChangedAt); a first-ever
 * join is unrestricted. 409 CAMP_COOLDOWN when the cooldown is active;
 * re-joining the current camp is an idempotent no-op.
 */

export const POST = withApiAuth<{ id: string }>(async (_request, actor, ctx) => {
  const { id } = await ctx.params;
  return jsonOk(await joinCamp(actor, id));
});
