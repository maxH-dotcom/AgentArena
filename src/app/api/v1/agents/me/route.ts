import { z } from "zod";

import { ForbiddenError } from "~/server/actor";
import { jsonOk, parseBody, withApiAuth } from "~/server/api";
import { db } from "~/server/db";

/** Agent profile shape returned by the API — never includes `apiKeyHash`. */
function toProfile(agent: {
  id: string;
  name: string;
  description: string | null;
  avatar: string | null;
  a2aEndpoint: string | null;
  isPublic: boolean;
  ownerId: string | null;
  campId: string | null;
  agentCard: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    avatar: agent.avatar,
    a2aEndpoint: agent.a2aEndpoint,
    isPublic: agent.isPublic,
    ownerId: agent.ownerId,
    campId: agent.campId,
    agentCard: JSON.parse(agent.agentCard) as unknown,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

async function requireOwnAgent(actor: { type: string; id: string }) {
  if (actor.type !== "agent") {
    throw new ForbiddenError("Only agents can access /api/v1/agents/me");
  }
  const agent = await db.agent.findFirst({
    where: { id: actor.id, deletedAt: null },
  });
  if (!agent) throw new ForbiddenError("Agent not found");
  return agent;
}

/** GET /api/v1/agents/me — the authenticated agent's own profile. */
export const GET = withApiAuth(async (_request, actor) => {
  const agent = await requireOwnAgent(actor);
  return jsonOk(toProfile(agent));
});

const patchSchema = z
  .object({
    description: z.string().max(2000).nullable().optional(),
    avatar: z.string().url().nullable().optional(),
    a2aEndpoint: z
      .string()
      .url()
      .refine(
        (u) => u.startsWith("http://") || u.startsWith("https://"),
        "must be an http(s) URL",
      )
      .nullable()
      .optional(),
    isPublic: z.boolean().optional(),
  })
  .strict();

/** PATCH /api/v1/agents/me — update description/avatar/a2aEndpoint/isPublic. */
export const PATCH = withApiAuth(async (request, actor) => {
  const agent = await requireOwnAgent(actor);
  const body = await parseBody(request, patchSchema);
  const updated = await db.agent.update({
    where: { id: agent.id },
    data: {
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.avatar !== undefined ? { avatar: body.avatar } : {}),
      ...(body.a2aEndpoint !== undefined ? { a2aEndpoint: body.a2aEndpoint } : {}),
      ...(body.isPublic !== undefined ? { isPublic: body.isPublic } : {}),
    },
  });
  return jsonOk(toProfile(updated));
});
