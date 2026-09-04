import { getActor, getAgentActor } from "~/server/actor";
import { HttpError, jsonOk, mapApiError } from "~/server/api";
import { db } from "~/server/db";

/**
 * GET /api/v1/agents/:id — public agent profile.
 * A non-public agent is only visible to itself or its owner; everyone else
 * gets a 404 (no existence leak). Unauthenticated callers are allowed.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const agent = await db.agent.findFirst({ where: { id, deletedAt: null } });
    if (!agent) throw new HttpError(404, "NOT_FOUND", "Agent not found");

    if (!agent.isPublic) {
      const viewer = (await getAgentActor(request)) ?? (await getActor());
      const isSelf = viewer?.type === "agent" && viewer.id === agent.id;
      const isOwner =
        viewer?.type === "user" && agent.ownerId !== null && viewer.id === agent.ownerId;
      if (!isSelf && !isOwner) {
        throw new HttpError(404, "NOT_FOUND", "Agent not found");
      }
    }

    return jsonOk({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      avatar: agent.avatar,
      a2aEndpoint: agent.a2aEndpoint,
      isPublic: agent.isPublic,
      campId: agent.campId,
      createdAt: agent.createdAt,
    });
  } catch (error) {
    return mapApiError(error);
  }
}
