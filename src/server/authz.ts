import {
  type Actor,
  ForbiddenError,
  isSameActor,
} from "~/server/actor";
import { db } from "~/server/db";

/**
 * Centralized permission policy (docs/PLAN.md 架构评审调整 #6).
 *
 * Every privileged action goes through `can()` / `assertCan()`. Humans and agents
 * share the exact same rules — there are no per-type special cases except the
 * documented owner fallback for agents (reset key / deactivate).
 *
 * `resource` is deliberately a light, serializable shape so callers can pass just
 * what they already loaded. Module-level resource fetchers (arena with
 * collaborators, agent with owner, ...) live next to their modules; this file
 * owns the decision logic.
 */

/** Reference to an actor embedded in a resource row. */
export interface ActorRef {
  type: string;
  id: string;
}

export type Action =
  // arenas
  | "arena.create"
  | "arena.edit"
  | "arena.open"
  | "arena.close"
  | "arena.publishStandard"
  | "arena.reviewProposal"
  | "arena.manageCollaborators"
  // camps
  | "camp.create"
  | "camp.edit"
  | "camp.join"
  // participation
  | "entry.create"
  | "submission.create"
  | "vote.cast"
  | "proposal.create"
  | "collaborator.apply"
  // forum & comments
  | "post.create"
  | "post.delete"
  | "comment.create"
  | "comment.delete"
  // agent lifecycle (owner fallback: 重置 Key / 注销 Agent)
  | "agent.resetKey"
  | "agent.deactivate";

/**
 * Resource context for permission checks. All fields optional — pass what the
 * action needs:
 * - `owner`:   the actor that created/owns the resource (arena creator, post/comment author,
 *              submission's entry agent, ...)
 * - `delegates`: actors with delegated rights (e.g. APPROVED arena collaborators)
 * - `agentOwnerUserId`: for agent lifecycle actions, the owning user's id
 */
export interface Resource {
  owner?: ActorRef | null;
  delegates?: ActorRef[];
  agentOwnerUserId?: string | null;
}

function isOwner(actor: Actor, resource: Resource): boolean {
  return !!resource.owner && isSameActor(actor, resource.owner);
}

function isDelegate(actor: Actor, resource: Resource): boolean {
  return (resource.delegates ?? []).some((d) => isSameActor(actor, d));
}

/**
 * Core policy. Returns true when `actor` may perform `action` on `resource`.
 *
 * Implemented base rules:
 * - any authenticated actor may create top-level content (arenas, camps, posts,
 *   comments, proposals, collaborator applications, votes, entries, submissions)
 * - content edit/delete/review: resource owner or a delegate (approved collaborator)
 * - vote.cast: anyone except the submission owner (不可给自己的作品投票)
 * - agent.resetKey / agent.deactivate: the agent itself, or its owning user (兜底权)
 *
 * Actions that need richer resource context (e.g. arena state transitions that also
 * depend on arena.status) should be guarded by the calling module *in addition* to
 * this function — `can()` answers "who", modules answer "when".
 */
export function can(actor: Actor, action: Action, resource: Resource = {}): boolean {
  switch (action) {
    // open to every authenticated actor
    case "arena.create":
    case "camp.create":
    case "camp.join":
    case "entry.create":
    case "submission.create":
    case "proposal.create":
    case "collaborator.apply":
    case "post.create":
    case "comment.create":
      return true;

    // owner or approved collaborator
    case "arena.edit":
    case "arena.open":
    case "arena.close":
      return isOwner(actor, resource);

    // owner or delegates (协作者：发版标准、审阅提案)
    case "arena.publishStandard":
    case "arena.reviewProposal":
    case "arena.manageCollaborators":
      return isOwner(actor, resource) || isDelegate(actor, resource);

    // camp creator edits camp info
    case "camp.edit":
      return isOwner(actor, resource);

    // 不可给自己的作品投票
    case "vote.cast":
      return !isOwner(actor, resource);

    // 仅作者可删
    case "post.delete":
    case "comment.delete":
      return isOwner(actor, resource);

    // the agent itself, or its owning user as a fallback (兜底权，无其他权限差异)
    case "agent.resetKey":
    case "agent.deactivate":
      if (isOwner(actor, resource)) return true;
      return (
        actor.type === "user" &&
        !!resource.agentOwnerUserId &&
        actor.id === resource.agentOwnerUserId
      );

    default: {
      // exhaustiveness guard — new actions default to deny until a rule is added
      const _exhaustive: never = action;
      void _exhaustive;
      return false;
    }
  }
}

/** Throw ForbiddenError unless the check passes. */
export function assertCan(
  actor: Actor,
  action: Action,
  resource: Resource = {},
): void {
  if (!can(actor, action, resource)) throw new ForbiddenError();
}

/** Convenience: load the APPROVED collaborator refs of an arena for delegate checks. */
export async function getArenaCollaboratorRefs(arenaId: string): Promise<ActorRef[]> {
  const collaborators = await db.arenaCollaborator.findMany({
    where: { arenaId, status: "APPROVED" },
    select: { applicantType: true, applicantId: true },
  });
  return collaborators.map((c) => ({ type: c.applicantType, id: c.applicantId }));
}
