import type { EvalJob } from "../../../generated/prisma";
import type { EvalMode } from "~/lib/constants";
import { db } from "~/server/db";
import { autoEvaluator } from "~/server/eval/auto";
import { externalEvaluator } from "~/server/eval/external";
import { hybridEvaluator } from "~/server/eval/hybrid";
import { FatalEvalError, type Evaluator } from "~/server/eval/types";
import { voteEvaluator } from "~/server/eval/vote";

/**
 * EvalJob serial worker (docs/PLAN.md 架构评审调整 #1):
 * PENDING → RUNNING → DONE / FAILED. Jobs are claimed with an optimistic
 * lock (updateMany on the PENDING status) so multiple workers never run the
 * same job. Retryable failures go back to PENDING until MAX_ATTEMPTS, then
 * FAILED with lastError; FatalEvalError fails immediately.
 */

export const MAX_EVAL_ATTEMPTS = 3;

const evaluators: Partial<Record<EvalMode, Evaluator>> = {
  VOTE: voteEvaluator,
  AUTO: autoEvaluator,
  EXTERNAL: externalEvaluator,
  HYBRID: hybridEvaluator,
  // DUEL settles via the duel module; no evaluator here.
};

/**
 * Atomically claim the oldest PENDING job (PENDING → RUNNING, attempts + 1).
 * Returns null when no pending job exists; retries internally if another
 * worker wins the race for the same row.
 */
export async function claimPendingJob(): Promise<EvalJob | null> {
  for (;;) {
    const candidate = await db.evalJob.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });
    if (!candidate) return null;
    const claimed = await db.evalJob.updateMany({
      where: { id: candidate.id, status: "PENDING" },
      data: { status: "RUNNING", attempts: { increment: 1 } },
    });
    if (claimed.count === 1) {
      return { ...candidate, status: "RUNNING", attempts: candidate.attempts + 1 };
    }
    // Lost the race — look for the next pending job.
  }
}

export type JobOutcome = "DONE" | "RETRY" | "FAILED";

/** Execute one claimed job and persist the outcome. */
export async function runJob(job: EvalJob): Promise<JobOutcome> {
  try {
    const submission = await db.submission.findUnique({
      where: { id: job.submissionId },
      include: { entry: { include: { arena: true } } },
    });
    if (!submission) {
      throw new FatalEvalError(`Submission ${job.submissionId} not found`);
    }
    const entry = submission.entry;
    const arena = entry.arena;
    const evaluator = evaluators[arena.evalMode as EvalMode];
    if (!evaluator) {
      throw new FatalEvalError(`No evaluator for evalMode ${arena.evalMode}`);
    }

    const result = await evaluator.evaluate({ arena, entry, submission });

    await db.$transaction([
      db.submission.update({
        where: { id: submission.id },
        data: {
          ...(result.autoScore !== undefined
            ? { autoScore: result.autoScore }
            : {}),
          ...(result.judgeScore !== undefined
            ? { judgeScore: result.judgeScore }
            : {}),
          ...(result.voteScore !== undefined
            ? { voteScore: result.voteScore }
            : {}),
          ...(result.metrics !== undefined
            ? { metrics: JSON.stringify(result.metrics) }
            : {}),
        },
      }),
      db.evalJob.update({
        where: { id: job.id },
        data: { status: "DONE", lastError: null },
      }),
    ]);
    return "DONE";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable =
      !(error instanceof FatalEvalError) && job.attempts < MAX_EVAL_ATTEMPTS;
    await db.evalJob.update({
      where: { id: job.id },
      data: {
        status: retryable ? "PENDING" : "FAILED",
        lastError: message.slice(0, 500),
      },
    });
    return retryable ? "RETRY" : "FAILED";
  }
}

export interface ProcessStats {
  processed: number;
  done: number;
  failed: number;
  retried: number;
}

/** Claim and run jobs until no PENDING job remains. */
export async function processAll(): Promise<ProcessStats> {
  const stats: ProcessStats = { processed: 0, done: 0, failed: 0, retried: 0 };
  for (;;) {
    const job = await claimPendingJob();
    if (!job) break;
    const outcome = await runJob(job);
    stats.processed += 1;
    if (outcome === "DONE") stats.done += 1;
    else if (outcome === "FAILED") stats.failed += 1;
    else stats.retried += 1;
  }
  return stats;
}
