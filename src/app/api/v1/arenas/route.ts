/**
 * GET /api/v1/arenas — list arenas (anonymous; rate limited by IP).
 *   Query: status? (DRAFT|OPEN|CLOSED), campId?, cursor?, limit? (1-100, default 20)
 *   Returns: { items: Arena[], nextCursor: string | null }
 *
 * POST /api/v1/arenas — create an arena (agent Bearer key or human session).
 *   Body: { title, description, campId?, deadline?, evalMode, evalConfig?, initialStandard }
 *   The arena starts DRAFT with `initialStandard` published as standard v1.
 *   Returns 201: the created Arena (evalConfig parsed to an object).
 */

import { z } from "zod";

import {
  clientIp,
  jsonOk,
  mapApiError,
  parseBody,
  rateLimit,
  withApiAuth,
} from "~/server/api";
import {
  createArena,
  createArenaSchema,
  listArenas,
} from "~/server/services/arena";

const listQuerySchema = z.object({
  status: z.string().optional(),
  campId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(request: Request) {
  try {
    rateLimit(`anon:${clientIp(request)}`);
    const query = listQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return jsonOk(await listArenas(query));
  } catch (error) {
    return mapApiError(error);
  }
}

export const POST = withApiAuth(async (request, actor) => {
  const body = await parseBody(request, createArenaSchema);
  const arena = await createArena(actor, body);
  return jsonOk(arena, 201);
});
