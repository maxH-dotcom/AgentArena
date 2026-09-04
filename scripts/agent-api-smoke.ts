/**
 * Smoke test for the Agent identity + /api/v1 infrastructure.
 *
 * Two parts:
 *  A. Function-level (always runs): db + agent-keys full chain (generate key →
 *     store hash → look up by hash like getAgentActor does) and zod assertions
 *     on the register schema.
 *  B. HTTP end-to-end (when BASE_URL is reachable, default http://localhost:3000):
 *     register → me (GET/PATCH) → public profile → agent card → well-known card,
 *     plus 400/401/404/409 error shapes. Requires `pnpm dev` running.
 *
 * Run: `tsx scripts/agent-api-smoke.ts`  (optionally BASE_URL=http://host:port)
 */

import { PrismaClient } from "../generated/prisma";
import {
  generateAgentApiKey,
  hashApiKey,
  isAgentApiKeyFormat,
} from "../src/server/agent-keys";

process.env.DATABASE_URL ??= "file:./db.sqlite";
process.env.SKIP_ENV_VALIDATION ??= "1";
process.env.APP_URL ??= "https://novax.bond";

const db = new PrismaClient();
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

let passed = 0;
function assert(cond: boolean, label: string) {
  if (!cond) {
    console.error(`FAIL  ${label}`);
    process.exitCode = 1;
  } else {
    passed++;
    console.log(`ok    ${label}`);
  }
}

async function partA() {
  console.log("\n--- A. db + agent-keys chain + register schema ---");

  // agent-keys: generate → format → hash → DB round-trip (mirrors getAgentActor)
  const { key, hash } = generateAgentApiKey();
  assert(isAgentApiKeyFormat(key), "generated key has awa_ format");
  assert(hash === hashApiKey(key), "hashApiKey is deterministic");

  const name = `smoke-db-${Date.now()}`;
  const agent = await db.agent.create({
    data: { name, apiKeyHash: hash, agentCard: "{}" },
  });
  const found = await db.agent.findFirst({
    where: { apiKeyHash: hashApiKey(key), deletedAt: null },
  });
  assert(found?.id === agent.id, "agent found by apiKeyHash (getAgentActor path)");
  assert(!("apiKey" in (found ?? {})), "plaintext key is never stored");
  await db.agent.delete({ where: { id: agent.id } });
  assert(true, "temp agent cleaned up");

  // register zod schema assertions
  const { registerSchema, buildDefaultAgentCard } = await import(
    "../src/server/agent-registration"
  );
  assert(registerSchema.safeParse({ name: "ab" }).success === false, "name < 3 chars rejected");
  assert(
    registerSchema.safeParse({ name: "x".repeat(33) }).success === false,
    "name > 32 chars rejected",
  );
  assert(
    registerSchema.safeParse({ name: "ok-name", a2aEndpoint: "ftp://nope" }).success === false,
    "non-http(s) a2aEndpoint rejected",
  );
  assert(
    registerSchema.safeParse({ name: "ok-name", a2aEndpoint: "https://agent.example.com" })
      .success === true,
    "valid body accepted",
  );
  const card = buildDefaultAgentCard({ id: "abc", name: "ok-name" });
  assert(Array.isArray(card.skills) && card.skills.length === 0, "default card skills = []");
  assert(
    (card.securitySchemes as Record<string, unknown>).bearer !== undefined,
    "default card has bearer securityScheme",
  );
  assert(
    card.url === `${process.env.APP_URL}/agents/abc`,
    "default card url = APP_URL/agents/:id",
  );
}

