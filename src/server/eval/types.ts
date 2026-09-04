import { z } from "zod";

import type { Arena, Entry, Submission } from "../../../generated/prisma";
import type { EvalMode } from "~/lib/constants";

/**
 * Evaluation subsystem — shared types (docs/PLAN.md 评测体系, 架构评审调整 #5).
 *
 * Every evalMode has an `Evaluator` implementation; the EvalJob worker calls
 * `evaluate()` and persists the returned scores on the Submission. HYBRID's
 * finalScore is synthesized read-time (see score.ts), not by the evaluator.
 */

/** Tolerant JSON parse for the String-typed JSON columns (evalConfig / artifact / metrics / payload). */
export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Permanent failure — the worker marks the job FAILED immediately without
 * retrying (bad evalConfig, entry without an endpoint, unknown evalMode).
 */
export class FatalEvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalEvalError";
  }
}

export interface EvalInput {
  arena: Arena;
  entry: Entry;
  submission: Submission;
}

export interface EvalResult {
  autoScore?: number | null;
  judgeScore?: number | null;
  voteScore?: number | null;
  metrics?: Record<string, unknown>;
}

export interface Evaluator {
  evaluate(input: EvalInput): Promise<EvalResult>;
}

// ---------------------------------------------------------------------------
// evalConfig schemas per evalMode
// ---------------------------------------------------------------------------

export const AUTO_MATCH_RULES = ["exact", "contains", "regex"] as const;
export type AutoMatchRule = (typeof AUTO_MATCH_RULES)[number];

const httpUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith("http://") || u.startsWith("https://"), {
    message: "must be an http(s) URL",
  });

/** VOTE: no configuration needed (tolerant of extra keys). */
export const voteConfigSchema = z.object({}).passthrough();
export type VoteConfig = z.infer<typeof voteConfigSchema>;

/**
 * AUTO: test cases are POSTed to the entry's endpoint
 * (`evalConfig.endpoint` overrides the entry's a2aEndpoint snapshot).
 */
export const autoConfigSchema = z.object({
  endpoint: httpUrl.optional(),
  cases: z
    .array(
      z.object({
        input: z.string(),
        expected: z.string(),
        match: z.enum(AUTO_MATCH_RULES),
      }),
    )
    .min(1),
  timeoutMs: z.number().int().positive().max(60_000).default(10_000),
});
export type AutoConfig = z.infer<typeof autoConfigSchema>;

/** EXTERNAL: judge endpoint hosted by the arena creator; 30s timeout cap. */
export const externalConfigSchema = z.object({
  judgeUrl: httpUrl,
  timeoutMs: z.number().int().positive().max(30_000).default(30_000),
});
export type ExternalConfig = z.infer<typeof externalConfigSchema>;

export const hybridWeightsSchema = z
  .object({
    vote: z.number().min(0).optional(),
    auto: z.number().min(0).optional(),
    external: z.number().min(0).optional(),
  })
  .refine((w) => (w.vote ?? 0) + (w.auto ?? 0) + (w.external ?? 0) > 0, {
    message: "at least one weight must be > 0",
  });
export type HybridWeights = z.infer<typeof hybridWeightsSchema>;

/** HYBRID: weights over sub-scores; weighted components need their own config. */
export const hybridConfigSchema = z
  .object({
    weights: hybridWeightsSchema,
    auto: autoConfigSchema.optional(),
    external: externalConfigSchema.optional(),
  })
  .refine((c) => !((c.weights.auto ?? 0) > 0) || !!c.auto, {
    message: "weights.auto > 0 requires an `auto` config",
  })
  .refine((c) => !((c.weights.external ?? 0) > 0) || !!c.external, {
    message: "weights.external > 0 requires an `external` config",
  });
export type HybridConfig = z.infer<typeof hybridConfigSchema>;

export const evalConfigSchemas: Record<EvalMode, z.ZodTypeAny> = {
  VOTE: voteConfigSchema,
  AUTO: autoConfigSchema,
  EXTERNAL: externalConfigSchema,
  HYBRID: hybridConfigSchema,
  // DUEL settles via the duel module, not the eval subsystem.
  DUEL: z.object({}).passthrough(),
};

/** Parse + validate an arena's serialized evalConfig; invalid config is a fatal error. */
export function parseEvalConfig<S extends z.ZodTypeAny>(
  schema: S,
  raw: string | null | undefined,
  arenaId: string,
): z.infer<S> {
  const parsed = schema.safeParse(parseJson<unknown>(raw, {}));
  if (!parsed.success) {
    throw new FatalEvalError(
      `Invalid evalConfig for arena ${arenaId}: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data as z.infer<S>;
}

/**
 * POST a JSON body with a timeout; returns the parsed JSON response.
 * Throws on non-2xx, invalid JSON, or timeout (retryable by the worker).
 */
export async function postJson(
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 200)}`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Invalid JSON response from ${url}: ${text.slice(0, 200)}`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Timeout after ${timeoutMs}ms calling ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
