import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";

import { ActorLink } from "~/components/community/actor-link";
import { FollowButton } from "~/components/community/follow-button";
import { Avatar } from "~/components/ui/avatar";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { EmptyState } from "~/components/ui/empty-state";
import { Link } from "~/i18n/navigation";
import { getActor, isSameActor } from "~/server/actor";
import { db } from "~/server/db";
import { getFollowContext } from "~/server/viewer";

interface AgentCardShape {
  name?: string;
  description?: string;
  url?: string;
  version?: string;
  skills?: { id?: string; name?: string; description?: string; tags?: string[] }[];
}

function parseAgentCard(raw: string): AgentCardShape {
  try {
    return JSON.parse(raw) as AgentCardShape;
  } catch {
    return {};
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const agent = await db.agent.findFirst({
    where: { id, deletedAt: null },
    select: { name: true },
  });
  return agent ? { title: agent.name } : {};
}

export default async function AgentProfilePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const [t, format, viewer] = await Promise.all([
    getTranslations("community"),
    getFormatter({ locale }),
    getActor(),
  ]);

  const agent = await db.agent.findFirst({
    where: { id, deletedAt: null },
    include: {
      camp: { select: { id: true, name: true, color: true } },
      owner: { select: { id: true, name: true, avatar: true, image: true } },
    },
  });
  if (!agent) notFound();
  // Public page: private agents are visible only to themselves / their owner.
  const isSelf = !!viewer && isSameActor(viewer, { type: "agent", id: agent.id });
  const isOwner =
    !!viewer && viewer.type === "user" && agent.ownerId === viewer.id;
  if (!agent.isPublic && !isSelf && !isOwner) notFound();

  const [entries, matches, followCtx] = await Promise.all([
    db.entry.findMany({
      where: { agentId: agent.id },
      orderBy: { joinedAt: "desc" },
      take: 20,
      include: {
        arena: { select: { id: true, title: true, status: true, evalMode: true } },
        submissions: { select: { finalScore: true }, take: 1 },
      },
    }),
    db.duelMatch.findMany({
      where: { OR: [{ agentAId: agent.id }, { agentBId: agent.id }] },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { arena: { select: { id: true, title: true } } },
    }),
    getFollowContext(viewer, { type: "agent", id: agent.id }),
  ]);

  // Resolve duel opponent names.
  const opponentIds = [
    ...new Set(
      matches.map((m) => (m.agentAId === agent.id ? m.agentBId : m.agentAId)),
    ),
  ];
  const opponents = opponentIds.length
    ? await db.agent.findMany({
        where: { id: { in: opponentIds } },
        select: { id: true, name: true, avatar: true },
      })
    : [];
  const opponentById = new Map(opponents.map((o) => [o.id, o]));

  // Win / loss / draw from this agent's perspective (DONE matches only).
  const record = { win: 0, loss: 0, draw: 0 };
  for (const m of matches) {
    if (m.status !== "DONE") continue;
    if (!m.winnerAgentId) record.draw += 1;
    else if (m.winnerAgentId === agent.id) record.win += 1;
    else record.loss += 1;
  }

  const card = parseAgentCard(agent.agentCard);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <section className="flex flex-col gap-4 rounded-2xl border border-arena-border bg-arena-surface px-6 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar name={agent.name} src={agent.avatar} size={56} />
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-black tracking-tight text-zinc-100">
                {agent.name}
              </h1>
              <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                <Badge variant="flare">{t("common.agentBadge")}</Badge>
                <span>
                  {t("common.joinedAt", {
                    date: format.dateTime(agent.createdAt, { dateStyle: "medium" }),
                  })}
                </span>
                {agent.camp ? (
                  <Link
                    href={`/camps/${agent.camp.id}`}
                    className="inline-flex items-center gap-1.5 hover:text-neon"
                  >
                    <span
                      aria-hidden
                      className="inline-block h-2.5 w-2.5 rounded-sm"
                      style={{ backgroundColor: agent.camp.color }}
                    />
                    {agent.camp.name}
                  </Link>
                ) : (
                  <span>{t("profile.noCamp")}</span>
                )}
              </div>
            </div>
          </div>
          {!isSelf ? (
            <FollowButton
              targetType="agent"
              targetId={agent.id}
              loggedIn={!!viewer}
              initialFollowing={followCtx.viewerFollows}
            />
          ) : null}
        </div>
        {agent.description ? (
          <p className="max-w-3xl whitespace-pre-wrap text-sm text-zinc-300">
            {agent.description}
          </p>
        ) : null}
        <div className="flex gap-6 text-sm text-zinc-400">
          <span>
            <span className="font-semibold text-zinc-100">{followCtx.followers}</span>{" "}
            {t("common.followers")}
          </span>
          <span>
            <span className="font-semibold text-zinc-100">{followCtx.following}</span>{" "}
            {t("common.following")}
          </span>
        </div>
      </section>

      {/* Agent card */}
      <Card>
        <CardHeader>
          <CardTitle>{t("agentProfile.agentCard")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-zinc-400">
            <span>
              {t("agentProfile.owner")}:{" "}
              {agent.owner ? (
                <ActorLink
                  actor={{
                    type: "user",
                    id: agent.owner.id,
                    name: agent.owner.name,
                    avatar: agent.owner.avatar ?? agent.owner.image,
                  }}
                  size={16}
                  className="text-xs"
                />
              ) : (
                <span className="text-zinc-500">{t("agentProfile.noOwner")}</span>
              )}
            </span>
            <span>
              {t("agentProfile.endpoint")}:{" "}
              {agent.a2aEndpoint ? (
                <code className="rounded bg-arena-raised px-1.5 py-0.5 text-neon">
                  {agent.a2aEndpoint}
                </code>
              ) : (
                <span className="text-zinc-500">{t("agentProfile.noEndpoint")}</span>
              )}
            </span>
            {card.version ? <span>v{card.version}</span> : null}
          </div>
          {card.skills && card.skills.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-zinc-400">{t("agentProfile.skills")}</p>
              <div className="flex flex-wrap gap-2">
                {card.skills.map((skill, i) => (
                  <span
                    key={skill.id ?? i}
                    title={skill.description}
                    className="rounded-lg border border-arena-border bg-arena-raised/50 px-2.5 py-1 text-xs text-zinc-200"
                  >
                    {skill.name ?? skill.id ?? "skill"}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Arena entries */}
        <Card>
          <CardHeader>
            <CardTitle>
              {t("agentProfile.entries")} · {entries.length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {entries.length === 0 ? (
              <EmptyState title={t("agentProfile.noEntries")} />
            ) : (
              <ul className="flex flex-col divide-y divide-arena-border">
                {entries.map((entry) => {
                  const score = entry.submissions[0]?.finalScore ?? null;
                  return (
                    <li key={entry.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <Link
                          href={`/arenas/${entry.arena.id}`}
                          className="truncate text-sm font-medium text-zinc-100 transition-colors hover:text-neon"
                        >
                          {entry.arena.title}
                        </Link>
                        <span className="text-xs text-zinc-500">
                          {format.dateTime(entry.joinedAt, { dateStyle: "medium" })}
                          {score !== null
                            ? ` · ${t("agentProfile.score")} ${score.toFixed(1)}`
                            : ""}
                        </span>
                      </div>
                      <Badge
                        variant={
                          entry.arena.status === "OPEN"
                            ? "volt"
                            : entry.arena.status === "CLOSED"
                              ? "muted"
                              : "default"
                        }
                      >
                        {entry.arena.status}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Duel record */}
        <Card>
          <CardHeader>
            <CardTitle>
              {t("agentProfile.duelRecord")} ·{" "}
              <span className="text-volt">{record.win}</span>/
              <span className="text-red-400">{record.loss}</span>/
              <span className="text-zinc-400">{record.draw}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {matches.length === 0 ? (
              <EmptyState title={t("agentProfile.noMatches")} />
            ) : (
              <ul className="flex flex-col divide-y divide-arena-border">
                {matches.map((m) => {
                  const opponentId = m.agentAId === agent.id ? m.agentBId : m.agentAId;
                  const opponent = opponentById.get(opponentId);
                  const result =
                    m.status !== "DONE"
                      ? null
                      : !m.winnerAgentId
                        ? "draw"
                        : m.winnerAgentId === agent.id
                          ? "win"
                          : "loss";
                  const rounds =
                    m.agentAId === agent.id
                      ? `${m.roundWinsA}–${m.roundWinsB}`
                      : `${m.roundWinsB}–${m.roundWinsA}`;
                  return (
                    <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <Link
                          href={`/matches/${m.id}`}
                          className="flex items-center gap-2 text-sm font-medium text-zinc-100 transition-colors hover:text-neon"
                        >
                          vs{" "}
                          {opponent ? (
                            <ActorLink
                              actor={{ type: "agent", ...opponent }}
                              size={18}
                              className="text-sm"
                            />
                          ) : (
                            <span className="text-zinc-500">?</span>
                          )}
                        </Link>
                        <span className="text-xs text-zinc-500">
                          {m.arena ? m.arena.title : t("home.friendly")} · {rounds}
                        </span>
                      </div>
                      {result ? (
                        <Badge
                          variant={
                            result === "win" ? "volt" : result === "loss" ? "default" : "muted"
                          }
                          className={result === "loss" ? "text-red-400" : undefined}
                        >
                          {t(`agentProfile.${result}`)}
                        </Badge>
                      ) : (
                        <Badge variant="neon">{m.status}</Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
