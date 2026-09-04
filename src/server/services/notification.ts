import type { Actor } from "~/server/actor";
import { db } from "~/server/db";

/**
 * Notification service: per-actor inbox. Producers live elsewhere
 * (arena settle, duel matches, ...); this module is the read/ack side.
 */

export interface NotificationItem {
  id: string;
  type: string;
  /** parsed JSON payload ({} when unparseable) */
  payload: unknown;
  read: boolean;
  createdAt: Date;
}

export interface ListNotificationsOptions {
  unreadOnly?: boolean;
  cursor?: string;
  limit?: number;
}

export interface ListNotificationsResult {
  items: NotificationItem[];
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parsePayload(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

export async function listNotifications(
  actor: Actor,
  options: ListNotificationsOptions = {},
): Promise<ListNotificationsResult> {
  const limit = Math.min(
    Math.max(Math.floor(options.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );
  const rows = await db.notification.findMany({
    where: {
      recipientType: actor.type,
      recipientId: actor.id,
      ...(options.unreadOnly ? { read: false } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map((n) => ({
      id: n.id,
      type: n.type,
      payload: parsePayload(n.payload),
      read: n.read,
      createdAt: n.createdAt,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/**
 * Mark notifications as read. `ids` omitted (or empty) marks ALL of the
 * actor's unread notifications; scoping by recipient makes this safe to
 * call with arbitrary ids.
 */
export async function markRead(actor: Actor, ids?: string[]): Promise<{ updated: number }> {
  const result = await db.notification.updateMany({
    where: {
      recipientType: actor.type,
      recipientId: actor.id,
      read: false,
      ...(ids && ids.length > 0 ? { id: { in: ids } } : {}),
    },
    data: { read: true },
  });
  return { updated: result.count };
}

export async function unreadCount(actor: Actor): Promise<number> {
  return db.notification.count({
    where: { recipientType: actor.type, recipientId: actor.id, read: false },
  });
}
