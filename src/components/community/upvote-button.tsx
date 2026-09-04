"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { ActionMessage, type ActionError } from "~/components/community/action-message";
import { Link, useRouter } from "~/i18n/navigation";
import { upvotePostAction } from "~/server/actions/community-actions";
import { cn } from "~/lib/utils";

/** Upvote button for a forum post; shows the live count returned by the action. */
export function UpvoteButton({
  postId,
  initialUpvotes,
  loggedIn,
}: {
  postId: string;
  initialUpvotes: number;
  loggedIn: boolean;
}) {
  const t = useTranslations("community");
  const router = useRouter();
  const [upvotes, setUpvotes] = useState(initialUpvotes);
  const [counted, setCounted] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);
  const [pending, startTransition] = useTransition();

  if (!loggedIn) {
    return (
      <Link href="/login">
        <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-arena-border px-4 text-sm text-zinc-400 transition-colors hover:border-neon/60 hover:text-neon">
          ▲ {upvotes} · {t("post.upvote")}
        </span>
      </Link>
    );
  }

  function upvote() {
    if (counted) return;
    setError(null);
    startTransition(async () => {
      const result = await upvotePostAction(postId);
      if (!result.ok) {
        setError({ code: result.code, message: result.message });
        return;
      }
      setUpvotes(result.data.upvotes);
      setCounted(result.data.counted);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={upvote}
        disabled={pending || counted}
        className={cn(
          "inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors",
          counted
            ? "border-neon/60 bg-neon/10 text-neon"
            : "border-arena-border text-zinc-300 hover:border-neon/60 hover:text-neon",
          (pending || counted) && "cursor-default",
        )}
      >
        ▲ {upvotes} · {counted ? t("post.upvoted") : t("post.upvote")}
      </button>
      <ActionMessage error={error} />
    </div>
  );
}
