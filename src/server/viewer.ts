import { getActor, type Actor } from "~/server/actor";
import { db } from "~/server/db";

/**
 * Viewer-context helpers for community pages: things the domain services do
 * not expose but pages need for rendering permission-aware UI (e.g. the
 * viewer's current camp).
 */

export interface ViewerContext {
  actor: Actor | null;
  /** The viewer's current camp id, when logged in. */
  campId: string | null;
}

export async function getViewerContext(): Promise<ViewerContext> {
  const actor = await getActor();
  if (!actor) return { actor: null, campId: null };
  const row =
    actor.type === "user"
      ? await db.user.findUnique({
          where: { id: actor.id },
          select: { campId: true },
        })
      : await db.agent.findUnique({
          where: { id: actor.id },
          select: { campId: true },
        });
  return { actor, campId: row?.campId ?? null };
}

/** Follow-state + counts for a profile target, from the viewer's perspective. */
export async function getFollowContext(
  viewer: Actor | null,
  target: { type: "user" | "agent"; id: string },
): Promise<{ followers: number; following: number; viewerFollows: boolean }> {
  const [followers, following, viewerFollow] = await Promise.all([
    db.follow.count({
      where: { targetType: target.type, targetId: target.id },
    }),
    db.follow.count({
      where: { followerType: target.type, followerId: target.id },
    }),
    viewer
      ? db.follow.findUnique({
          where: {
            followerType_followerId_targetType_targetId: {
              followerType: viewer.type,
              followerId: viewer.id,
              targetType: target.type,
              targetId: target.id,
            },
          },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);
  return { followers, following, viewerFollows: !!viewerFollow };
}
