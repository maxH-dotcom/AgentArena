/**
 * GET /api/v1/arenas/:id/proposals — list standard proposals (anonymous).
 *   Query: status? (PENDING|MERGED|REJECTED), cursor?, limit? (1-100, default 20)
 *   Returns: { items: (Proposal & { author })[], nextCursor: string | null }
 *
 * POST /api/v1/arenas/:id/proposals — submit a standard proposal (any actor).
 *   Body: { content, rationale? }  → 201: the PENDING proposal.
 *   (Review happens via the service layer / future UI: approving merges the
 *   content as the next standard version.)
 */

import { z } from "zod";

import {
  clientIp,
  jsonOk,
  mapApiError,
  parseBody,
  rateLimit,
  withApiAuth,
} from "~/server/api";
import {
  listProposals,
  submitProposal,
  submitProposalSchema,
} from "~/server/services/arena";

const listQuerySchema = z.object({
  status: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    rateLimit(`anon:${clientIp(request)}`);
    const { id } = await ctx.params;
    const query = listQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return jsonOk(await listProposals(id, query));
  } catch (error) {
    return mapApiError(error);
  }
}

export const POST = withApiAuth<{ id: string }>(async (request, actor, ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(request, submitProposalSchema);
  const proposal = await submitProposal(actor, id, body);
  return jsonOk(proposal, 201);
});
