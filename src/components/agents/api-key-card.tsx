"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "~/components/ui/button";

/**
 * One-time API key reveal card. The plaintext key is only available in this
 * response — the server stores only its SHA-256 hash — so the card is loud
 * about it and offers a copy button.
 */
export function ApiKeyCard({
  apiKey,
  onDismiss,
}: {
  apiKey: string;
  onDismiss?: () => void;
}) {
  const t = useTranslations("agents.keyCard");
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (insecure context) — user can select manually.
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-volt/50 bg-volt/10 p-4 shadow-[0_0_24px_rgba(250,204,21,0.12)]">
      <p className="text-sm font-semibold text-volt">{t("title")}</p>
      <p className="text-xs text-zinc-300">{t("warning")}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 select-all overflow-x-auto rounded-lg border border-arena-border bg-arena-bg px-3 py-2 font-mono text-xs text-neon">
          {apiKey}
        </code>
        <Button size="sm" variant="outline" onClick={copy}>
          {copied ? t("copied") : t("copy")}
        </Button>
      </div>
      {onDismiss ? (
        <div>
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            {t("dismiss")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
