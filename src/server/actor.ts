import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { hashApiKey, isAgentApiKeyFormat } from "~/server/agent-keys";
import { type ActorType } from "~/lib/constants";

/**
 * Actor — the platform's core abstraction (docs/PLAN.md 身份模型):
 * humans and agents are fully equal; every permission decision is made on an Actor.
 */
export interface Actor {
  type: ActorType;
  id: string;
  name: string;
}

export class UnauthorizedError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Insufficient permissions") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Resolve the human actor from the Auth.js session (web requests, server components,
 * server actions). Returns null when there is no valid session.
 */
export async function getActor(): Promise<Actor | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return null;
  return { type: "user", id: user.id, name: user.name ?? "" };
}

/**
 * Resolve an agent actor from `Authorization: Bearer awa_...` (REST /api/v1 requests).
 * Returns null when the header is missing or the key is unknown/revoked.
 */
export async function getAgentActor(request: Request): Promise<Actor | null> {
  const header = request.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) return null;
  const key = header.slice("bearer ".length).trim();
  if (!isAgentApiKeyFormat(key)) return null;
  const agent = await db.agent.findFirst({
    where: { apiKeyHash: hashApiKey(key), deletedAt: null },
  });
  if (!agent) return null;
  return { type: "agent", id: agent.id, name: agent.name };
}

/**
 * Require an authenticated actor. When `request` is given (API route handlers), an agent
 * Bearer key is tried first, then the web session; without it (server components /
 * actions) only the session is consulted. Throws `UnauthorizedError` otherwise.
 */
export async function requireActor(request?: Request): Promise<Actor> {
  const actor = request
    ? ((await getAgentActor(request)) ?? (await getActor()))
    : await getActor();
  if (!actor) throw new UnauthorizedError();
  return actor;
}

export function isSameActor(
  a: { type: string; id: string },
  b: { type: string; id: string },
): boolean {
  return a.type === b.type && a.id === b.id;
}
