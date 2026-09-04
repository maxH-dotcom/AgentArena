import { db } from "~/server/db";
import type { EvalMode } from "~/lib/constants";
import { parseJson, type HybridWeights } from "~/server/eval/types";
import { computeVoteScores } from "~/server/eval/vote";

/**
 * finalScore synthesis (docs/PLAN.md 架构评审调整 #3):
 * while an arena is OPEN, finalScore is computed read-time — for HYBRID the
 * vote counts are first converted to an intra-arena percentile, then weighted.
 * When the arena CLOSED, `freezeArenaScores()` writes the value back to each
 * Submission (see settle.ts).
 *
 * Missing component scores (e.g. a failed AUTO run) count as 0 but their
 * weight still counts toward the denominator; the result is null only when
 * no component has any score at all.
 */

export interface ScoreParts {
  voteScore: number | null;
  autoScore: number | null;
  judgeScore: number | null;
}

export interface LiveScore extends ScoreParts {
  submissionId: string;
  entryId: string;
  votes: number;
  finalScore: number | null;
  createdAt: Date;
}

/** Pure synthesis of one submission's finalScore from its component scores. */
export function synthesizeFinalScore(
  evalMode: string,
  weights: HybridWeights,
  parts: ScoreParts,
): number | null {
  switch (evalMode as EvalMode) {
    case "VOTE":
      return parts.voteScore;
    case "AUTO":
      return parts.autoScore;
    case "EXTERNAL":
      return parts.judgeScore;
    case "HYBRID": {
      let numerator = 0;
      let denominator = 0;
      let anyScore = false;
      const add = (weight: number | undefined, score: number | null) => {
        if (!weight || weight <= 0) return;
        denominator += weight;
        if (score !== null) {
          numerator += weight * score;
          anyScore = true;
        }
      };
      add(weights.vote, parts.voteScore);
      add(weights.auto, parts.autoScore);
      add(weights.external, parts.judgeScore);
      return denominator > 0 && anyScore ? numerator / denominator : null;
    }
    // DUEL ranks by match wins in the duel module, not by finalScore.
    default:
      return null;
  }
}

/**
 * Read-time synthesis for every submission of an arena: fresh vote
 * percentiles from the Vote table + stored auto/judge scores.
 */
export async function computeLiveScores(arenaId: string): Promise<LiveScore[]> {
  const arena = await db.arena.findUnique({ where: { id: arenaId } });
  if (!arena) throw new Error(`Arena ${arenaId} not found`);

  const submissions = await db.submission.findMany({
    where: { entry: { arenaId } },
    select: {
      id: true,
      entryId: true,
      autoScore: true,
      judgeScore: true,
      createdAt: true,
    },
  });
  const tallies = await computeVoteScores(arenaId);

  // Weights are read leniently: an unparseable HYBRID config means no weights.
  const weights =
    arena.evalMode === "HYBRID"
      ? (parseJson<{ weights?: HybridWeights }>(arena.evalConfig, {}).weights ??
        {})
      : {};

  return submissions.map((s) => {
    const tally = tallies.get(s.id);
    const parts: ScoreParts = {
      voteScore: tally?.voteScore ?? 0,
      autoScore: s.autoScore,
      judgeScore: s.judgeScore,
    };
    return {
      submissionId: s.id,
      entryId: s.entryId,
      votes: tally?.votes ?? 0,
      createdAt: s.createdAt,
      ...parts,
      finalScore: synthesizeFinalScore(arena.evalMode, weights, parts),
    };
  });
}

/**
 * Freeze read-time scores onto the Submission rows (called when an arena
 * closes). Also persists the final vote percentile snapshot. Returns the
 * number of submissions frozen.
 */
export async function freezeArenaScores(arenaId: string): Promise<number> {
  const live = await computeLiveScores(arenaId);
  await db.$transaction(
    live.map((s) =>
      db.submission.update({
        where: { id: s.submissionId },
        data: { voteScore: s.voteScore, finalScore: s.finalScore },
      }),
    ),
  );
  return live.length;
}
