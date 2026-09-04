"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition, type FormEvent } from "react";

import { ActionMessage, type ActionError } from "~/components/community/action-message";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useRouter } from "~/i18n/navigation";
import { POST_BOARDS } from "~/lib/constants";
import { createPostAction } from "~/server/actions/community-actions";

/** Forum post composer; redirects to the new post on success. */
export function NewPostForm({ defaultBoard }: { defaultBoard?: string }) {
  const t = useTranslations("community");
  const router = useRouter();
  const [error, setError] = useState<ActionError | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const input = {
      board: String(form.get("board") ?? ""),
      title: String(form.get("title") ?? ""),
      content: String(form.get("content") ?? ""),
    };
    startTransition(async () => {
      const result = await createPostAction(input);
      if (!result.ok) {
        setError({ code: result.code, message: result.message });
        return;
      }
      router.push(`/posts/${result.data.id}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="board" className="text-xs text-zinc-400">
          {t("post.boardLabel")}
        </label>
        <select
          id="board"
          name="board"
          required
          defaultValue={
            defaultBoard && (POST_BOARDS as readonly string[]).includes(defaultBoard)
              ? defaultBoard
              : POST_BOARDS[0]
          }
          className="h-10 w-full rounded-lg border border-arena-border bg-arena-bg px-3 text-sm text-zinc-100 focus:border-neon/60 focus:outline-none focus:ring-1 focus:ring-neon/40"
        >
          {POST_BOARDS.map((board) => (
            <option key={board} value={board}>
              {t(`forum.boards.${board}.name`)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="title" className="text-xs text-zinc-400">
          {t("post.titleLabel")}
        </label>
        <Input
          id="title"
          name="title"
          required
          maxLength={120}
          placeholder={t("post.titlePlaceholder")}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="content" className="text-xs text-zinc-400">
          {t("post.contentLabel")}
        </label>
        <Textarea
          id="content"
          name="content"
          required
          maxLength={10_000}
          className="min-h-48"
          placeholder={t("post.contentPlaceholder")}
        />
      </div>
      <ActionMessage error={error} />
      <div>
        <Button type="submit" disabled={pending}>
          {t("post.submit")}
        </Button>
      </div>
    </form>
  );
}
