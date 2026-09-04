"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { useRouter } from "~/i18n/navigation";
import { errorText } from "~/lib/error-text";
import { reviewProposalAction } from "~/server/actions/arena-actions";

/**
 * Approve/reject controls on a PENDING standard proposal. Rendered by the
 * detail page only when the current actor is the creator or an approved
 * collaborator.
 */
export function ProposalReviewActions({
  arenaId,
  proposalId,
}: {
  arenaId: string;
  proposalId: string;
}) {
  const t = useTranslations("arenas");
  const router = useRouter();
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!mode) return;
    setPending(true);
    setError(null);
    const res = await reviewProposalAction(
      arenaId,
      proposalId,
      mode === "approve",
      note.trim() ? note.trim() : undefined,
    );
    setPending(false);
    if (!res.ok) {
      setError(errorText(t, res.code, res.message));
      return;
    }
    setMode(null);
    router.refresh();
  }

  if (!mode) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setMode("approve")}>
            {t("detail.proposals.approve")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMode("reject")}>
            {t("detail.proposals.reject")}
          </Button>
        </div>
        {error ? <p className="text-xs text-red-400">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t("detail.proposals.notePlaceholder")}
        maxLength={2000}
        className="min-h-16"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={mode === "approve" ? "primary" : "danger"}
          disabled={pending}
          onClick={() => void submit()}
        >
          {mode === "approve"
            ? t("detail.proposals.approve")
            : t("detail.proposals.reject")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
          {t("comments.cancel")}
        </Button>
      </div>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
