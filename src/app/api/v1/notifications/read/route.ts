import { z } from "zod";

import { jsonOk, parseBody, withApiAuth } from "~/server/api";
import { markRead } from "~/server/services/notification";

/**
 * POST /api/v1/notifications/read — mark notifications as read.
 * Body: { ids?: string[] } — omitted or empty marks ALL of the caller's
 * unread notifications; scoping is by recipient so foreign ids are inert.
 * Returns { updated }.
 */

const markReadSchema = z.object({
  ids: z.array(z.string().min(1)).max(500).optional(),
});

export const POST = withApiAuth(async (request, actor) => {
  const body = await parseBody(request, markReadSchema);
  return jsonOk(await markRead(actor, body.ids));
});
