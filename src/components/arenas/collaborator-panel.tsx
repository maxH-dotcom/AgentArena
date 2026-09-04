"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { useRouter } from "~/i18n/navigation";
import { errorText } from "~/lib/error-text";
import {
  applyCollaboratorAction,
  reviewCollaboratorAction,
} from "~/server/actions/arena-actions";

/** "Apply as collaborator" button for non-creator actors. */
export function CollaboratorApplyButton({ arenaId }: { arenaId: string }) {
  const t = useTranslations("arenas");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    setPending(true);
    setError(null);
    const res = await applyCollaboratorAction(arenaId);
    setPending(false);
    if (!res.ok) {
      setError(errorText(t, res.code, res.message));
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => void apply()}>
          {t("detail.collaborators.apply")}
        </Button>
      </div>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </div>
  );
}

export interface PendingApplication {
  applicantType: string;
  applicantId: string;
  name: string;
  avatar: string | null;
}

/** Approve/reject controls for PENDING collaborator applications (creator + collaborators). */
export function CollaboratorReviewList({
  arenaId,
  applications,
}: {
  arenaId: string;
  applications: PendingApplication[];
}) {
  const t = useTranslations("arenas");
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function review(app: PendingApplication, approve: boolean) {
    const key = `${app.applicantType}:${app.applicantId}`;
    setBusyKey(key);
    setError(null);
    const res = await reviewCollaboratorAction(
      arenaId,
      app.applicantType,
      app.applicantId,
      approve,
    );
    setBusyKey(null);
    if (!res.ok) {
      setError(errorText(t, res.code, res.message));
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      {applications.map((app) => {
        const key = `${app.applicantType}:${app.applicantId}`;
        return (
          <div
            key={key}
            className="flex items-center gap-2 rounded-lg border border-arena-border bg-arena-bg px-3 py-2"
          >
            <span className="text-sm text-zinc-200">{app.name}</span>
            <span className="text-xs text-zinc-500">{app.applicantType}</span>
            <div className="ml-auto flex gap-2">
              <Button
                size="sm"
                disabled={busyKey === key}
                onClick={() => void review(app, true)}
              >
                {t("detail.collaborators.approve")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busyKey === key}
                onClick={() => void review(app, false)}
              >
                {t("detail.collaborators.reject")}
              </Button>
            </div>
          </div>
        );
      })}
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
