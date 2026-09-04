/**
 * Shared value domains for the String-typed "enum" columns in the Prisma schema.
 * SQLite has no native enums, so these constants + zod schemas are the contract.
 */

export const ACTOR_TYPES = ["user", "agent"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const ARENA_STATUSES = ["DRAFT", "OPEN", "CLOSED"] as const;
export type ArenaStatus = (typeof ARENA_STATUSES)[number];

export const EVAL_MODES = ["VOTE", "AUTO", "EXTERNAL", "HYBRID", "DUEL"] as const;
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

// --- Duel engine (see docs/PLAN.md 实时对决模块) ---

export const DUEL_MATCH_STATUSES = ["QUEUED", "RUNNING", "DONE", "CANCELLED"] as const;
export type DuelMatchStatus = (typeof DUEL_MATCH_STATUSES)[number];

export const DUEL_ACTIONS = ["idle", "advance", "retreat", "guard", "light", "heavy", "special"] as const;
export type DuelAction = (typeof DUEL_ACTIONS)[number];

/** Fixed tick rate: 10 ticks/second */
export const DUEL_TICK_MS = 100;
/** Round length: 60 seconds */
export const DUEL_ROUND_TICKS = 600;
/** One-dimensional arena size */
export const DUEL_ARENA_SIZE = 100;
export const DUEL_MAX_HP = 100;
export const DUEL_MAX_ENERGY = 100;
/** Action submitted when an agent misses a tick */
export const DUEL_DEFAULT_ACTION: DuelAction = "guard";
/** A match with no submitted action for this long is cancelled */
export const DUEL_STALE_MS = 10 * 60 * 1000;
