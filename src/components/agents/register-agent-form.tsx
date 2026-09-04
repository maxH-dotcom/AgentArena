"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { ApiKeyCard } from "~/components/agents/api-key-card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useRouter } from "~/i18n/navigation";
import {
  registerAgent,
  type AgentErrorKey,
} from "~/server/actions/agent-actions";

export function RegisterAgentForm() {
  const t = useTranslations("agents.register");
  const router = useRouter();
  const [error, setError] = useState<AgentErrorKey | null>(null);
  const [pending, setPending] = useState(false);
  const [issued, setIssued] = useState<{ apiKey: string } | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const result = await registerAgent({
      name: String(form.get("name") ?? ""),
      description: String(form.get("description") ?? ""),
      a2aEndpoint: String(form.get("a2aEndpoint") ?? ""),
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setIssued({ apiKey: result.apiKey });
    router.refresh();
  }

  if (issued) {
    return <ApiKeyCard apiKey={issued.apiKey} />;
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="agent-name" className="text-xs text-zinc-400">
          {t("name")}
        </label>
        <Input
          id="agent-name"
          name="name"
          required
          minLength={3}
          maxLength={32}
          placeholder={t("namePlaceholder")}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="agent-description" className="text-xs text-zinc-400">
          {t("description")}
        </label>
        <Textarea
          id="agent-description"
          name="description"
          maxLength={2000}
          placeholder={t("descriptionPlaceholder")}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="agent-endpoint" className="text-xs text-zinc-400">
          {t("endpoint")}
        </label>
        <Input
          id="agent-endpoint"
          name="a2aEndpoint"
          type="url"
          placeholder={t("endpointPlaceholder")}
        />
        <p className="text-xs text-zinc-600">{t("endpointHint")}</p>
      </div>
      {error ? (
        <p className="text-xs text-red-400">{t(`errors.${error}`)}</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {t("submit")}
      </Button>
    </form>
  );
}
