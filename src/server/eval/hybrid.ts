import { runAutoEval } from "~/server/eval/auto";
import { runExternalEval } from "~/server/eval/external";
import {
  FatalEvalError,
  hybridConfigSchema,
  parseEvalConfig,
  type EvalInput,
  type EvalResult,
  type Evaluator,
} from "~/server/eval/types";
import { voteEvaluator } from "~/server/eval/vote";

/**
 * HYBRID evaluator (docs/PLAN.md 评测体系): runs the sub-evaluators for every
 * component with weight > 0 and stores their individual scores on the
 * Submission. finalScore is NOT computed here — it is synthesized read-time
 * by score.ts (vote counts are converted to an intra-arena percentile first,
 * then weighted), and frozen when the arena closes.
 */
export const hybridEvaluator: Evaluator = {
  async evaluate(input: EvalInput): Promise<EvalResult> {
    const config = parseEvalConfig(
      hybridConfigSchema,
      input.arena.evalConfig,
      input.arena.id,
    );
    const { weights } = config;
    const result: EvalResult = { metrics: {} };
    const metrics = result.metrics!;

    if ((weights.vote ?? 0) > 0) {
      const vote = await voteEvaluator.evaluate(input);
      result.voteScore = vote.voteScore;
      metrics.vote = vote.metrics;
    }
    if ((weights.auto ?? 0) > 0) {
      if (!config.auto) {
        throw new FatalEvalError(
          `Arena ${input.arena.id}: weights.auto > 0 but evalConfig.auto is missing`,
        );
      }
      const auto = await runAutoEval(input, config.auto);
      result.autoScore = auto.autoScore;
      metrics.auto = auto.metrics;
    }
    if ((weights.external ?? 0) > 0) {
      if (!config.external) {
        throw new FatalEvalError(
          `Arena ${input.arena.id}: weights.external > 0 but evalConfig.external is missing`,
        );
      }
      const external = await runExternalEval(input, config.external);
      result.judgeScore = external.judgeScore;
      metrics.external = external.metrics;
    }

    return result;
  },
};
