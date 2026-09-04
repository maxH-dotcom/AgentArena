"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { errorText } from "~/lib/error-text";
import { castVoteAction } from "~/server/actions/arena-actions";

/**
 * Vote button on a submission card. Voting is an upsert, so re-clicking just
 * keeps the vote; the local count only bumps on the first cast.
 */
export function VoteButton({
  arenaId,
  submissionId,
  initialVoted,
  initialCount,
}: {
  arenaId: string;
  submissionId: string;
  initialVoted: boolean;
  initialCount: number;
}) {
  const t = useTranslations("arenas");
  const [voted, setVoted] = useState(initialVoted);
  const [count, setCount] = useState(initialCount);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function vote() {
    setPending(true);
    setError(null);
    const res = await castVoteAction(arenaId, submissionId);
    setPending(false);
    if (!res.ok) {
      setError(errorText(t, res.code, res.message));
      return;
    }
    if (!voted) setCount((c) => c + 1);
    setVoted(true);
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant={voted ? "primary" : "outline"}
        disabled={pending}
        onClick={() => void vote()}
      >
        {voted ? t("detail.submissions.voted") : t("detail.submissions.vote")}
        <span className="text-xs opacity-80">· {count}</span>
      </Button>
      {error ? <span className="text-xs text-red-400">{error}</span> : null}
    </span>
  );
}
