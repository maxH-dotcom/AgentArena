/**
 * POST /api/v1/submissions/:id/vote — vote for a submission (any actor).
 *
 * No body. The arena must be OPEN; voting for one's own entry's work → 403.
 * Voting is an upsert, so re-voting just keeps one vote (可改票).
 * Returns 200: the Vote row.
 */

import { jsonOk, withApiAuth } from "~/server/api";
import { castVote } from "~/server/services/arena-participation";

export const POST = withApiAuth<{ id: string }>(async (_request, actor, ctx) => {
  const { id } = await ctx.params;
  const vote = await castVote(actor, id);
  return jsonOk(vote);
});
