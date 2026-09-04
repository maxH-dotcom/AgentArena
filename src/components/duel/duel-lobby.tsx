"use client";

import { useCallback, useEffect, useState } from "react";

import { useTranslations } from "next-intl";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { EmptyState } from "~/components/ui/empty-state";
import { Link, useRouter } from "~/i18n/navigation";
import type { DuelMatchStatus } from "~/lib/constants";
import { cn } from "~/lib/utils";

const LIST_REFRESH_MS = 10_000;

export interface LobbyMatch {
  id: string;
  status: DuelMatchStatus;
  bestOf: number;
  roundWinsA: number;
  roundWinsB: number;
  winnerAgentId: string | null;
  arenaId: string | null;
  createdAt: string;
  agentA: { id: string; name: string };
  agentB: { id: string; name: string };
}

interface AgentOption {
  id: string;
  name: string;
  avatar: string | null;
  description: string | null;
}

const selectClass =
  "h-10 w-full rounded-lg border border-arena-border bg-arena-bg px-3 text-sm text-zinc-100 focus:border-neon/60 focus:outline-none focus:ring-1 focus:ring-neon/40 disabled:opacity-50";

export function DuelLobby({
  initialMatches,
  isAuthenticated,
}: {
  initialMatches: LobbyMatch[];
  isAuthenticated: boolean;
}) {
  const t = useTranslations("duel");
  const router = useRouter();

  // Re-render the server lists every 10s so live matches stay fresh.
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), LIST_REFRESH_MS);
    return () => clearInterval(timer);
  }, [router]);

  const running = initialMatches.filter(
    (m) => m.status === "RUNNING" || m.status === "QUEUED",
  );
  const done = initialMatches.filter((m) => m.status === "DONE");
  const cancelled = initialMatches.filter((m) => m.status === "CANCELLED");

  return (
    <div className="flex flex-col gap-8">
      <CreateMatchForm isAuthenticated={isAuthenticated} />

      <MatchSection
        title={t("sectionRunning")}
        matches={running}
        emptyText={t("emptyRunning")}
        live
      />
      <MatchSection title={t("sectionDone")} matches={done} emptyText={t("emptyDone")} />
      <MatchSection
        title={t("sectionCancelled")}
        matches={cancelled}
        emptyText={t("emptyCancelled")}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create-match form
// ---------------------------------------------------------------------------

function CreateMatchForm({ isAuthenticated }: { isAuthenticated: boolean }) {
  const t = useTranslations("duel");
  const router = useRouter();

  const [agents, setAgents] = useState<AgentOption[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [agentAId, setAgentAId] = useState("");
  const [agentBId, setAgentBId] = useState("");
  const [bestOf, setBestOf] = useState(3);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/agents?limit=50")
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as { items: AgentOption[] };
      })
      .then((data) => {
        if (!cancelled) setAgents(data.items);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = useCallback(async () => {
    setError(null);
    if (!agentAId || !agentBId || agentAId === agentBId) {
      setError(t("errorSameAgent"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentAId, agentBId, bestOf }),
      });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { id: string };
      router.push(`/matches/${data.id}`);
    } catch {
      setError(t("errorCreate"));
      setSubmitting(false);
    }
  }, [agentAId, agentBId, bestOf, router, t]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("createTitle")}</CardTitle>
        <p className="mt-1 text-xs text-zinc-500">{t("createSubtitle")}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!isAuthenticated ? (
          <div className="flex items-center justify-between gap-4 rounded-lg border border-arena-border bg-arena-raised px-4 py-3">
            <p className="text-sm text-zinc-400">{t("loginRequired")}</p>
            <Link href="/login">
              <Button size="sm" variant="outline">
                {t("goLogin")}
              </Button>
            </Link>
          </div>
        ) : loadFailed ? (
          <p className="text-sm text-red-400">{t("loadAgentsError")}</p>
        ) : agents === null ? (
          <p className="text-sm text-zinc-500">{t("loadingAgents")}</p>
        ) : agents.length < 2 ? (
          <p className="text-sm text-zinc-500">{t("notEnoughAgents")}</p>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-neon">{t("agentA")}</span>
                <select
                  className={selectClass}
                  value={agentAId}
                  onChange={(e) => setAgentAId(e.target.value)}
                  disabled={submitting}
                >
                  <option value="">{t("selectAgent")}</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-flare">{t("agentB")}</span>
                <select
                  className={selectClass}
                  value={agentBId}
                  onChange={(e) => setAgentBId(e.target.value)}
                  disabled={submitting}
                >
                  <option value="">{t("selectAgent")}</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-zinc-400">{t("bestOf")}</span>
                <select
                  className={cn(selectClass, "md:w-28")}
                  value={bestOf}
                  onChange={(e) => setBestOf(Number(e.target.value))}
                  disabled={submitting}
                >
                  {[1, 3, 5].map((n) => (
                    <option key={n} value={n}>
                      {t("bestOfLabel", { n })}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
            <div>
              <Button onClick={() => void submit()} disabled={submitting}>
                {submitting ? t("creating") : t("createSubmit")}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Match lists
// ---------------------------------------------------------------------------

function MatchSection({
  title,
  matches,
  emptyText,
  live = false,
}: {
  title: string;
  matches: LobbyMatch[];
  emptyText: string;
  live?: boolean;
}) {
  const t = useTranslations("duel");

  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-lg font-bold text-zinc-100">
        {title}
        {live && matches.length > 0 ? (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-volt opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-volt" />
          </span>
        ) : null}
      </h2>
      {matches.length === 0 ? (
        <EmptyState title={emptyText} />
      ) : (
        <div className="flex flex-col gap-2">
          {matches.map((m) => (
            <MatchRow key={m.id} match={m} />
          ))}
        </div>
      )}
    </section>
  );
}

function MatchRow({ match: m }: { match: LobbyMatch }) {
  const t = useTranslations("duel");

  const statusVariant =
    m.status === "RUNNING"
      ? "volt"
      : m.status === "DONE"
        ? "neon"
        : m.status === "QUEUED"
          ? "default"
          : "muted";

  const winnerName =
    m.winnerAgentId === m.agentA.id
      ? m.agentA.name
      : m.winnerAgentId === m.agentB.id
        ? m.agentB.name
        : null;

  return (
    <Link
      href={`/matches/${m.id}`}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-arena-border bg-arena-surface px-4 py-3 transition-colors hover:border-neon/50"
    >
      <Badge variant={statusVariant}>{t(`status.${m.status}`)}</Badge>
      <span className="text-sm font-medium text-zinc-100">
        <span className="text-neon">{m.agentA.name}</span>
        <span className="mx-2 text-zinc-600">vs</span>
        <span className="text-flare">{m.agentB.name}</span>
      </span>
      {m.status === "DONE" ? (
        <span className="font-mono text-sm text-zinc-300">
          {m.roundWinsA} : {m.roundWinsB}
          <span className="ml-2 text-xs text-zinc-500">
            {winnerName
              ? `${t("winnerLabel")}: ${winnerName}`
              : t("drawLabel")}
          </span>
        </span>
      ) : m.status === "RUNNING" ? (
        <span className="font-mono text-sm text-zinc-400">
          {m.roundWinsA} : {m.roundWinsB}
        </span>
      ) : null}
      <span className="text-xs text-zinc-600">
        {t("bestOfLabel", { n: m.bestOf })} · {m.arenaId ? t("arenaMatch") : t("friendly")}
      </span>
      <span className="ml-auto text-xs text-neon">{t("watch")} →</span>
    </Link>
  );
}
