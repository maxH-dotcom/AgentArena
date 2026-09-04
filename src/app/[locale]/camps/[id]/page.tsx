import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";

import { ActorLink } from "~/components/community/actor-link";
import { CampJoinLeave } from "~/components/community/camp-join-leave";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { EmptyState } from "~/components/ui/empty-state";
import { Link } from "~/i18n/navigation";
import { HttpError } from "~/server/api";
import { listArenas } from "~/server/services/arena";
import { getCampDetail } from "~/server/services/camp";
import { getViewerContext } from "~/server/viewer";

async function loadCamp(id: string) {
  try {
    return await getCampDetail(id);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const camp = await getCampDetail(id);
    return { title: camp.name };
  } catch {
    return {};
  }
}

export default async function CampDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const [t, format, camp, arenas, viewer] = await Promise.all([
    getTranslations("community"),
    getFormatter({ locale }),
    loadCamp(id),
    listArenas({ campId: id, limit: 20 }),
    getViewerContext(),
  ]);

  const isMember = viewer.campId === camp.id;

  return (
    <div className="flex flex-col gap-8">
      {/* Camp header */}
      <section className="overflow-hidden rounded-2xl border border-arena-border bg-arena-surface">
        <div
          aria-hidden
          className="h-2 w-full"
          style={{ backgroundColor: camp.color }}
        />
        <div className="flex flex-col gap-4 px-6 py-6">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight text-zinc-100">
              {camp.name}
            </h1>
            {isMember ? <Badge variant="neon">{t("camps.yourCamp")}</Badge> : null}
          </div>
          {camp.slogan ? (
            <p className="text-sm italic text-zinc-400">“{camp.slogan}”</p>
          ) : null}
          {camp.description ? (
            <p className="max-w-3xl whitespace-pre-wrap text-sm text-zinc-300">
              {camp.description}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-6 text-sm text-zinc-400">
            <span>
              <span className="font-semibold text-zinc-100">{camp.memberCount}</span>{" "}
              {t("common.members")}
            </span>
            <span>
              <span className="font-semibold text-volt">{camp.winCount}</span>{" "}
              {t("common.wins")}
            </span>
            <span>
              <span className="font-semibold text-zinc-100">{camp.arenaCount}</span>{" "}
              {t("camp.arenas")}
            </span>
          </div>
          <CampJoinLeave campId={camp.id} loggedIn={!!viewer.actor} isMember={isMember} />
        </div>
      </section>

      {/* Members: humans + agents, mixed */}
      <Card>
        <CardHeader>
          <CardTitle>
            {t("camp.members")} · {camp.memberCount}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {camp.members.length === 0 ? (
            <EmptyState title={t("camp.noMembers")} />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {camp.members.map((member) => (
                <li
                  key={`${member.type}:${member.id}`}
                  className="rounded-lg border border-arena-border bg-arena-raised/40 px-3 py-2"
                >
                  <ActorLink
                    actor={member}
                    size={28}
                    showTypeBadge
                    typeBadgeLabel={t("common.agentBadge")}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Arenas under this camp */}
      <Card>
        <CardHeader>
          <CardTitle>
            {t("camp.arenas")} · {camp.arenaCount}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {arenas.items.length === 0 ? (
            <EmptyState title={t("camp.noArenas")} />
          ) : (
            <ul className="flex flex-col divide-y divide-arena-border">
              {arenas.items.map((arena) => (
                <li key={arena.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Link
                      href={`/arenas/${arena.id}`}
                      className="truncate text-sm font-medium text-zinc-100 transition-colors hover:text-neon"
                    >
                      {arena.title}
                    </Link>
                    <span className="text-xs text-zinc-500">
                      {format.dateTime(arena.createdAt, { dateStyle: "medium" })}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="muted">{arena.evalMode}</Badge>
                    <Badge
                      variant={
                        arena.status === "OPEN"
                          ? "volt"
                          : arena.status === "CLOSED"
                            ? "muted"
                            : "default"
                      }
                    >
                      {arena.status}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
