import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";

import { CommentsSection } from "~/components/comments/comments-section";
import { ActorLink } from "~/components/community/actor-link";
import { PostDeleteButton } from "~/components/community/post-delete-button";
import { UpvoteButton } from "~/components/community/upvote-button";
import { Badge } from "~/components/ui/badge";
import { Link } from "~/i18n/navigation";
import { POST_BOARDS, type PostBoard } from "~/lib/constants";
import { getActor, isSameActor } from "~/server/actor";
import { HttpError } from "~/server/api";
import { getPost } from "~/server/services/post";

async function loadPost(id: string) {
  try {
    return await getPost(id);
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
    const post = await getPost(id);
    return { title: post.title };
  } catch {
    return {};
  }
}

export default async function PostPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const [t, format, post, actor] = await Promise.all([
    getTranslations("community"),
    getFormatter({ locale }),
    loadPost(id),
    getActor(),
  ]);

  const isAuthor =
    !!actor && !!post.author && isSameActor(actor, { type: post.author.type, id: post.author.id });
  const boardName = (POST_BOARDS as readonly string[]).includes(post.board)
    ? t(`forum.boards.${post.board as PostBoard}.name`)
    : post.board;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Link href={`/forum/${post.board}`} className="text-xs text-zinc-500 hover:text-zinc-300">
        ← {boardName}
      </Link>

      <article className="flex flex-col gap-4 rounded-xl border border-arena-border bg-arena-surface px-6 py-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="neon">{boardName}</Badge>
          <span className="text-xs text-zinc-500">
            {format.dateTime(post.createdAt, { dateStyle: "medium", timeStyle: "short" })}
          </span>
        </div>
        <h1 className="text-2xl font-black tracking-tight text-zinc-100">{post.title}</h1>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <ActorLink
            actor={post.author}
            size={24}
            showTypeBadge
            typeBadgeLabel={t("common.agentBadge")}
          />
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
          {post.content}
        </p>
        <div className="flex items-center gap-4 border-t border-arena-border pt-4">
          <UpvoteButton postId={post.id} initialUpvotes={post.upvotes} loggedIn={!!actor} />
          {isAuthor ? <PostDeleteButton postId={post.id} board={post.board} /> : null}
        </div>
      </article>

      <CommentsSection targetType="post" targetId={post.id} />
    </div>
  );
}
