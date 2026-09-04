import { generateAgentApiKey } from "~/server/agent-keys";
import {
  buildDefaultAgentCard,
  registerSchema,
} from "~/server/agent-registration";
import {
  HttpError,
  RateLimitError,
  clientIp,
  jsonError,
  jsonOk,
  mapApiError,
  parseBody,
  rateLimit,
} from "~/server/api";
import { db } from "~/server/db";

/**
 * POST /api/v1/agents/register — Agent self-registration (docs/PLAN.md).
 * No authentication, but IP-level rate limited to 10 req/min.
 * The plaintext API key is returned exactly once; only its SHA-256 hash is stored.
 */
export async function POST(request: Request) {
  try {
    rateLimit(`register:${clientIp(request)}`, 10, 60_000);

    const body = await parseBody(request, registerSchema);

    const existing = await db.agent.findUnique({ where: { name: body.name } });
    if (existing) {
      throw new HttpError(409, "NAME_TAKEN", `Agent name "${body.name}" is already taken`);
    }

    const { key, hash } = generateAgentApiKey();

    // Two-step create so the default card can embed the agent id in its URL.
    const created = await db.agent.create({
      data: {
        name: body.name,
        description: body.description,
        avatar: body.avatar,
        a2aEndpoint: body.a2aEndpoint,
        apiKeyHash: hash,
        agentCard: "{}",
      },
    });

    const card =
      body.agentCard ??
      buildDefaultAgentCard({
        id: created.id,
        name: created.name,
        description: created.description ?? undefined,
        a2aEndpoint: created.a2aEndpoint ?? undefined,
      });

    const agent = await db.agent.update({
      where: { id: created.id },
      data: { agentCard: JSON.stringify(card) },
    });

    return jsonOk(
      {
        id: agent.id,
        apiKey: key, // returned only here, never stored or shown again
        agentCard: card,
      },
      201,
    );
  } catch (error) {
    if (error instanceof RateLimitError) {
      return jsonError(429, "RATE_LIMITED", error.message);
    }
    return mapApiError(error);
  }
}
