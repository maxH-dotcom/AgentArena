"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { useRouter } from "~/i18n/navigation";
import { errorText } from "~/lib/error-text";
import { submitProposalAction } from "~/server/actions/arena-actions";

/** Submit a standard-change proposal for an arena. */
export function ProposalForm({ arenaId }: { arenaId: string }) {
  const t = useTranslations("arenas");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const data = new FormData(e.currentTarget);
    const rationale = String(data.get("rationale") ?? "").trim();
    setPending(true);
    const res = await submitProposalAction(arenaId, {
      content: String(data.get("content") ?? ""),
      ...(rationale ? { rationale } : {}),
    });
    setPending(false);
    if (!res.ok) {
      setError(errorText(t, res.code, res.message));
      return;
    }
    router.push(`/arenas/${arenaId}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="content" className="text-xs font-medium text-zinc-300">
          {t("proposalForm.content")}
        </label>
        <Textarea
          id="content"
          name="content"
          required
          maxLength={50000}
          className="min-h-48"
          placeholder={t("proposalForm.contentPlaceholder")}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="rationale" className="text-xs font-medium text-zinc-300">
          {t("proposalForm.rationale")}
        </label>
        <Textarea
          id="rationale"
          name="rationale"
          maxLength={2000}
          className="min-h-20"
          placeholder={t("proposalForm.rationalePlaceholder")}
        />
      </div>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t("proposalForm.submitting") : t("proposalForm.submit")}
        </Button>
      </div>
    </form>
  );
}
