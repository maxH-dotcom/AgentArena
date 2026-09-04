"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Link, useRouter } from "~/i18n/navigation";
import { errorText } from "~/lib/error-text";

const selectCls =
  "h-9 rounded-lg border border-arena-border bg-arena-bg px-3 text-sm text-zinc-100 focus:border-neon/60 focus:outline-none focus:ring-1 focus:ring-neon/40";

export interface DuelEntryOption {
  id: string;
  agentId: string;
  agentName: string;
}

/**
 * DUEL arena: pick two entered agents and create a match via the existing
 * REST endpoint (POST /api/v1/matches). Any signed-in actor may start a match.
 */
export function DuelMatchMaker({
  arenaId,
  entries,
}: {
  arenaId: string;
  entries: DuelEntryOption[];
}) {
  const t = useTranslations("arenas");
  const router = useRouter();
  const [agentAId, setAgentAId] = useState("");
  const [agentBId, setAgentBId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  async function start() {
    if (!agentAId || !agentBId || agentAId === agentBId) return;
    setPending(true);
    setError(null);
    setCreatedId(null);
    const res = await fetch("/api/v1/matches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ arenaId, agentAId, agentBId }),
    });
    setPending(false);
    const body = (await res.json().catch(() => null)) as {
      id?: string;
      error?: { code?: string; message?: string };
    } | null;
    if (!res.ok) {
      setError(
        errorText(t, body?.error?.code ?? "INTERNAL", body?.error?.message ?? res.statusText),
      );
      return;
    }
    setCreatedId(body?.id ?? null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-zinc-500">{t("detail.duel.pick")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={agentAId}
          onChange={(e) => setAgentAId(e.target.value)}
          className={selectCls}
          aria-label="Agent A"
        >
          <option value="">—</option>
          {entries.map((entry) => (
            <option key={entry.id} value={entry.agentId} disabled={entry.agentId === agentBId}>
              {entry.agentName}
            </option>
          ))}
        </select>
        <span className="text-xs font-bold text-flare">VS</span>
        <select
          value={agentBId}
          onChange={(e) => setAgentBId(e.target.value)}
          className={selectCls}
          aria-label="Agent B"
        >
          <option value="">—</option>
          {entries.map((entry) => (
            <option key={entry.id} value={entry.agentId} disabled={entry.agentId === agentAId}>
              {entry.agentName}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          disabled={pending || !agentAId || !agentBId || agentAId === agentBId}
          onClick={() => void start()}
        >
          {pending ? t("detail.duel.starting") : t("detail.duel.startButton")}
        </Button>
      </div>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      {createdId ? (
        <p className="text-xs text-volt">
          {t("detail.duel.created")}{" "}
          <Link href={`/matches/${createdId}`} className="text-neon hover:underline">
            {t("detail.duel.watch")} →
          </Link>
        </p>
      ) : null}
    </div>
  );
}
