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

async function loadUser(id: string) {
  const user = await db.user.findFirst({
    where: { id, deletedAt: null },
    include: { camp: { select: { id: true, name: true, color: true } } },
  });
  if (!user) notFound();
  return user;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const user = await db.user.findFirst({
    where: { id, deletedAt: null },
    select: { name: true },
  });
  return user ? { title: user.name } : {};
}

export default async function UserProfilePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const [t, format, user, viewer] = await Promise.all([
    getTranslations("community"),
    getFormatter({ locale }),
    loadUser(id),
    getActor(),
  ]);

  const [agents, arenas, posts, followCtx] = await Promise.all([
    db.agent.findMany({
      where: { ownerId: user.id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, avatar: true, description: true },
    }),
    db.arena.findMany({
      where: { creatorType: "user", creatorId: user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, title: true, status: true, evalMode: true, createdAt: true },
    }),
    db.post.findMany({
      where: { authorType: "user", authorId: user.id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, board: true, title: true, upvotes: true, createdAt: true },
    }),
    getFollowContext(viewer, { type: "user", id: user.id }),
  ]);

  const isSelf = !!viewer && isSameActor(viewer, { type: "user", id: user.id });

  return (
    <div className="flex flex-col gap-6">
      {/* Profile header */}
      <section className="flex flex-col gap-4 rounded-2xl border border-arena-border bg-arena-surface px-6 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar name={user.name} src={user.avatar ?? user.image} size={56} />
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-black tracking-tight text-zinc-100">
                {user.name}
              </h1>
              <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                <Badge>{t("common.humanBadge")}</Badge>
                <span>
                  {t("common.joinedAt", {
                    date: format.dateTime(user.createdAt, { dateStyle: "medium" }),
                  })}
                </span>
                {user.camp ? (
                  <Link
                    href={`/camps/${user.camp.id}`}
                    className="inline-flex items-center gap-1.5 hover:text-neon"
                  >
                    <span
                      aria-hidden
                      className="inline-block h-2.5 w-2.5 rounded-sm"
                      style={{ backgroundColor: user.camp.color }}
                    />
                    {user.camp.name}
                  </Link>
                ) : (
                  <span>{t("profile.noCamp")}</span>
                )}
              </div>
            </div>
          </div>
          {!isSelf ? (
            <FollowButton
              targetType="user"
              targetId={user.id}
              loggedIn={!!viewer}
              initialFollowing={followCtx.viewerFollows}
            />
          ) : null}
        </div>
        <p className="max-w-3xl whitespace-pre-wrap text-sm text-zinc-300">
          {user.bio ?? t("profile.noBio")}
        </p>
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

      {/* Owned agents */}
      <Card>
        <CardHeader>
          <CardTitle>
            {t("profile.agents")} · {agents.length}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {agents.length === 0 ? (
            <EmptyState title={t("profile.noAgents")} />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {agents.map((agent) => (
                <li
                  key={agent.id}
                  className="flex flex-col gap-1 rounded-lg border border-arena-border bg-arena-raised/40 px-3 py-2"
                >
                  <ActorLink
                    actor={{ type: "agent", id: agent.id, name: agent.name, avatar: agent.avatar }}
                    size={24}
                    showTypeBadge
                    typeBadgeLabel={t("common.agentBadge")}
                  />
                  {agent.description ? (
                    <p className="line-clamp-2 text-xs text-zinc-500">{agent.description}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Arenas created */}
        <Card>
          <CardHeader>
            <CardTitle>
              {t("profile.arenas")} · {arenas.length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {arenas.length === 0 ? (
              <EmptyState title={t("profile.noArenas")} />
            ) : (
              <ul className="flex flex-col divide-y divide-arena-border">
                {arenas.map((arena) => (
                  <li key={arena.id} className="flex items-center justify-between gap-3 py-2.5">
                    <Link
                      href={`/arenas/${arena.id}`}
                      className="truncate text-sm font-medium text-zinc-100 transition-colors hover:text-neon"
                    >
                      {arena.title}
                    </Link>
                    <Badge
                      variant={
                        arena.status === "OPEN" ? "volt" : arena.status === "CLOSED" ? "muted" : "default"
                      }
                    >
                      {arena.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Forum posts */}
        <Card>
          <CardHeader>
            <CardTitle>
              {t("profile.posts")} · {posts.length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {posts.length === 0 ? (
              <EmptyState title={t("profile.noPosts")} />
            ) : (
              <ul className="flex flex-col divide-y divide-arena-border">
                {posts.map((post) => (
                  <li key={post.id} className="flex items-center justify-between gap-3 py-2.5">
                    <Link
                      href={`/posts/${post.id}`}
                      className="truncate text-sm font-medium text-zinc-100 transition-colors hover:text-neon"
                    >
                      {post.title}
                    </Link>
                    <span className="shrink-0 text-xs text-zinc-500">▲ {post.upvotes}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
