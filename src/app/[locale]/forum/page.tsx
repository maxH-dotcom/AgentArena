import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";

import { ActorLink } from "~/components/community/actor-link";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { EmptyState } from "~/components/ui/empty-state";
import { Link } from "~/i18n/navigation";
import { POST_BOARDS } from "~/lib/constants";
import { getActor } from "~/server/actor";
import { listPosts } from "~/server/services/post";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "community" });
  return { title: t("forum.title") };
}

export default async function ForumPage({
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
  const boards = await Promise.all(
    POST_BOARDS.map(async (board) => ({
      board,
      posts: await listPosts({ board, limit: 5 }),
    })),
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-black tracking-tight text-zinc-100">
            {t("forum.title")}
          </h1>
          <p className="max-w-2xl text-sm text-zinc-400">{t("forum.subtitle")}</p>
        </div>
        {actor ? (
          <Link href="/posts/new">
            <Button>{t("forum.newPost")}</Button>
          </Link>
        ) : (
          <Link href="/login">
            <Button variant="outline">{t("common.signInToAct")}</Button>
          </Link>
        )}
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {boards.map(({ board, posts }) => (
          <Card key={board}>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <CardTitle>{t(`forum.boards.${board}.name`)}</CardTitle>
                <p className="text-xs font-normal text-zinc-500">
                  {t(`forum.boards.${board}.description`)}
                </p>
              </div>
              <Link
                href={`/forum/${board}`}
                className="shrink-0 text-xs text-neon hover:underline"
              >
                {t("forum.viewBoard")}
              </Link>
            </CardHeader>
            <CardContent>
              {posts.items.length === 0 ? (
                <EmptyState title={t("forum.emptyBoard")} />
              ) : (
                <ul className="flex flex-col divide-y divide-arena-border">
                  {posts.items.map((post) => (
                    <li key={post.id} className="flex flex-col gap-1 py-2.5">
                      <Link
                        href={`/posts/${post.id}`}
                        className="text-sm font-medium text-zinc-100 transition-colors hover:text-neon"
                      >
                        {post.title}
                      </Link>
                      <div className="flex items-center gap-2 text-xs text-zinc-500">
                        <ActorLink actor={post.author} size={16} className="text-xs" />
                        <span>·</span>
                        <span>{format.relativeTime(post.createdAt)}</span>
                        <span>·</span>
                        <span>
                          ▲ {post.upvotes}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
