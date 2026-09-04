"use server";

import { getActor } from "~/server/actor";
import { generateAgentApiKey } from "~/server/agent-keys";
import {
  buildDefaultAgentCard,
  registerSchema,
} from "~/server/agent-registration";
import { db } from "~/server/db";

/**
 * Agent server actions backing the /agents page (web channel).
 * Unlike the anonymous REST registration endpoint, the web flow binds the
 * created agent to the session user as owner (contact / key-reset fallback).
 * Return values carry stable error keys; the UI maps them to translated
 * messages under `agents.errors`.
 */

export type AgentActionResult =
  | { ok: true; agentId: string; apiKey: string }
  | { ok: false; error: AgentErrorKey };

export type AgentErrorKey =
  | "unauthorized"
  | "invalidInput"
  | "nameTaken"
  | "notFound"
  | "forbidden"
  | "serverError";

export async function registerAgent(input: {
  name: string;
  description: string;
  a2aEndpoint: string;
}): Promise<AgentActionResult> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: "unauthorized" };

  const parsed = registerSchema.safeParse({
    name: input.name,
    description: input.description === "" ? undefined : input.description,
    a2aEndpoint: input.a2aEndpoint === "" ? undefined : input.a2aEndpoint,
  });
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  try {
    const nameClash = await db.agent.findFirst({
      where: { name: parsed.data.name, deletedAt: null },
      select: { id: true },
    });
    if (nameClash) return { ok: false, error: "nameTaken" };

    const { key, hash } = generateAgentApiKey();

    const created = await db.agent.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description,
        a2aEndpoint: parsed.data.a2aEndpoint,
        apiKeyHash: hash,
        ownerId: actor.id,
        agentCard: "{}",
      },
    });

    const card = buildDefaultAgentCard({
      id: created.id,
      name: created.name,
      description: created.description ?? undefined,
      a2aEndpoint: created.a2aEndpoint ?? undefined,
    });
    await db.agent.update({
      where: { id: created.id },
      data: { agentCard: JSON.stringify(card) },
    });

    return { ok: true, agentId: created.id, apiKey: key };
  } catch (e) {
    console.error("registerAgent failed", e);
    return { ok: false, error: "serverError" };
  }
}

/**
 * Regenerate the API key of an agent owned by the session user.
 * The old key stops working immediately; the new plaintext key is returned
 * exactly once and only its SHA-256 hash is stored.
 */
export async function resetAgentKey(agentId: string): Promise<AgentActionResult> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: "unauthorized" };

  try {
    const agent = await db.agent.findFirst({
      where: { id: agentId, deletedAt: null },
    });
    if (!agent) return { ok: false, error: "notFound" };
    if (agent.ownerId !== actor.id) return { ok: false, error: "forbidden" };

    const { key, hash } = generateAgentApiKey();
    await db.agent.update({
      where: { id: agent.id },
      data: { apiKeyHash: hash },
    });

    return { ok: true, agentId: agent.id, apiKey: key };
  } catch (e) {
    console.error("resetAgentKey failed", e);
    return { ok: false, error: "serverError" };
  }
}
