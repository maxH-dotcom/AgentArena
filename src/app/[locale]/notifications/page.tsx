import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";

import { MarkAllReadButton } from "~/components/community/mark-all-read-button";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { EmptyState } from "~/components/ui/empty-state";
import { Link } from "~/i18n/navigation";
import { cn } from "~/lib/utils";
import { getActor } from "~/server/actor";
import {
  listNotifications,
  unreadCount,
  type NotificationItem,
} from "~/server/services/notification";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "community" });
  return { title: t("notifications.title") };
}

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [t, format, actor] = await Promise.all([
    getTranslations("community"),
    getFormatter({ locale }),
    getActor(),
  ]);

  if (!actor) {
    return (
      <div className="mx-auto max-w-lg pt-8">
        <Card>
          <CardHeader>
            <CardTitle>{t("notifications.title")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-zinc-400">{t("common.signInToAct")}</p>
            <div>
              <Link href="/login">
                <Button>{t("common.signInToAct")}</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const [result, unread] = await Promise.all([
    listNotifications(actor, { limit: 50 }),
    unreadCount(actor),
  ]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-black tracking-tight text-zinc-100">
          {t("notifications.title")}
          {unread > 0 ? (
            <Badge variant="neon" className="ml-3 align-middle">
              {unread} {t("notifications.unread")}
            </Badge>
          ) : null}
        </h1>
        <MarkAllReadButton disabled={unread === 0} />
      </header>

      {result.items.length === 0 ? (
        <EmptyState title={t("notifications.empty")} />
      ) : (
        <ul className="flex flex-col gap-2">
          {result.items.map((n) => (
            <NotificationRow key={n.id} item={n} />
          ))}
        </ul>
      )}
    </div>
  );
}

function asRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)
    : {};
}

async function NotificationRow({ item }: { item: NotificationItem }) {
  const t = await getTranslations("community");
  const format = await getFormatter();
  const p = asRecord(item.payload);

  let text = t("notifications.types.generic");
  let link: { href: string; label: string } | null = null;

  switch (item.type) {
    case "arena_closed":
      text = t(
        p.won ? "notifications.types.arena_closed_won" : "notifications.types.arena_closed_lost",
      );
      if (typeof p.arenaId === "string") {
        link = { href: `/arenas/${p.arenaId}`, label: t("notifications.viewArena") };
      }
      break;
    case "duel_result": {
      const result = p.result === "win" || p.result === "draw" ? p.result : "loss";
      text = t(`notifications.types.duel_result_${result}`);
      if (typeof p.matchId === "string") {
        link = { href: `/matches/${p.matchId}`, label: t("notifications.viewMatch") };
      }
      break;
    }
    case "proposal.pending":
      text = t("notifications.types.proposal_pending", {
        arenaTitle: typeof p.arenaTitle === "string" ? p.arenaTitle : "",
      });
      if (typeof p.arenaId === "string") {
        link = { href: `/arenas/${p.arenaId}`, label: t("notifications.viewArena") };
      }
      break;
    case "eval.completed":
      text = t("notifications.types.eval_completed", {
        score: typeof p.score === "number" ? p.score : 0,
      });
      break;
  }

  return (
    <li
      className={cn(
        "flex items-start justify-between gap-4 rounded-xl border px-5 py-4",
        item.read
          ? "border-arena-border bg-arena-surface"
          : "border-neon/40 bg-neon/5 shadow-[0_0_18px_rgba(34,211,238,0.08)]",
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className={cn("text-sm", item.read ? "text-zinc-400" : "text-zinc-100")}>
          {text}
        </p>
        <span className="text-xs text-zinc-600">
          {format.dateTime(item.createdAt, { dateStyle: "medium", timeStyle: "short" })}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {!item.read ? <Badge variant="neon">{t("notifications.unread")}</Badge> : null}
        {link ? (
          <Link href={link.href} className="text-xs text-neon hover:underline">
            {link.label}
          </Link>
        ) : null}
      </div>
    </li>
  );
}