async function partB() {
  console.log(`\n--- B. HTTP end-to-end against ${BASE_URL} ---`);
  let up = false;
  try {
    await fetch(`${BASE_URL}/api/v1/agents/nope`, { signal: AbortSignal.timeout(3000) });
    up = true;
  } catch {
    console.log(`skip  no server at ${BASE_URL} (start with \`pnpm dev\`)`);
  }
  if (!up) return;

  const name = `smoke-http-${Date.now()}`;
  let id = "";
  let apiKey = "";
  try {
    // register
    const reg = await fetch(`${BASE_URL}/api/v1/agents/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, description: "smoke test agent" }),
    });
    const regBody = (await reg.json()) as {
      id?: string;
      apiKey?: string;
      agentCard?: { url?: string };
      error?: { code?: string };
    };
    assert(reg.status === 201, "register → 201");
    id = regBody.id ?? "";
    apiKey = regBody.apiKey ?? "";
    assert(apiKey.startsWith("awa_"), "register returns awa_ apiKey");
    assert(
      regBody.agentCard?.url?.includes(`/agents/${id}`) ?? false,
      "register returns platform-generated agentCard",
    );

    // register: duplicate name → 409
    const dup = await fetch(`${BASE_URL}/api/v1/agents/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const dupBody = (await dup.json()) as { error?: { code?: string; message?: string } };
    assert(dup.status === 409 && dupBody.error?.code === "NAME_TAKEN", "duplicate name → 409");

    // register: invalid body → 400 uniform error shape
    const bad = await fetch(`${BASE_URL}/api/v1/agents/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ab" }),
    });
    const badBody = (await bad.json()) as { error?: { code?: string } };
    assert(
      bad.status === 400 && badBody.error?.code === "VALIDATION_ERROR",
      "invalid body → 400 {error:{code}}",
    );

    // me without auth → 401
    const noAuth = await fetch(`${BASE_URL}/api/v1/agents/me`);
    assert(noAuth.status === 401, "me without Bearer → 401");

    const authHeaders = { authorization: `Bearer ${apiKey}` };

    // me with Bearer
    const me = await fetch(`${BASE_URL}/api/v1/agents/me`, { headers: authHeaders });
    const meBody = (await me.json()) as Record<string, unknown>;
    assert(me.status === 200 && meBody.id === id, "me → 200 own profile");
    assert(!("apiKeyHash" in meBody), "profile never leaks apiKeyHash");

    // PATCH me
    const patch = await fetch(`${BASE_URL}/api/v1/agents/me`, {
      method: "PATCH",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify({ description: "updated by smoke", isPublic: false }),
    });
    const patchBody = (await patch.json()) as { description?: string; isPublic?: boolean };
    assert(
      patch.status === 200 && patchBody.description === "updated by smoke" && patchBody.isPublic === false,
      "PATCH me updates description/isPublic",
    );

    // private profile → 404 for anonymous, 200 for self
    const anon = await fetch(`${BASE_URL}/api/v1/agents/${id}`);
    assert(anon.status === 404, "non-public profile → 404 anonymous");
    const self = await fetch(`${BASE_URL}/api/v1/agents/${id}`, { headers: authHeaders });
    assert(self.status === 200, "non-public profile → 200 for self");

    // back to public
    await fetch(`${BASE_URL}/api/v1/agents/me`, {
      method: "PATCH",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify({ isPublic: true }),
    });

    // public profile + card
    const pub = await fetch(`${BASE_URL}/api/v1/agents/${id}`);
    const pubBody = (await pub.json()) as { name?: string };
    assert(pub.status === 200 && pubBody.name === name, "public profile → 200");
    assert(!("apiKeyHash" in pubBody), "public profile has no apiKeyHash");

    const cardRes = await fetch(`${BASE_URL}/api/v1/agents/${id}/card`);
    const cardBody = (await cardRes.json()) as { name?: string; url?: string };
    assert(
      cardRes.status === 200 && cardBody.name === name && (cardBody.url ?? "").includes(`/agents/${id}`),
      "agent card → 200 with deployment url",
    );

    // platform well-known card
    const wellKnown = await fetch(`${BASE_URL}/.well-known/agent-card.json`);
    const wellKnownBody = (await wellKnown.json()) as { name?: string; documentationUrl?: string };
    assert(
      wellKnown.status === 200 && wellKnownBody.name === "AgentArena",
      "platform agent-card.json → 200",
    );
    assert(
      (wellKnownBody.documentationUrl ?? "").endsWith("/docs/api"),
      "platform card points at /docs/api",
    );
  } finally {
    if (id) {
      await db.agent.deleteMany({ where: { id } });
      console.log("ok    smoke agent cleaned up");
    }
  }
}

await partA();
await partB();
await db.$disconnect();
console.log(`\n${passed} checks passed${process.exitCode ? ", but some FAILED" : ""}`);
