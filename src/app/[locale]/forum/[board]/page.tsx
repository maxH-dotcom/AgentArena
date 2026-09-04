import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";

import { ActorLink } from "~/components/community/actor-link";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { Link } from "~/i18n/navigation";
import { POST_BOARDS, type PostBoard } from "~/lib/constants";
import { getActor } from "~/server/actor";
import { db } from "~/server/db";
import { listPosts } from "~/server/services/post";

const PAGE_SIZE = 20;

function parseBoard(raw: string): PostBoard {
  if (!(POST_BOARDS as readonly string[]).includes(raw)) notFound();
  return raw as PostBoard;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; board: string }>;
}): Promise<Metadata> {
  const { locale, board } = await params;
  const t = await getTranslations({ locale, namespace: "community" });
  if (!(POST_BOARDS as readonly string[]).includes(board)) return {};
  return { title: t(`forum.boards.${board as PostBoard}.name`) };
}

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; board: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { locale, board: rawBoard } = await params;
  const { cursor } = await searchParams;
  setRequestLocale(locale);
  const board = parseBoard(rawBoard);

  const [t, format, actor, result] = await Promise.all([
    getTranslations("community"),
    getFormatter({ locale }),
    getActor(),
    listPosts({ board, cursor, limit: PAGE_SIZE }),
  ]);

  // Comment counts for the current page (PostItem intentionally omits them).
  const postIds = result.items.map((p) => p.id);
  const commentCounts = postIds.length
    ? await db.comment.groupBy({
        by: ["targetId"],
        where: { targetType: "post", targetId: { in: postIds }, deletedAt: null },
        _count: { _all: true },
      })
    : [];
  const countByPost = new Map(commentCounts.map((c) => [c.targetId, c._count._all]));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Link href="/forum" className="text-xs text-zinc-500 hover:text-zinc-300">
            ← {t("forum.title")}
          </Link>
          <h1 className="text-2xl font-black tracking-tight text-zinc-100">
            {t(`forum.boards.${board}.name`)}
          </h1>
          <p className="max-w-2xl text-sm text-zinc-400">
            {t(`forum.boards.${board}.description`)}
          </p>
        </div>
        {actor ? (
          <Link href={`/posts/new?board=${board}`}>
            <Button>{t("forum.newPost")}</Button>
          </Link>
        ) : null}
      </header>

      {result.items.length === 0 ? (
        <EmptyState title={t("forum.emptyBoard")} />
      ) : (
        <ul className="flex flex-col divide-y divide-arena-border rounded-xl border border-arena-border bg-arena-surface">
          {result.items.map((post) => (
            <li key={post.id} className="flex items-center gap-4 px-5 py-4">
              <div className="flex w-14 shrink-0 flex-col items-center rounded-lg border border-arena-border bg-arena-raised/50 py-1.5">
                <span className="text-sm font-bold text-neon">▲ {post.upvotes}</span>
                <span className="text-[10px] text-zinc-500">{t("forum.upvotes")}</span>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Link
                  href={`/posts/${post.id}`}
                  className="truncate text-sm font-semibold text-zinc-100 transition-colors hover:text-neon"
                >
                  {post.title}
                </Link>
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <ActorLink actor={post.author} size={16} className="text-xs" />
                  <span>·</span>
                  <span>{format.relativeTime(post.createdAt)}</span>
                </div>
              </div>
              <div className="shrink-0 text-xs text-zinc-500">
                {countByPost.get(post.id) ?? 0} {t("forum.comments")}
              </div>
            </li>
          ))}
        </ul>
      )}

      {(cursor || result.nextCursor) && (
        <div className="flex items-center justify-between">
          {cursor ? (
            <Link href={`/forum/${board}`}>
              <Button variant="outline" size="sm">
                {t("common.previousPage")}
              </Button>
            </Link>
          ) : (
            <span />
          )}
          {result.nextCursor ? (
            <Link href={`/forum/${board}?cursor=${result.nextCursor}`}>
              <Button variant="outline" size="sm">
                {t("common.nextPage")}
              </Button>
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
