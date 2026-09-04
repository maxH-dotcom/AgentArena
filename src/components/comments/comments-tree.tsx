"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition, type FormEvent } from "react";

import { ActionMessage, type ActionError } from "~/components/community/action-message";
import { ActorLink, type ActorDisplay } from "~/components/community/actor-link";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Link, useRouter } from "~/i18n/navigation";
import { cn } from "~/lib/utils";
import {
  createCommentAction,
  deleteCommentAction,
} from "~/server/actions/community-actions";

/** Serializable comment shape handed from <CommentsSection> (server) to this tree. */
export interface ClientComment {
  id: string;
  parentId: string | null;
  content: string;
  /** ISO timestamp */
  createdAt: string;
  author: ActorDisplay | null;
}

interface TreeNode extends ClientComment {
  children: TreeNode[];
}

function buildTree(comments: ClientComment[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  for (const c of comments) nodes.set(c.id, { ...c, children: [] });
  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/**
 * Flat-in, nested-out comment list with reply + author-delete. Used by
 * <CommentsSection>; do not mount directly (the section owns data loading).
 */
export function CommentsTree({
  targetType,
  targetId,
  comments,
  viewer,
}: {
  targetType: string;
  targetId: string;
  comments: ClientComment[];
  viewer: { type: string; id: string } | null;
}) {
  const t = useTranslations("community");
  const roots = buildTree(comments);

  return (
    <div className="flex flex-col gap-4">
      {roots.length === 0 ? (
        <p className="py-4 text-center text-xs text-zinc-500">
          {t("comments.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {roots.map((node) => (
            <CommentNode
              key={node.id}
              node={node}
              depth={0}
              targetType={targetType}
              targetId={targetId}
              viewer={viewer}
            />
          ))}
        </ul>
      )}

      {viewer ? (
        <CommentForm targetType={targetType} targetId={targetId} />
      ) : (
        <p className="text-xs text-zinc-500">
          <Link href="/login" className="text-neon hover:underline">
            {t("common.signInToAct")}
          </Link>
        </p>
      )}
    </div>
  );
}

function CommentNode({
  node,
  depth,
  targetType,
  targetId,
  viewer,
}: {
  node: TreeNode;
  depth: number;
  targetType: string;
  targetId: string;
  viewer: { type: string; id: string } | null;
}) {
  const t = useTranslations("community");
  const locale = useLocale();
  const router = useRouter();
  const [replying, setReplying] = useState(false);
  const [pending, startTransition] = useTransition();

  const isAuthor =
    !!viewer && !!node.author && viewer.type === node.author.type && viewer.id === node.author.id;
  const time = new Date(node.createdAt).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  function onDelete() {
    if (!window.confirm(t("comments.deleteConfirm"))) return;
    startTransition(async () => {
      await deleteCommentAction(node.id);
      router.refresh();
    });
  }

  return (
    <li className={cn("flex flex-col gap-3", depth > 0 && "ml-5 border-l border-arena-border pl-4")}>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <ActorLink
            actor={node.author}
            size={20}
            showTypeBadge
            typeBadgeLabel={t("common.agentBadge")}
          />
          <span>{time}</span>
        </div>
        <p className="whitespace-pre-wrap text-sm text-zinc-200">{node.content}</p>
        <div className="flex items-center gap-3">
          {viewer ? (
            <button
              type="button"
              onClick={() => setReplying((v) => !v)}
              className="text-xs text-zinc-500 transition-colors hover:text-neon"
            >
              {replying ? t("comments.cancelReply") : t("comments.reply")}
            </button>
          ) : null}
          {isAuthor ? (
            <button
              type="button"
              disabled={pending}
              onClick={onDelete}
              className="text-xs text-zinc-600 transition-colors hover:text-red-400"
            >
              {t("comments.delete")}
            </button>
          ) : null}
        </div>
        {replying && viewer ? (
          <CommentForm
            targetType={targetType}
            targetId={targetId}
            parentId={node.id}
            autoFocus
            onDone={() => setReplying(false)}
          />
        ) : null}
      </div>
      {node.children.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {node.children.map((child) => (
            <CommentNode
              key={child.id}
              node={child}
              depth={depth + 1}
              targetType={targetType}
              targetId={targetId}
              viewer={viewer}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function CommentForm({
  targetType,
  targetId,
  parentId,
  autoFocus,
  onDone,
}: {
  targetType: string;
  targetId: string;
  parentId?: string;
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const t = useTranslations("community");
  const router = useRouter();
  const [error, setError] = useState<ActionError | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const content = String(new FormData(form).get("content") ?? "");
    startTransition(async () => {
      const result = await createCommentAction({ targetType, targetId, content, parentId });
      if (!result.ok) {
        setError({ code: result.code, message: result.message });
        return;
      }
      form.reset();
      onDone?.();
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <Textarea
        name="content"
        required
        maxLength={5000}
        autoFocus={autoFocus}
        className="min-h-20"
        placeholder={t("comments.placeholder")}
      />
      <ActionMessage error={error} />
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {t("comments.submit")}
        </Button>
      </div>
    </form>
  );
}
