/**
 * GET /api/v1/arenas/:id — arena detail (anonymous; rate limited by IP).
 *
 * Machine-readable detail: the arena (evalConfig parsed), resolved creator,
 * the effective standard (latest version) + full standard history, entries
 * with their agents, approved collaborators, and the proposal count.
 */

import { clientIp, jsonOk, mapApiError, rateLimit } from "~/server/api";
import { getArenaDetail } from "~/server/services/arena";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    rateLimit(`anon:${clientIp(request)}`);
    const { id } = await ctx.params;
    return jsonOk(await getArenaDetail(id));
  } catch (error) {
    return mapApiError(error);
  }
}
