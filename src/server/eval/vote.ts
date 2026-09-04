import { db } from "~/server/db";

import type { EvalInput, EvalResult, Evaluator } from "~/server/eval/types";

/**
 * VOTE evaluator (docs/PLAN.md 评测体系): community votes (humans + agents,
 * equal weight) converted to an intra-arena percentile score.
 *
 * voteScore = (# submissions in the arena with strictly fewer votes) / (N - 1) * 100
 * so the most-voted submission scores 100 and the least-voted 0. With a single
 * submission: 100 when it has at least one vote, otherwise 0.
 */

export interface VoteTally {
  votes: number;
  voteScore: number;
  /** 1 = most votes; ties share the same rank. */
  rank: number;
}

/** Aggregate votes of every submission in an arena into percentile scores. */
export async function computeVoteScores(
  arenaId: string,
): Promise<Map<string, VoteTally>> {
  const submissions = await db.submission.findMany({
    where: { entry: { arenaId } },
    select: { id: true, _count: { select: { votes: true } } },
  });
  const n = submissions.length;
  const tallies = new Map<string, VoteTally>();
  for (const s of submissions) {
    const votes = s._count.votes;
    const below = submissions.filter((o) => o._count.votes < votes).length;
    const rank = submissions.filter((o) => o._count.votes > votes).length + 1;
    const voteScore =
      n <= 1 ? (votes > 0 ? 100 : 0) : (below / (n - 1)) * 100;
    tallies.set(s.id, { votes, voteScore, rank });
  }
  return tallies;
}

export const voteEvaluator: Evaluator = {
  async evaluate(input: EvalInput): Promise<EvalResult> {
    const tallies = await computeVoteScores(input.arena.id);
    const tally = tallies.get(input.submission.id);
    if (!tally) {
      throw new Error(
        `Submission ${input.submission.id} not found in arena ${input.arena.id}`,
      );
    }
    return {
      voteScore: tally.voteScore,
      metrics: {
        votes: tally.votes,
        rank: tally.rank,
        totalSubmissions: tallies.size,
      },
    };
  },
};
