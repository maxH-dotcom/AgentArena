import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { ActorChip } from "~/components/arenas/actor-chip";
import { ArenaAdminActions } from "~/components/arenas/arena-admin-actions";
import {
  CollaboratorApplyButton,
  CollaboratorReviewList,
  type PendingApplication,
} from "~/components/arenas/collaborator-panel";
import { DuelMatchMaker } from "~/components/arenas/duel-match-panel";
import { EntryForm } from "~/components/arenas/entry-form";
import { ProposalReviewActions } from "~/components/arenas/proposal-review";
import { SubmissionForm } from "~/components/arenas/submission-form";
import { VoteButton } from "~/components/arenas/vote-button";
import { CommentsSection } from "~/components/comments/comments-section";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { EmptyState } from "~/components/ui/empty-state";
import { Link } from "~/i18n/navigation";
import { getActor, isSameActor } from "~/server/actor";
import { HttpError } from "~/server/api";
import { db } from "~/server/db";
import {
  getArenaDetail,
  listProposals,
  resolveActorRef,
} from "~/server/services/arena";
import { listSubmissions } from "~/server/services/arena-participation";

const statusVariant = {
  DRAFT: "muted",
  OPEN: "volt",
  CLOSED: "default",
} as const;

const proposalStatusVariant = {
  PENDING: "flare",
  MERGED: "volt",
  REJECTED: "muted",
} as const;

const matchStatusVariant = {
  QUEUED: "muted",
  RUNNING: "flare",
  DONE: "volt",
  CANCELLED: "default",
} as const;

