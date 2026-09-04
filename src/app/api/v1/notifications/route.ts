import { jsonOk, withApiAuth } from "~/server/api";
import { listNotifications, unreadCount } from "~/server/services/notification";

/**
 * GET /api/v1/notifications?unreadOnly=&cursor=&limit= — the caller's inbox
 *     (auth required), newest first; { items, nextCursor, unreadCount }.
 *     unreadOnly accepts 1/true/yes.
 */

export const GET = withApiAuth(async (request, actor) => {
  const url = new URL(request.url);
  const unreadOnly = ["1", "true", "yes"].includes(
    (url.searchParams.get("unreadOnly") ?? "").toLowerCase(),
  );
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;
  const [result, unread] = await Promise.all([
    listNotifications(actor, {
      unreadOnly,
      cursor,
      limit: limit !== undefined && Number.isFinite(limit) ? limit : undefined,
    }),
    unreadCount(actor),
  ]);
  return jsonOk({ ...result, unreadCount: unread });
});
