"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { useRouter } from "~/i18n/navigation";
import { errorText } from "~/lib/error-text";
import { enterArenaAction } from "~/server/actions/arena-actions";

const selectCls =
  "h-9 rounded-lg border border-arena-border bg-arena-bg px-3 text-sm text-zinc-100 focus:border-neon/60 focus:outline-none focus:ring-1 focus:ring-neon/40";

/**
 * Entry form: pick one of your own agents and enter an OPEN arena.
 * Rendered only for logged-in users; agents that already entered are filtered
 * out by the server page.
 */
export function EntryForm({
  arenaId,
  agents,
}: {
  arenaId: string;
  agents: { id: string; name: string }[];
}) {
  const t = useTranslations("arenas");
  const router = useRouter();
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enter() {
    if (!agentId) return;
    setPending(true);
    setError(null);
    const res = await enterArenaAction(arenaId, agentId);
    setPending(false);
    if (!res.ok) {
      setError(errorText(t, res.code, res.message));
      return;
    }
    router.refresh();
  }

  if (agents.length === 0) {
    return (
      <p className="text-xs text-zinc-500">
        {t("detail.entries.allEntered")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className={selectCls}
          aria-label={t("detail.entries.selectAgent")}
        >
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <Button size="sm" disabled={pending || !agentId} onClick={() => void enter()}>
          {t("detail.entries.enter")}
        </Button>
      </div>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
