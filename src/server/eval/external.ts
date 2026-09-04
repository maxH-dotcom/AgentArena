import { z } from "zod";

import {
  externalConfigSchema,
  parseEvalConfig,
  parseJson,
  postJson,
  type EvalInput,
  type EvalResult,
  type Evaluator,
  type ExternalConfig,
} from "~/server/eval/types";

/**
 * EXTERNAL evaluator (docs/PLAN.md 评测体系): the arena creator hosts the
 * judge; the platform only schedules, enforces the timeout (≤30s), retries,
 * and records the result.
 *
 * HTTP contract:
 *   POST {judgeUrl}  { submissionId, content, mediaUrl, artifact }
 *   → 200 application/json  { score: number (0-100), feedback?: string }
 */

const judgeResponseSchema = z.object({
  score: z.number().min(0).max(100),
  feedback: z.string().optional(),
});

export async function runExternalEval(
  input: EvalInput,
  config: ExternalConfig,
): Promise<EvalResult> {
  const { submission } = input;
  const startedAt = Date.now();
  const raw = await postJson(
    config.judgeUrl,
    {
      submissionId: submission.id,
      content: submission.content,
      mediaUrl: submission.mediaUrl,
      artifact: parseJson<unknown>(submission.artifact, null),
    },
    config.timeoutMs,
  );
  const latencyMs = Date.now() - startedAt;

  const parsed = judgeResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Judge ${config.judgeUrl} returned an invalid payload (expected { score: 0-100, feedback? })`,
    );
  }

  return {
    judgeScore: parsed.data.score,
    metrics: {
      judgeUrl: config.judgeUrl,
      latencyMs,
      feedback: parsed.data.feedback ?? null,
    },
  };
}

export const externalEvaluator: Evaluator = {
  evaluate(input: EvalInput): Promise<EvalResult> {
    const config = parseEvalConfig(
      externalConfigSchema,
      input.arena.evalConfig,
      input.arena.id,
    );
    return runExternalEval(input, config);
  },
};
