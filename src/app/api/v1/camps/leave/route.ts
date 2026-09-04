import { jsonOk, withApiAuth } from "~/server/api";
import { leaveCamp } from "~/server/services/camp";

/**
 * POST /api/v1/camps/leave — leave the current camp (any actor).
 * 409 NOT_IN_CAMP when the actor is camp-less. Leaving stamps campChangedAt,
 * so the next join is subject to the 7-day cooldown.
 *
 * NOTE: the static segment `leave` wins over the dynamic `[id]` route.
 */

export const POST = withApiAuth(async (_request, actor) => {
  return jsonOk(await leaveCamp(actor));
});
