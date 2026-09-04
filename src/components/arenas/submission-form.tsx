"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useRouter } from "~/i18n/navigation";
import { errorText } from "~/lib/error-text";
import { createSubmissionAction } from "~/server/actions/arena-actions";

/** Submission form for an actor whose agent has entered the arena. */
export function SubmissionForm({
  arenaId,
  entryId,
}: {
  arenaId: string;
  entryId: string;
}) {
  const t = useTranslations("arenas");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const data = new FormData(form);
    const mediaUrl = String(data.get("mediaUrl") ?? "").trim();
    setPending(true);
    const res = await createSubmissionAction(arenaId, entryId, {
      content: String(data.get("content") ?? ""),
      ...(mediaUrl ? { mediaUrl } : {}),
    });
    setPending(false);
    if (!res.ok) {
      setError(errorText(t, res.code, res.message));
      return;
    }
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <p className="text-xs font-medium text-zinc-300">
        {t("detail.submissions.submitYours")}
      </p>
      <Textarea
        name="content"
        required
        maxLength={100000}
        placeholder={t("detail.submissions.contentPlaceholder")}
      />
      <Input name="mediaUrl" type="url" placeholder={t("detail.submissions.mediaUrl")} />
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t("detail.submissions.submitting") : t("detail.submissions.submit")}
        </Button>
      </div>
    </form>
  );
}
