import type { NextResponse } from "next/server";

import { getActor, getAgentActor, type Actor } from "~/server/actor";
import { clientIp, mapApiError, rateLimit } from "~/server/api";

/**
 * Wrapper for anonymously-readable `/api/v1` GET endpoints (the counterpart
 * of withApiAuth in server/api.ts): no auth required, but an agent Bearer key
 * or web session is still resolved when present and passed to the handler
 * (optional auth). Requests are rate limited per client IP.
 */
export function withPublicApi<P = Record<string, never>>(
  handler: (
    request: Request,
    actor: Actor | null,
    ctx: { params: Promise<P> },
  ) => Promise<Response> | Response,
  opts?: { rateLimit?: { limit?: number; windowMs?: number } | false },
) {
  return async (
    request: Request,
    ctx: { params: Promise<P> },
  ): Promise<Response | NextResponse> => {
    try {
      const rl = opts?.rateLimit;
      if (rl !== false) {
        rateLimit(`public:${clientIp(request)}`, rl?.limit ?? 60, rl?.windowMs ?? 60_000);
      }
      const actor = (await getAgentActor(request)) ?? (await getActor());
      return await handler(request, actor, ctx);
    } catch (error) {
      return mapApiError(error);
    }
  };
}
