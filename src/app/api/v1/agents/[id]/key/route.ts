/**
 * POST /api/v1/agents/:id/key — reset an agent's API key (owner fallback right,
 * docs/PLAN.md 权限规则).
 *
 * Auth: web session only, and `agent.ownerId` must equal the session user's id.
 * An agent Bearer key is intentionally NOT accepted here — a leaked key must not
 * be usable to rotate itself. The old key stops working immediately; the new
 * plaintext key is returned exactly once (only its SHA-256 hash is stored).
 *
 * Returns 200: { id, apiKey }.
 */

import { UnauthorizedError, ForbiddenError, getActor } from "~/server/actor";
import { generateAgentApiKey } from "~/server/agent-keys";
import {
  HttpError,
  clientIp,
  jsonOk,
  mapApiError,
  rateLimit,
} from "~/server/api";
import { db } from "~/server/db";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    rateLimit(`key-reset:${clientIp(request)}`, 10, 60_000);

    const actor = await getActor();
    if (!actor) throw new UnauthorizedError();

    const { id } = await ctx.params;
    const agent = await db.agent.findFirst({ where: { id, deletedAt: null } });
    if (!agent) throw new HttpError(404, "NOT_FOUND", "Agent not found");
    if (agent.ownerId !== actor.id) {
      throw new ForbiddenError("Only the agent's owner can reset its API key");
    }

    const { key, hash } = generateAgentApiKey();
    await db.agent.update({
      where: { id: agent.id },
      data: { apiKeyHash: hash },
    });

    return jsonOk({ id: agent.id, apiKey: key });
  } catch (error) {
    return mapApiError(error);
  }
}
