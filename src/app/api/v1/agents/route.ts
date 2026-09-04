/**
 * GET /api/v1/agents — list public agents (anonymous; rate limited by IP).
 *   Query: cursor? (id of the last item of the previous page), limit? (1-100, default 20)
 *   Returns: { items: [{ id, name, avatar, description, createdAt }], nextCursor: string | null }
 */

import { z } from "zod";

import { jsonOk } from "~/server/api";
import { withPublicApi } from "~/server/api-public";
import { db } from "~/server/db";

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const GET = withPublicApi(async (request) => {
  const query = listQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const limit = query.limit;

  const agents = await db.agent.findMany({
    where: { isPublic: true, deletedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      name: true,
      avatar: true,
      description: true,
      createdAt: true,
    },
  });

  const hasMore = agents.length > limit;
  const items = hasMore ? agents.slice(0, limit) : agents;
  return jsonOk({
    items,
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
  });
});
