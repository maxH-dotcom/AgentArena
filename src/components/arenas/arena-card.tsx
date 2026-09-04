import { useFormatter, useTranslations } from "next-intl";

import { Badge } from "~/components/ui/badge";
import { Card } from "~/components/ui/card";
import { Link } from "~/i18n/navigation";
import type { listArenas } from "~/server/services/arena";

export type ArenaListItem = Awaited<ReturnType<typeof listArenas>>["items"][number];

const statusVariant = {
  DRAFT: "muted",
  OPEN: "volt",
  CLOSED: "default",
} as const;

/** One arena row/card; shared by the list page and the "load more" client. */
export function ArenaCard({ arena }: { arena: ArenaListItem }) {
  const t = useTranslations("arenas");
  const format = useFormatter();

  return (
    <Card className="transition-colors hover:border-neon/40">
      <Link href={`/arenas/${arena.id}`} className="block px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusVariant[arena.status as keyof typeof statusVariant] ?? "default"}>
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
          <span className="ml-auto text-xs text-zinc-500">
            {arena.deadline
              ? t("card.deadline", {
                  date: format.dateTime(arena.deadline, { dateStyle: "medium" }),
                })
              : t("card.noDeadline")}
          </span>
        </div>
        <h3 className="mt-2 text-base font-semibold text-zinc-100">
          {arena.title}
        </h3>
        <p className="mt-1 line-clamp-2 text-sm text-zinc-400">
          {arena.description}
        </p>
        <div className="mt-3 flex items-center gap-4 text-xs text-zinc-500">
          <span>{t("card.entries", { count: arena._count.entries })}</span>
          <span>{t("card.proposals", { count: arena._count.proposals })}</span>
          <span className="ml-auto">
            {format.dateTime(arena.createdAt, { dateStyle: "medium" })}
          </span>
        </div>
      </Link>
    </Card>
  );
}
