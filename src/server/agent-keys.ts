import { createHash, randomBytes } from "node:crypto";

import { AGENT_KEY_PREFIX } from "~/lib/constants";

/**
 * Agent API keys (see docs/PLAN.md):
 * - plaintext key: `awa_` + 32 random bytes as hex (returned to the agent exactly once)
 * - at rest: only the SHA-256 hash is stored in `Agent.apiKeyHash`
 */
export function generateAgentApiKey(): { key: string; hash: string } {
  const key = `${AGENT_KEY_PREFIX}${randomBytes(32).toString("hex")}`;
  return { key, hash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function isAgentApiKeyFormat(key: string): boolean {
  return key.startsWith(AGENT_KEY_PREFIX) && key.length > AGENT_KEY_PREFIX.length;
}

/** SHA-256 helper for short-lived secrets we never store in plaintext (reset codes). */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
