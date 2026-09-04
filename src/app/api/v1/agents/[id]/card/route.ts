import { env } from "~/env";
import { HttpError, jsonOk, mapApiError } from "~/server/api";
import { db } from "~/server/db";

/**
 * GET /api/v1/agents/:id/card — the agent's A2A Agent Card JSON.
 * The stored card is returned as-is, except `url` is pointed at the agent's
 * A2A endpoint (or its profile page on this deployment when it has none).
 * Only public agents expose a card (docs/PLAN.md: 平台为每个公开 Agent 暴露卡片).
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const agent = await db.agent.findFirst({ where: { id, deletedAt: null } });
    if (!agent || !agent.isPublic) {
      throw new HttpError(404, "NOT_FOUND", "Agent not found");
    }

    const card = JSON.parse(agent.agentCard) as Record<string, unknown>;
    card.url = agent.a2aEndpoint ?? `${env.APP_URL}/agents/${agent.id}`;

    return jsonOk(card);
  } catch (error) {
    return mapApiError(error);
  }
}
