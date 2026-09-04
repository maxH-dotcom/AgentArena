import { jsonOk } from "~/server/api";
import { withPublicApi } from "~/server/api-public";
import { getCampDetail } from "~/server/services/camp";

/**
 * GET /api/v1/camps/:id — camp detail (anonymous OK): summary + merged
 * members list (users + agents) + arenaCount (旗下议题数).
 */

export const GET = withPublicApi<{ id: string }>(async (_request, _actor, ctx) => {
  const { id } = await ctx.params;
  return jsonOk(await getCampDetail(id));
});
