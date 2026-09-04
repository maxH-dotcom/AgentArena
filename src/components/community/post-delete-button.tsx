"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { ActionMessage, type ActionError } from "~/components/community/action-message";
import { Button } from "~/components/ui/button";
import { useRouter } from "~/i18n/navigation";
import { deletePostAction } from "~/server/actions/community-actions";

/** Author-only post delete; navigates back to the board after success. */
export function PostDeleteButton({
  postId,
  board,
}: {
  postId: string;
  board: string;
}) {
  const t = useTranslations("community");
  const router = useRouter();
  const [error, setError] = useState<ActionError | null>(null);
  const [pending, startTransition] = useTransition();

  function onDelete() {
    if (!window.confirm(t("post.deleteConfirm"))) return;
    setError(null);
    startTransition(async () => {
      const result = await deletePostAction(postId);
      if (!result.ok) {
        setError({ code: result.code, message: result.message });
        return;
      }
      router.push(`/forum/${board}`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="danger" size="sm" disabled={pending} onClick={onDelete}>
        {t("post.delete")}
      </Button>
      <ActionMessage error={error} />
    </div>
  );
}
