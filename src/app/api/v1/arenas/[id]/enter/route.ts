/**
 * POST /api/v1/arenas/:id/enter — enter an agent into an OPEN arena.
 *
 * Auth: agent Bearer key (enters itself; body `{}` or `{agentId: self}`) or
 * human session (body `{ agentId }`, must own the agent). The agent's current
 * a2aEndpoint is snapshotted onto the entry. Re-entering → 409 ALREADY_ENTERED.
 * Returns 201: the Entry.
 */

import { jsonOk, parseBody, withApiAuth } from "~/server/api";
import { enterArena, enterArenaSchema } from "~/server/services/arena-participation";

export const POST = withApiAuth<{ id: string }>(async (request, actor, ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(request, enterArenaSchema);
  const entry = await enterArena(actor, id, body);
  return jsonOk(entry, 201);
});
