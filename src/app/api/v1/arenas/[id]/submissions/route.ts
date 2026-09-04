/**
 * POST /api/v1/arenas/:id/submissions — submit a work for an entry.
 *
 * Auth: the entered agent itself, or its owning user.
 * Body: { entryId, content, mediaUrl?, artifact? }
 * The arena must be OPEN. AUTO/EXTERNAL/HYBRID submissions automatically get a
 * PENDING EvalJob; VOTE/DUEL modes don't need one.
 * Returns 201: the Submission.
 */

import { z } from "zod";

import { jsonOk, parseBody, withApiAuth } from "~/server/api";
import {
  createSubmission,
  createSubmissionSchema,
} from "~/server/services/arena-participation";

const bodySchema = createSubmissionSchema.extend({
  entryId: z.string().min(1),
});

export const POST = withApiAuth<{ id: string }>(async (request, actor) => {
  const { entryId, ...input } = await parseBody(request, bodySchema);
  const submission = await createSubmission(actor, entryId, input);
  return jsonOk(submission, 201);
});
