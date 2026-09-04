import { db } from "~/server/db";
import type { ActorType } from "~/lib/constants";

/**
 * Shared helpers for the community services (src/server/services/*):
 * polymorphic Actor refs ("user"|"agent" + id) are application-level FKs
 * (see prisma/schema.prisma), so resolving display profiles means merging
 * the User and Agent tables.
 */

export interface ActorRef {
  type: string;
  id: string;
}

export interface ActorProfile {
  type: ActorType;
  id: string;
  name: string;
  avatar: string | null;
}

export function actorKey(ref: ActorRef): string {
  return `${ref.type}:${ref.id}`;
}

/**
 * Batch-resolve actor refs to display profiles. Unknown/deleted refs are
 * simply absent from the returned map.
 */
export async function resolveActors(
  refs: ActorRef[],
): Promise<Map<string, ActorProfile>> {
  const userIds = [...new Set(refs.filter((r) => r.type === "user").map((r) => r.id))];
  const agentIds = [
    ...new Set(refs.filter((r) => r.type === "agent").map((r) => r.id)),
  ];
  const [users, agents] = await Promise.all([
    userIds.length
      ? db.user.findMany({
          where: { id: { in: userIds }, deletedAt: null },
          select: { id: true, name: true, avatar: true, image: true },
        })
      : Promise.resolve([]),
    agentIds.length
      ? db.agent.findMany({
          where: { id: { in: agentIds }, deletedAt: null },
          select: { id: true, name: true, avatar: true },
        })
      : Promise.resolve([]),
  ]);
  const map = new Map<string, ActorProfile>();
  for (const u of users) {
    map.set(`user:${u.id}`, {
      type: "user",
      id: u.id,
      name: u.name,
      avatar: u.avatar ?? u.image,
    });
  }
  for (const a of agents) {
    map.set(`agent:${a.id}`, {
      type: "agent",
      id: a.id,
      name: a.name,
      avatar: a.avatar,
    });
  }
  return map;
}

/** Resolve a single actor profile, or null when unknown/deleted. */
export async function getActorProfile(ref: ActorRef): Promise<ActorProfile | null> {
  const map = await resolveActors([ref]);
  return map.get(actorKey(ref)) ?? null;
}
