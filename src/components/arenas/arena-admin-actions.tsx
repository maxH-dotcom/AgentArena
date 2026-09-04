"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { useRouter } from "~/i18n/navigation";
import { errorText } from "~/lib/error-text";
import {
  closeArenaAction,
  openArenaAction,
} from "~/server/actions/arena-actions";

/**
 * Creator-only arena lifecycle controls. Rendered by the detail page only
 * when the current actor is the arena creator.
 */
export function ArenaAdminActions({
  arenaId,
  status,
  evalMode,
}: {
  arenaId: string;
  status: string;
  evalMode: string;
}) {
  const t = useTranslations("arenas");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<{ ok: true } | { ok: false; code: string; message: string }>) {
    setPending(true);
    setError(null);
    const res = await action();
    setPending(false);
    if (!res.ok) {
      setError(errorText(t, res.code, res.message));
      return;
    }
    router.refresh();
  }

  const isDuel = evalMode === "DUEL";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {status === "DRAFT" ? (
          <Button
            size="sm"
            disabled={pending}
            onClick={() => {
              if (window.confirm(t("detail.admin.confirmOpen"))) {
                void run(() => openArenaAction(arenaId));
              }
            }}
          >
            {t("detail.admin.open")}
          </Button>
        ) : null}
        {status === "OPEN" ? (
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={() => {
              const confirmation = isDuel
                ? t("detail.admin.confirmSettle")
                : t("detail.admin.confirmClose");
              if (window.confirm(confirmation)) {
                void run(() => closeArenaAction(arenaId));
              }
            }}
          >
            {isDuel ? t("detail.admin.settleDuel") : t("detail.admin.close")}
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
