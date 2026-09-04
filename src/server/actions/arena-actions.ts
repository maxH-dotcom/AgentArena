"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";

import {
  ForbiddenError,
  UnauthorizedError,
  requireActor,
} from "~/server/actor";
import { HttpError } from "~/server/api";
import {
  applyCollaborator,
  closeArenaApi,
  createArena,
  getArenaOrThrow,
  listArenas,
  openArena,
  reviewCollaborator,
  reviewProposal,
  settleDuelArena,
  submitProposal,
} from "~/server/services/arena";
import {
  castVote,
  createSubmission,
  enterArena,
} from "~/server/services/arena-participation";
import { ARENA_STATUSES } from "~/lib/constants";

/**
 * Server actions for the arena web UI (src/app/[locale]/arenas/*). Thin
 * wrappers around the service layer: requireActor() → service call →
 * revalidatePath. Errors are mapped to a serializable {ok:false, code, message}
 * shape; `code` matches the REST API's machine-readable codes (HttpError.code)
 * so the UI can map them to i18n strings.
 */

interface Failure {
  ok: false;
  code: string;
  message: string;
}

function toFailure(error: unknown): Failure {
  if (error instanceof HttpError) {
    return { ok: false, code: error.code, message: error.message };
  }
  if (error instanceof UnauthorizedError) {
    return { ok: false, code: "UNAUTHORIZED", message: error.message };
  }
  if (error instanceof ForbiddenError) {
    return { ok: false, code: "FORBIDDEN", message: error.message };
  }
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const where = issue?.path.join(".") ?? "";
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: where
        ? `${where}: ${issue?.message ?? "invalid"}`
        : (issue?.message ?? "Invalid input"),
    };
  }
  console.error("Arena action failed", error);
  return { ok: false, code: "INTERNAL", message: "Internal server error" };
}

function revalidateArenas(arenaId?: string) {
  revalidatePath("/[locale]/arenas", "page");
  if (arenaId) {
    revalidatePath("/[locale]/arenas/[id]", "page");
  }
}

export async function createArenaAction(
  input: unknown,
): Promise<{ ok: true; id: string } | Failure> {
  try {
    const actor = await requireActor();
    const arena = await createArena(actor, input);
    revalidateArenas();
    return { ok: true, id: arena.id };
  } catch (error) {
    return toFailure(error);
  }
}

export async function openArenaAction(
  arenaId: string,
): Promise<{ ok: true } | Failure> {
  try {
    const actor = await requireActor();
    await openArena(actor, arenaId);
    revalidateArenas(arenaId);
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

/**
 * OPEN -> CLOSED. Dispatches on evalMode: DUEL arenas settle from match
 * results (settleDuelArena), everything else goes through the standard
 * settlement pipeline (closeArenaApi).
 */
export async function closeArenaAction(
  arenaId: string,
): Promise<{ ok: true } | Failure> {
  try {
    const actor = await requireActor();
    const arena = await getArenaOrThrow(arenaId);
    if (arena.evalMode === "DUEL") {
      await settleDuelArena(actor, arenaId);
    } else {
      await closeArenaApi(actor, arenaId);
    }
    revalidateArenas(arenaId);
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

export async function submitProposalAction(
  arenaId: string,
  input: unknown,
): Promise<{ ok: true } | Failure> {
  try {
    const actor = await requireActor();
    await submitProposal(actor, arenaId, input);
    revalidateArenas(arenaId);
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

export async function reviewProposalAction(
  arenaId: string,
  proposalId: string,
  approve: boolean,
  reviewNote?: string,
): Promise<{ ok: true } | Failure> {
  try {
    const actor = await requireActor();
    await reviewProposal(actor, proposalId, { approve, reviewNote });
    revalidateArenas(arenaId);
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

export async function applyCollaboratorAction(
  arenaId: string,
): Promise<{ ok: true } | Failure> {
  try {
    const actor = await requireActor();
    await applyCollaborator(actor, arenaId);
    revalidateArenas(arenaId);
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

export async function reviewCollaboratorAction(
  arenaId: string,
  applicantType: string,
  applicantId: string,
  approve: boolean,
): Promise<{ ok: true } | Failure> {
  try {
    const actor = await requireActor();
    await reviewCollaborator(actor, arenaId, applicantType, applicantId, approve);
    revalidateArenas(arenaId);
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

export async function enterArenaAction(
  arenaId: string,
  agentId: string,
): Promise<{ ok: true } | Failure> {
  try {
    const actor = await requireActor();
    await enterArena(actor, arenaId, { agentId });
    revalidateArenas(arenaId);
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

export async function createSubmissionAction(
  arenaId: string,
  entryId: string,
  input: unknown,
): Promise<{ ok: true } | Failure> {
  try {
    const actor = await requireActor();
    await createSubmission(actor, entryId, input);
    revalidateArenas(arenaId);
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

export async function castVoteAction(
  arenaId: string,
  submissionId: string,
): Promise<{ ok: true } | Failure> {
  try {
    const actor = await requireActor();
    await castVote(actor, submissionId);
    revalidateArenas(arenaId);
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

/** Cursor pagination for the arena list "load more" button. */
export async function loadMoreArenasAction(
  status: string | null,
  cursor: string,
): Promise<
  | { ok: true; items: Awaited<ReturnType<typeof listArenas>>["items"]; nextCursor: string | null }
  | Failure
> {
  try {
    const statusFilter =
      status && (ARENA_STATUSES as readonly string[]).includes(status)
        ? status
        : undefined;
    const { items, nextCursor } = await listArenas({
      status: statusFilter,
      cursor,
      limit: 12,
    });
    return { ok: true, items, nextCursor };
  } catch (error) {
    return toFailure(error);
  }
}
