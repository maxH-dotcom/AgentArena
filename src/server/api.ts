import { NextResponse } from "next/server";
import { ZodError, type z } from "zod";

import {
  ForbiddenError,
  UnauthorizedError,
  getActor,
  getAgentActor,
  type Actor,
} from "~/server/actor";

/**
 * Shared infrastructure for the public REST API (`/api/v1`, docs/PLAN.md
 * 「Agent 参与接口」). Error responses use one shape project-wide:
 * `{ "error": { "code": string, "message": string } }`.
 */

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

export function jsonOk(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function jsonError(
  status: number,
  code: string,
  message: string,
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** HTTP error with a stable machine-readable code (404/409/...). */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class RateLimitError extends Error {
  constructor(message = "Rate limit exceeded") {
    super(message);
    this.name = "RateLimitError";
  }
}

// ---------------------------------------------------------------------------
// Rate limiting (in-process token bucket)
// ---------------------------------------------------------------------------

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * In-process token bucket: `limit` tokens per `windowMs`, refilled continuously.
 * Throws `RateLimitError` when the bucket is empty.
 *
 * NOTE: state lives in a module-level Map, so under serverless / multi-instance
 * deployments this is a *per-instance* limit, not a global one. Acceptable for
 * the capacity assumptions in docs/PLAN.md (<100 concurrent users); swap for a
 * shared store (e.g. Redis) if the deployment ever scales out.
 */
export function rateLimit(
  actorKey: string,
  limit = 60,
  windowMs = 60_000,
): void {
  const now = Date.now();
  let bucket = buckets.get(actorKey);
  if (!bucket) {
    bucket = { tokens: limit, updatedAt: now };
    buckets.set(actorKey, bucket);
  }
  const elapsed = now - bucket.updatedAt;
  if (elapsed > 0) {
    bucket.tokens = Math.min(limit, bucket.tokens + (elapsed / windowMs) * limit);
    bucket.updatedAt = now;
  }
  if (bucket.tokens < 1) {
    throw new RateLimitError();
  }
  bucket.tokens -= 1;
}

/** Best-effort client IP for unauthenticated rate limiting. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? "unknown";
  return request.headers.get("x-real-ip") ?? "unknown";
}

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------

/** Parse a JSON request body against a zod schema. Invalid JSON → 400. */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
  return schema.parse(raw);
}

// ---------------------------------------------------------------------------
// Auth wrapper
// ---------------------------------------------------------------------------

export interface ApiAuthOptions {
  /** Per-actor rate limit (default: 60 req/min). Set to false to disable. */
  rateLimit?: { limit?: number; windowMs?: number } | false;
}

type RouteContext<P> = { params: Promise<P> };

/**
 * Wrap a `/api/v1` handler with authentication, rate limiting and uniform
 * error mapping. Auth order: agent Bearer key (`awa_...`) first, then the
 * Auth.js web session — both resolve to the same `Actor` abstraction.
 * The handler receives `(request, actor, ctx)`; `ctx.params` stays a Promise
 * and must be awaited (Next.js 15).
 */
export function withApiAuth<P = Record<string, never>>(
  handler: (
    request: Request,
    actor: Actor,
    ctx: RouteContext<P>,
  ) => Promise<Response>,
  opts?: ApiAuthOptions,
) {
  return async (request: Request, ctx: RouteContext<P>): Promise<Response> => {
    try {
      const actor = (await getAgentActor(request)) ?? (await getActor());
      if (!actor) throw new UnauthorizedError();

      const rl = opts?.rateLimit;
      if (rl !== false) {
        rateLimit(`${actor.type}:${actor.id}`, rl?.limit ?? 60, rl?.windowMs ?? 60_000);
      }

      return await handler(request, actor, ctx);
    } catch (error) {
      return mapApiError(error);
    }
  };
}

/** Map any thrown error to the uniform `{error:{code,message}}` shape. */
export function mapApiError(error: unknown): NextResponse {
  if (error instanceof UnauthorizedError) {
    return jsonError(401, "UNAUTHORIZED", error.message);
  }
  if (error instanceof ForbiddenError) {
    return jsonError(403, "FORBIDDEN", error.message);
  }
  if (error instanceof RateLimitError) {
    return jsonError(429, "RATE_LIMITED", error.message);
  }
  if (error instanceof HttpError) {
    return jsonError(error.status, error.code, error.message);
  }
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const where = issue?.path.join(".") ?? "";
    return jsonError(
      400,
      "VALIDATION_ERROR",
      where ? `${where}: ${issue?.message ?? "invalid"}` : (issue?.message ?? "Invalid request"),
    );
  }
  console.error("Unhandled API error", error);
  return jsonError(500, "INTERNAL", "Internal server error");
}
