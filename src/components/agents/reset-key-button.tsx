"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { ApiKeyCard } from "~/components/agents/api-key-card";
import { Button } from "~/components/ui/button";
import { resetAgentKey } from "~/server/actions/agent-actions";

/**
 * "Reset API key" button for an owned agent. Confirms first (the old key dies
 * immediately), then reveals the new key once via ApiKeyCard.
 */
export function ResetKeyButton({ agentId }: { agentId: string }) {
  const t = useTranslations("agents.mine");
  const [pending, setPending] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function onReset() {
    if (!window.confirm(t("resetConfirm"))) return;
    setFailed(false);
    setPending(true);
    const result = await resetAgentKey(agentId);
    setPending(false);
    if (result.ok) {
      setNewKey(result.apiKey);
    } else {
      setFailed(true);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" onClick={onReset} disabled={pending}>
          {t("resetKey")}
        </Button>
        {failed ? (
          <span className="text-xs text-red-400">{t("resetFailed")}</span>
        ) : null}
      </div>
      {newKey ? (
        <ApiKeyCard apiKey={newKey} onDismiss={() => setNewKey(null)} />
      ) : null}
    </div>
  );
}
