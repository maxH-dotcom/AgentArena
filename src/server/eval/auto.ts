import { z } from "zod";

import {
  FatalEvalError,
  autoConfigSchema,
  parseEvalConfig,
  postJson,
  type AutoConfig,
  type AutoMatchRule,
  type EvalInput,
  type EvalResult,
  type Evaluator,
} from "~/server/eval/types";

/**
 * AUTO evaluator (docs/PLAN.md 评测体系): built-in rule-based evaluation.
 *
 * HTTP contract (plain HTTP this iteration, A2A Task is a later upgrade):
 *   POST {endpoint}            { taskId, cases: [{ input, expected, match }] }
 *   → 200 application/json     { answers: string[] }  (one answer per case, in order)
 *
 * `endpoint` = evalConfig.endpoint ?? entry.a2aEndpoint; an entry with neither
 * is a fatal error (job marked FAILED, no retry).
 *
 * autoScore = matched cases / total cases * 100.
 */

const autoResponseSchema = z.object({
  answers: z.array(z.string()),
});

/** Compare one answer against the expected value per the match rule. */
export function matchAnswer(
  match: AutoMatchRule,
  expected: string,
  actual: string,
): boolean {
  switch (match) {
    case "exact":
      return actual === expected;
    case "contains":
      return actual.includes(expected);
    case "regex":
      try {
        return new RegExp(expected).test(actual);
      } catch {
        // An invalid pattern never matches; surfaced via metrics.caseErrors.
        return false;
      }
  }
}

export async function runAutoEval(
  input: EvalInput,
  config: AutoConfig,
): Promise<EvalResult> {
  const { entry, submission } = input;
  const endpoint = config.endpoint ?? entry.a2aEndpoint;
  if (!endpoint) {
    throw new FatalEvalError(
      `Entry ${entry.id} has no endpoint (neither evalConfig.endpoint nor entry.a2aEndpoint)`,
    );
  }

  const taskId = `eval-${submission.id}`;
  const startedAt = Date.now();
  const raw = await postJson(
    endpoint,
    { taskId, cases: config.cases },
    config.timeoutMs,
  );
  const latencyMs = Date.now() - startedAt;

  const parsed = autoResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Endpoint ${endpoint} returned an invalid payload (expected { answers: string[] })`);
  }
  const { answers } = parsed.data;
  if (answers.length !== config.cases.length) {
    throw new Error(
      `Endpoint ${endpoint} returned ${answers.length} answers for ${config.cases.length} cases`,
    );
  }

  const caseResults = config.cases.map((c, i) => ({
    input: c.input,
    expected: c.expected,
    match: c.match,
    actual: answers[i]!,
    matched: matchAnswer(c.match, c.expected, answers[i]!),
  }));
  const matchedCases = caseResults.filter((c) => c.matched).length;
  const totalCases = config.cases.length;

  return {
    autoScore: (matchedCases / totalCases) * 100,
    metrics: {
      taskId,
      endpoint,
      latencyMs,
      matchedCases,
      totalCases,
      cases: caseResults,
    },
  };
}

export const autoEvaluator: Evaluator = {
  evaluate(input: EvalInput): Promise<EvalResult> {
    const config = parseEvalConfig(
      autoConfigSchema,
      input.arena.evalConfig,
      input.arena.id,
    );
    return runAutoEval(input, config);
  },
};
