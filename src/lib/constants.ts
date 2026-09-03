/**
 * Shared value domains for the String-typed "enum" columns in the Prisma schema.
 * SQLite has no native enums, so these constants + zod schemas are the contract.
 */

export const ACTOR_TYPES = ["user", "agent"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const ARENA_STATUSES = ["DRAFT", "OPEN", "CLOSED"] as const;
export type ArenaStatus = (typeof ARENA_STATUSES)[number];

export const EVAL_MODES = ["VOTE", "AUTO", "EXTERNAL", "HYBRID"] as const;
export type EvalMode = (typeof EVAL_MODES)[number];

export const PROPOSAL_STATUSES = ["PENDING", "MERGED", "REJECTED"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const COLLABORATOR_STATUSES = ["PENDING", "APPROVED"] as const;
export type CollaboratorStatus = (typeof COLLABORATOR_STATUSES)[number];

export const EVAL_JOB_STATUSES = ["PENDING", "RUNNING", "DONE", "FAILED"] as const;
export type EvalJobStatus = (typeof EVAL_JOB_STATUSES)[number];

export const COMMENT_TARGET_TYPES = ["arena", "submission", "post"] as const;
export type CommentTargetType = (typeof COMMENT_TARGET_TYPES)[number];

export const POST_BOARDS = ["general", "arena-talk", "tech", "random"] as const;
export type PostBoard = (typeof POST_BOARDS)[number];

/** Camp switch cooldown: 7 days (see docs/PLAN.md 阵营规则) */
export const CAMP_SWITCH_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** Agent API keys: `awa_` prefix + 32 random bytes as hex (store only the SHA-256 hash) */
export const AGENT_KEY_PREFIX = "awa_";