export default async function ArenaDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const [t, format, actor] = await Promise.all([
    getTranslations("arenas"),
    getFormatter({ locale }),
    getActor(),
  ]);

  let arena;
  try {
    arena = await getArenaDetail(id);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  }

  const isCreator = !!actor && isSameActor(actor, {
    type: arena.creatorType,
    id: arena.creatorId,
  });
  const isCollaborator =
    !!actor &&
    arena.collaborators.some(
      (c) => c.applicantType === actor.type && c.applicantId === actor.id,
    );
  const canManage = isCreator || isCollaborator;
  const isOpen = arena.status === "OPEN";
  const isDuel = arena.evalMode === "DUEL";

  const [proposals, submissions, myAgents, myApplication, duelMatches] =
    await Promise.all([
      listProposals(id, { limit: 50 }),
      listSubmissions(id, { limit: 30 }),
      actor?.type === "user"
        ? db.agent.findMany({
            where: { ownerId: actor.id, deletedAt: null },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          })
        : Promise.resolve([]),
      actor && !isCreator
        ? db.arenaCollaborator.findUnique({
            where: {
              arenaId_applicantType_applicantId: {
                arenaId: id,
                applicantType: actor.type,
                applicantId: actor.id,
              },
            },
          })
        : Promise.resolve(null),
      isDuel
        ? db.duelMatch.findMany({
            where: { arenaId: id },
            orderBy: [{ createdAt: "desc" }, { id: "asc" }],
            take: 20,
          })
        : Promise.resolve([]),
    ]);

  const myAgentIds = new Set(myAgents.map((a) => a.id));
  const myEntry = arena.entries.find((e) => myAgentIds.has(e.agentId)) ?? null;
  const availableAgents = myAgents.filter(
    (a) => !arena.entries.some((e) => e.agentId === a.id),
  );

  const myVotes = actor
    ? new Set(
        (
          await db.vote.findMany({
            where: {
              voterType: actor.type,
              voterId: actor.id,
              submissionId: { in: submissions.items.map((s) => s.id) },
            },
            select: { submissionId: true },
          })
        ).map((v) => v.submissionId),
      )
    : new Set<string>();

  const [pendingApplications, approvedCollaborators, matchAgents] =
    await Promise.all([
      canManage
        ? db.arenaCollaborator
            .findMany({
              where: { arenaId: id, status: "PENDING" },
              orderBy: { createdAt: "asc" },
            })
            .then(async (rows) => {
              const resolved: PendingApplication[] = [];
              for (const row of rows) {
                const profile = await resolveActorRef(row.applicantType, row.applicantId);
                resolved.push({
                  applicantType: row.applicantType,
                  applicantId: row.applicantId,
                  name: profile?.name ?? row.applicantId,
                  avatar: profile?.avatar ?? null,
                });
              }
              return resolved;
            })
        : Promise.resolve([] as PendingApplication[]),
      Promise.all(
        arena.collaborators.map((c) =>
          resolveActorRef(c.applicantType, c.applicantId),
        ),
      ),
      isDuel && duelMatches.length > 0
        ? db.agent.findMany({
            where: {
              id: {
                in: [
                  ...new Set(
                    duelMatches.flatMap((m) => [m.agentAId, m.agentBId]),
                  ),
                ],
              },
            },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);
  const matchAgentName = new Map(matchAgents.map((a) => [a.id, a.name]));

  const duelEntryOptions = arena.entries.map((e) => ({
    id: e.id,
    agentId: e.agentId,
    agentName: e.agent.name,
  }));

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <Link href="/arenas" className="text-xs text-zinc-500 hover:text-neon">
          ← {t("detail.back")}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-black tracking-tight text-zinc-100">
            {arena.title}
          </h1>
          <Badge
            variant={
              statusVariant[arena.status as keyof typeof statusVariant] ??
              "default"
            }
          >
            {t(`status.${arena.status}`)}
          </Badge>
          <Badge variant="neon">{t(`evalMode.${arena.evalMode}`)}</Badge>
          {arena.camp ? (
            <Badge variant="default">
              <span
                aria-hidden
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: arena.camp.color }}
              />
              {arena.camp.name}
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-zinc-500">
          <span className="flex items-center gap-1.5">
            {t("detail.creator")}:
            {arena.creator ? (
              <ActorChip
                type={arena.creator.type}
                id={arena.creator.id}
                name={arena.creator.name}
                avatar={arena.creator.avatar}
              />
            ) : (
              "?"
            )}
          </span>
          <span>
            {t("detail.deadline")}:{" "}
            {arena.deadline
              ? format.dateTime(arena.deadline, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })
              : t("detail.noDeadline")}
          </span>
          <span>
            {t("detail.createdAt")}:{" "}
            {format.dateTime(arena.createdAt, { dateStyle: "medium" })}
          </span>
        </div>
      </div>

      {/* Description */}
      <Card>
        <CardHeader>
          <CardTitle>{t("detail.description")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm text-zinc-300">
            {arena.description}
          </p>
        </CardContent>
      </Card>

      {/* Creator controls */}
      {isCreator && arena.status !== "CLOSED" ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("detail.admin.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ArenaAdminActions
              arenaId={arena.id}
              status={arena.status}
              evalMode={arena.evalMode}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* Effective standard + version history */}
      {arena.effectiveStandard ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t("detail.standard")}</CardTitle>
            <Badge variant="neon">
              {t("detail.standardVersion", {
                version: arena.effectiveStandard.version,
              })}
            </Badge>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="whitespace-pre-wrap text-sm text-zinc-300">
              {arena.effectiveStandard.content}
            </p>
            {arena.standards.length > 1 ? (
              <details className="rounded-lg border border-arena-border bg-arena-bg">
                <summary className="cursor-pointer px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200">
                  {t("detail.standardHistory", { count: arena.standards.length })}
                </summary>
                <div className="flex flex-col gap-3 border-t border-arena-border px-3 py-3">
                  {arena.standards.map((standard) => (
                    <div key={standard.id} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-xs text-zinc-500">
                        <Badge variant="muted">
                          {t("detail.standardVersion", { version: standard.version })}
                        </Badge>
                        <span>
                          {format.dateTime(standard.createdAt, {
                            dateStyle: "medium",
                          })}
                        </span>
                        {standard.note ? <span>· {standard.note}</span> : null}
                      </div>
                      <p className="whitespace-pre-wrap text-xs text-zinc-400">
                        {standard.content}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Proposals */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>
            {t("detail.proposals.title")} · {arena.proposalCount}
          </CardTitle>
          {actor ? (
            <Link
              href={`/arenas/${arena.id}/proposals/new`}
              className="text-xs text-neon hover:underline"
            >
              {t("detail.proposals.new")}
            </Link>
          ) : null}
        </CardHeader>
        <CardContent>
          {proposals.items.length === 0 ? (
            <p className="text-sm text-zinc-500">{t("detail.proposals.empty")}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {proposals.items.map((proposal) => (
                <div
                  key={proposal.id}
                  className="flex flex-col gap-2 rounded-lg border border-arena-border bg-arena-bg px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <Badge
                      variant={
                        proposalStatusVariant[
                          proposal.status as keyof typeof proposalStatusVariant
                        ] ?? "default"
                      }
                    >
                      {t(`detail.proposalStatus.${proposal.status}`)}
                    </Badge>
                    {proposal.author ? (
                      <ActorChip
                        type={proposal.author.type}
                        id={proposal.author.id}
                        name={proposal.author.name}
                        avatar={proposal.author.avatar}
                      />
                    ) : null}
                    <span>
                      {format.dateTime(proposal.createdAt, { dateStyle: "medium" })}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-zinc-200">
                    {proposal.content}
                  </p>
                  {proposal.rationale ? (
                    <p className="text-xs text-zinc-500">
                      {t("detail.proposals.rationale")}: {proposal.rationale}
                    </p>
                  ) : null}
                  {proposal.reviewNote ? (
                    <p className="text-xs text-zinc-500">
                      {t("detail.proposals.reviewNote")}: {proposal.reviewNote}
                    </p>
                  ) : null}
                  {canManage && proposal.status === "PENDING" ? (
                    <ProposalReviewActions
                      arenaId={arena.id}
                      proposalId={proposal.id}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Collaborators */}
      <Card>
        <CardHeader>
          <CardTitle>{t("detail.collaborators.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {approvedCollaborators.filter(Boolean).length === 0 ? (
            <p className="text-sm text-zinc-500">
              {t("detail.collaborators.empty")}
            </p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {approvedCollaborators.map((profile) =>
                profile ? (
                  <ActorChip
                    key={`${profile.type}:${profile.id}`}
                    type={profile.type}
                    id={profile.id}
                    name={profile.name}
                    avatar={profile.avatar}
                    size={24}
                  />
                ) : null,
              )}
            </div>
          )}

          {actor && !isCreator && !isCollaborator && !myApplication ? (
            <CollaboratorApplyButton arenaId={arena.id} />
          ) : null}
          {myApplication?.status === "PENDING" ? (
            <p className="text-xs text-zinc-500">
              {t("detail.collaborators.applied")}
            </p>
          ) : null}
          {isCollaborator ? (
            <p className="text-xs text-volt">
              {t("detail.collaborators.approvedNote")}
            </p>
          ) : null}
          {!actor ? (
            <Link href="/login" className="text-xs text-neon hover:underline">
              {t("detail.collaborators.loginToApply")}
            </Link>
          ) : null}

          {canManage && pendingApplications.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-zinc-300">
                {t("detail.collaborators.pendingTitle")}
              </p>
              <CollaboratorReviewList
                arenaId={arena.id}
                applications={pendingApplications}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Entries */}
      <Card>
        <CardHeader>
          <CardTitle>
            {t("detail.entries.title")} · {arena.entries.length}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {arena.entries.length === 0 ? (
            <p className="text-sm text-zinc-500">{t("detail.entries.empty")}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {arena.entries.map((entry) => (
                <Link
                  key={entry.id}
                  href={`/agents/${entry.agent.id}`}
                  className="flex items-center gap-2 rounded-full border border-arena-border bg-arena-bg px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-neon/40 hover:text-neon"
                >
                  {entry.agent.name}
                </Link>
              ))}
            </div>
          )}

          {isOpen ? (
            actor ? (
              actor.type === "user" ? (
                myAgents.length === 0 ? (
                  <p className="text-xs text-zinc-500">
                    {t("detail.entries.noAgents")}{" "}
                    <Link href="/agents" className="text-neon hover:underline">
                      → /agents
                    </Link>
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-medium text-zinc-300">
                      {t("detail.entries.enterTitle")}
                    </p>
                    <EntryForm arenaId={arena.id} agents={availableAgents} />
                  </div>
                )
              ) : null
            ) : (
              <Link href="/login" className="text-xs text-neon hover:underline">
                {t("detail.entries.loginToEnter")}
              </Link>
            )
          ) : null}
        </CardContent>
      </Card>

      {/* DUEL: match maker + match list */}
      {isDuel ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("detail.duel.title")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {isOpen && actor && duelEntryOptions.length >= 2 ? (
              <DuelMatchMaker arenaId={arena.id} entries={duelEntryOptions} />
            ) : null}
            {duelMatches.length === 0 ? (
              <p className="text-sm text-zinc-500">{t("detail.duel.empty")}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {duelMatches.map((match) => {
                  const nameA = matchAgentName.get(match.agentAId) ?? match.agentAId;
                  const nameB = matchAgentName.get(match.agentBId) ?? match.agentBId;
                  return (
                    <Link
                      key={match.id}
                      href={`/matches/${match.id}`}
                      className="flex flex-wrap items-center gap-3 rounded-lg border border-arena-border bg-arena-bg px-4 py-2.5 transition-colors hover:border-neon/40"
                    >
                      <Badge
                        variant={
                          matchStatusVariant[
                            match.status as keyof typeof matchStatusVariant
                          ] ?? "default"
                        }
                      >
                        {t(`detail.matchStatus.${match.status}`)}
                      </Badge>
                      <span className="text-sm text-zinc-200">{nameA}</span>
                      <span className="text-xs font-bold text-flare">VS</span>
                      <span className="text-sm text-zinc-200">{nameB}</span>
                      <span className="ml-auto font-mono text-sm text-zinc-100">
                        {t("detail.duel.score", {
                          a: match.roundWinsA,
                          b: match.roundWinsB,
                        })}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {t("detail.duel.bestOf", { count: match.bestOf })}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Submissions */}
      <Card>
        <CardHeader>
          <CardTitle>
            {t("detail.submissions.title")} · {submissions.items.length}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {isOpen && myEntry ? (
            <div className="rounded-lg border border-arena-border bg-arena-bg px-4 py-3">
              <SubmissionForm arenaId={arena.id} entryId={myEntry.id} />
            </div>
          ) : null}

          {submissions.items.length === 0 ? (
            <p className="text-sm text-zinc-500">{t("detail.submissions.empty")}</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {submissions.items.map((submission) => {
                const isOwn = myAgentIds.has(submission.entry.agentId);
                return (
                  <div
                    key={submission.id}
                    className="flex flex-col gap-3 rounded-lg border border-arena-border bg-arena-bg px-4 py-3"
                  >
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <Link
                        href={`/agents/${submission.entry.agent.id}`}
                        className="font-medium text-zinc-300 hover:text-neon"
                      >
                        {submission.entry.agent.name}
                      </Link>
                      {isOwn ? (
                        <Badge variant="muted">
                          {t("detail.submissions.ownWork")}
                        </Badge>
                      ) : null}
                      <span className="ml-auto">
                        {format.dateTime(submission.createdAt, {
                          dateStyle: "medium",
                        })}
                      </span>
                    </div>
                    <p className="line-clamp-6 whitespace-pre-wrap text-sm text-zinc-200">
                      {submission.content}
                    </p>
                    {submission.mediaUrl ? (
                      <a
                        href={submission.mediaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-neon hover:underline"
                      >
                        {t("detail.submissions.media")} ↗
                      </a>
                    ) : null}
                    <div className="flex items-center gap-3 text-xs text-zinc-500">
                      {isOpen && actor && !isOwn ? (
                        <VoteButton
                          arenaId={arena.id}
                          submissionId={submission.id}
                          initialVoted={myVotes.has(submission.id)}
                          initialCount={submission.voteCount}
                        />
                      ) : (
                        <span>{t("detail.submissions.votes", { count: submission.voteCount })}</span>
                      )}
                      {submission.finalScore !== null ? (
                        <span className="text-volt">
                          {t("detail.submissions.finalScore", {
                            score: submission.finalScore.toFixed(2),
                          })}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {isOpen && !actor ? (
            <Link href="/login" className="text-xs text-neon hover:underline">
              {t("detail.submissions.loginToVote")}
            </Link>
          ) : null}
        </CardContent>
      </Card>

      {/* Comments */}
      <CommentsSection targetType="arena" targetId={arena.id} />
    </div>
  );
}
