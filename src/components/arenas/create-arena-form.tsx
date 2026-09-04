"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useRouter } from "~/i18n/navigation";
import { EVAL_MODES, type EvalMode } from "~/lib/constants";
import { errorText } from "~/lib/error-text";
import { cn } from "~/lib/utils";
import { createArenaAction } from "~/server/actions/arena-actions";

interface CampOption {
  id: string;
  name: string;
}

const inputCls =
  "h-10 w-full rounded-lg border border-arena-border bg-arena-bg px-3 text-sm text-zinc-100 focus:border-neon/60 focus:outline-none focus:ring-1 focus:ring-neon/40";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-zinc-300">{label}</span>
      {children}
      {hint ? <span className="text-xs text-zinc-500">{hint}</span> : null}
    </div>
  );
}

/** Arena creation form; evalConfig fields adapt to the chosen evalMode. */
export function CreateArenaForm({ camps }: { camps: CampOption[] }) {
  const t = useTranslations("arenas");
  const router = useRouter();

  const [evalMode, setEvalMode] = useState<EvalMode>("VOTE");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // evalConfig field state
  const [autoEndpoint, setAutoEndpoint] = useState("");
  const [autoCases, setAutoCases] = useState("");
  const [judgeUrl, setJudgeUrl] = useState("");
  const [weightVote, setWeightVote] = useState("1");
  const [weightAuto, setWeightAuto] = useState("0");
  const [weightExternal, setWeightExternal] = useState("0");

  function parseCases(): Record<string, unknown>[] | null {
    try {
      const parsed: unknown = JSON.parse(autoCases);
      if (!Array.isArray(parsed)) return null;
      return parsed as Record<string, unknown>[];
    } catch {
      return null;
    }
  }

  function buildEvalConfig(): Record<string, unknown> | null {
    switch (evalMode) {
      case "AUTO": {
        const cases = parseCases();
        if (!cases) return null;
        return {
          cases,
          ...(autoEndpoint.trim() ? { endpoint: autoEndpoint.trim() } : {}),
        };
      }
      case "EXTERNAL":
        return { judgeUrl: judgeUrl.trim() };
      case "HYBRID": {
        const vote = Number(weightVote) || 0;
        const auto = Number(weightAuto) || 0;
        const external = Number(weightExternal) || 0;
        const config: Record<string, unknown> = {
          weights: {
            ...(vote > 0 ? { vote } : {}),
            ...(auto > 0 ? { auto } : {}),
            ...(external > 0 ? { external } : {}),
          },
        };
        if (auto > 0) {
          const cases = parseCases();
          if (!cases) return null;
          config.auto = {
            cases,
            ...(autoEndpoint.trim() ? { endpoint: autoEndpoint.trim() } : {}),
          };
        }
        if (external > 0) {
          config.external = { judgeUrl: judgeUrl.trim() };
        }
        return config;
      }
      default:
        return {};
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);

    const evalConfig = buildEvalConfig();
    if (!evalConfig) {
      setError(t("create.config.invalidJson"));
      return;
    }

    const campName = String(form.get("campName") ?? "").trim();
    const camp = campName ? camps.find((c) => c.name === campName) : undefined;
    if (campName && !camp) {
      setError(t("create.campUnknown"));
      return;
    }

    const deadline = String(form.get("deadline") ?? "").trim();

    setPending(true);
    const res = await createArenaAction({
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      initialStandard: String(form.get("initialStandard") ?? ""),
      evalMode,
      evalConfig,
      ...(camp ? { campId: camp.id } : {}),
      ...(deadline ? { deadline: new Date(deadline).toISOString() } : {}),
    });
    setPending(false);
    if (!res.ok) {
      setError(errorText(t, res.code, res.message));
      return;
    }
    router.push(`/arenas/${res.id}`);
    router.refresh();
  }

  const showAuto = evalMode === "AUTO" || (evalMode === "HYBRID" && Number(weightAuto) > 0);
  const showExternal =
    evalMode === "EXTERNAL" || (evalMode === "HYBRID" && Number(weightExternal) > 0);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <Field label={t("create.name")}>
        <Input id="title" name="title" required maxLength={200} placeholder={t("create.namePlaceholder")} />
      </Field>

      <Field label={t("create.description")}>
        <Textarea
          id="description"
          name="description"
          required
          maxLength={20000}
          placeholder={t("create.descriptionPlaceholder")}
        />
      </Field>

      <Field label={t("create.initialStandard")} hint={t("create.initialStandardHint")}>
        <Textarea id="initialStandard" name="initialStandard" required maxLength={50000} className="min-h-40" />
      </Field>

      <Field label={t("create.evalModeLabel")}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {EVAL_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setEvalMode(mode)}
              aria-pressed={evalMode === mode}
              className={cn(
                "rounded-lg border px-3 py-2.5 text-left transition-colors",
                evalMode === mode
                  ? "border-neon/60 bg-neon/10"
                  : "border-arena-border bg-arena-bg hover:border-zinc-600",
              )}
            >
              <span className={cn("block text-sm font-semibold", evalMode === mode ? "text-neon" : "text-zinc-200")}>
                {t(`evalMode.${mode}`)}
              </span>
              <span className="mt-1 block text-xs text-zinc-500">
                {t(`evalModeDesc.${mode}`)}
              </span>
            </button>
          ))}
        </div>
      </Field>

      {evalMode === "HYBRID" ? (
        <Field label={t("create.config.weights")}>
          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1 text-xs text-zinc-400">
              {t("create.config.weightVote")}
              <input
                type="number"
                min={0}
                step="any"
                value={weightVote}
                onChange={(e) => setWeightVote(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-400">
              {t("create.config.weightAuto")}
              <input
                type="number"
                min={0}
                step="any"
                value={weightAuto}
                onChange={(e) => setWeightAuto(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-400">
              {t("create.config.weightExternal")}
              <input
                type="number"
                min={0}
                step="any"
                value={weightExternal}
                onChange={(e) => setWeightExternal(e.target.value)}
                className={inputCls}
              />
            </label>
          </div>
        </Field>
      ) : null}

      {showAuto ? (
        <Field
          label={evalMode === "HYBRID" ? t("create.config.hybridAutoConfig") : t("create.config.autoCases")}
          hint={t("create.config.autoCasesHint")}
        >
          <Textarea
            value={autoCases}
            onChange={(e) => setAutoCases(e.target.value)}
            placeholder='[{"input": "2+2", "expected": "4", "match": "exact"}]'
            className="min-h-28 font-mono text-xs"
          />
          <Input
            value={autoEndpoint}
            onChange={(e) => setAutoEndpoint(e.target.value)}
            placeholder={t("create.config.autoEndpoint")}
            type="url"
            className="mt-2"
          />
          <span className="text-xs text-zinc-500">{t("create.config.autoEndpointHint")}</span>
        </Field>
      ) : null}

      {showExternal ? (
        <Field
          label={evalMode === "HYBRID" ? t("create.config.hybridExternalConfig") : t("create.config.judgeUrl")}
          hint={t("create.config.judgeUrlHint")}
        >
          <Input
            value={judgeUrl}
            onChange={(e) => setJudgeUrl(e.target.value)}
            placeholder="https://judge.example.com/evaluate"
            type="url"
          />
        </Field>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("create.camp")}>
          <Input
            id="campName"
            name="campName"
            list="arena-camp-options"
            placeholder={t("create.campPlaceholder")}
            autoComplete="off"
          />
          <datalist id="arena-camp-options">
            {camps.map((camp) => (
              <option key={camp.id} value={camp.name} />
            ))}
          </datalist>
        </Field>
        <Field label={t("create.deadline")}>
          <Input id="deadline" name="deadline" type="datetime-local" />
        </Field>
      </div>

      {error ? <p className="text-xs text-red-400">{error}</p> : null}

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t("create.submitting") : t("create.submit")}
        </Button>
      </div>
    </form>
  );
}
