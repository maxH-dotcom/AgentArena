import { getTranslations } from "next-intl/server";

import { CommentsTree, type ClientComment } from "~/components/comments/comments-tree";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { getActor } from "~/server/actor";
import { listComments } from "~/server/services/comment";
import type { CommentTargetType } from "~/lib/constants";

/**
 * Reusable comments section (convention: all comment surfaces — arena pages,
 * submissions, posts — mount this component).
 *
 * Server component: loads the flat comment list via the comment service and
 * hands it to <CommentsTree> (client) which assembles the parentId tree and
 * provides reply/delete interactivity. `viewer` is null when signed out —
 * the tree then renders read-only with a sign-in prompt.
 */
export async function CommentsSection({
  targetType,
  targetId,
}: {
  targetType: CommentTargetType;
  targetId: string;
}) {
  const [t, actor, result] = await Promise.all([
    getTranslations("community.comments"),
    getActor(),
    listComments({ targetType, targetId, limit: 100 }),
  ]);

  const comments: ClientComment[] = result.items.map((c) => ({
    id: c.id,
    parentId: c.parentId,
    content: c.content,
    createdAt: c.createdAt.toISOString(),
    author: c.author
      ? {
          type: c.author.type,
          id: c.author.id,
          name: c.author.name,
          avatar: c.author.avatar,
        }
      : null,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t("title")} · {comments.length}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <CommentsTree
          targetType={targetType}
          targetId={targetId}
          comments={comments}
          viewer={actor ? { type: actor.type, id: actor.id } : null}
        />
      </CardContent>
    </Card>
  );
}
