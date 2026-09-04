"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useTranslations } from "next-intl";

import { DuelCanvas } from "~/components/duel/duel-canvas";
import { buildReplayFrames } from "~/components/duel/replay";
import {
  frameFromMatchState,
  frameFromPublicState,
  type CanvasFrame,
  type MatchTicksResponse,
  type PublicMatchState,
} from "~/components/duel/types";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Link } from "~/i18n/navigation";
import { DUEL_TICK_MS, type DuelAction, type DuelMatchStatus } from "~/lib/constants";
import { createMatchState } from "~/server/duel/engine";

const POLL_MS = 250;
const SPEEDS = [0.5, 1, 2, 4] as const;

interface AgentInfo {
  id: string;
  name: string;
}

interface LiveSample {
  at: number;
  frame: CanvasFrame;
}

export function DuelSpectator({
  matchId,
  seed,
  bestOf,
  initialStatus,
  agentA,
  agentB,
}: {
  matchId: string;
  seed: number;
  bestOf: number;
  initialStatus: DuelMatchStatus;
  agentA: AgentInfo;
  agentB: AgentInfo;
}) {
  const t = useTranslations("duel");

  const [mode, setMode] = useState<"live" | "replay">("live");
  const [status, setStatus] = useState<DuelMatchStatus>(initialStatus);
  const [winnerAgentId, setWinnerAgentId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [connError, setConnError] = useState(false);

  // Frame the canvas draws (mutated in place; the canvas has its own rAF loop).
  const frameRef = useRef<CanvasFrame>(frameFromMatchState(createMatchState(seed, bestOf)));
  // Last two polled states, for interpolation between polls.
  const samplesRef = useRef<LiveSample[]>([]);

  const actionLabels = useMemo(
    () =>
      ({
        idle: t("actions.idle"),
        advance: t("actions.advance"),
        retreat: t("actions.retreat"),
        guard: t("actions.guard"),
        light: t("actions.light"),
        heavy: t("actions.heavy"),
        special: t("actions.special"),
      }) as Record<DuelAction, string>,
    [t],
  );
  const roundLabel = useCallback((round: number) => t("round", { n: round }), [t]);

  // --- Live polling (250 ms) ------------------------------------------------
  useEffect(() => {
    if (mode !== "live") return;
    let stopped = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const res = await fetch(`/api/v1/matches/${matchId}/state`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const s = (await res.json()) as PublicMatchState;
        if (stopped) return;
        const frame = frameFromPublicState(s);
        const samples = samplesRef.current;
        // Drop the previous sample only once we have two; keep the window small.
        if (samples.length >= 2) samples.shift();
        samples.push({ at: performance.now(), frame });
        setStatus(s.status);
        setWinnerAgentId(s.winnerAgentId);
        setConnected(true);
        setConnError(false);
        if ((s.status === "DONE" || s.status === "CANCELLED") && interval) {
          clearInterval(interval);
          interval = null;
        }
      } catch {
        if (!stopped) setConnError(true);
      }
    };

    void poll();
    interval = setInterval(() => void poll(), POLL_MS);
    return () => {
      stopped = true;
      if (interval) clearInterval(interval);
    };
  }, [mode, matchId]);

  // --- Interpolation loop: polls arrive at ~4 Hz, render smoothly -----------
  useEffect(() => {
    if (mode !== "live") return;
    let raf = 0;
    const tick = () => {
      const samples = samplesRef.current;
      const curr = samples[samples.length - 1];
      if (curr) {
        const prev = samples.length >= 2 ? samples[samples.length - 2]! : curr;
        const span = Math.max(1, curr.at - prev.at);
        const alpha = Math.min(1, (performance.now() - prev.at) / span);
        frameRef.current = interpolateFrames(prev.frame, curr.frame, alpha);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  // --- Replay ---------------------------------------------------------------
  const [replayState, setReplayState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [replayIndex, setReplayIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const replayRef = useRef<{
    frames: CanvasFrame[];
    index: number;
    playing: boolean;
    speed: number;
    acc: number;
    last: number;
  }>({ frames: [], index: 0, playing: false, speed: 1, acc: 0, last: 0 });
  replayRef.current.playing = playing;
  replayRef.current.speed = speed;

  const enterReplay = useCallback(async () => {
    setMode("replay");
    if (replayRef.current.frames.length > 0) {
      setReplayState("ready");
      return;
    }
    setReplayState("loading");
    try {
      const res = await fetch(`/api/v1/matches/${matchId}/ticks`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as MatchTicksResponse;
      const frames = buildReplayFrames(data.seed ?? seed, data.bestOf ?? bestOf, data.ticks);
      replayRef.current.frames = frames;
      replayRef.current.index = 0;
      replayRef.current.acc = 0;
      frameRef.current = frames[0]!;
      setReplayIndex(0);
      setPlaying(true);
      setReplayState("ready");
    } catch {
      setReplayState("error");
    }
  }, [matchId, seed, bestOf]);

  // Playback loop: advance one engine tick every DUEL_TICK_MS / speed.
  useEffect(() => {
    if (mode !== "replay" || replayState !== "ready") return;
    const r = replayRef.current;
    r.last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      const dt = now - r.last;
      r.last = now;
      if (r.playing && r.frames.length > 0) {
        r.acc += dt * r.speed;
        let advanced = false;
        while (r.acc >= DUEL_TICK_MS && r.index < r.frames.length - 1) {
          r.acc -= DUEL_TICK_MS;
          r.index += 1;
          advanced = true;
        }
        if (r.index >= r.frames.length - 1) {
          r.playing = false;
          setPlaying(false);
        }
        if (advanced) {
          frameRef.current = r.frames[r.index]!;
          setReplayIndex(r.index);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mode, replayState]);

  const scrubTo = useCallback((index: number) => {
    const r = replayRef.current;
    r.index = index;
    r.acc = 0;
    if (r.frames[index]) frameRef.current = r.frames[index];
    setReplayIndex(index);
  }, []);

  const exitReplay = useCallback(() => {
    setPlaying(false);
    replayRef.current.playing = false;
    samplesRef.current = [];
    setMode("live");
  }, []);

  // --- Render ---------------------------------------------------------------
  const winnerName =
    winnerAgentId === agentA.id
      ? agentA.name
      : winnerAgentId === agentB.id
        ? agentB.name
        : null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <Link href="/duel" className="text-xs text-zinc-500 hover:text-neon">
          ← {t("lobbyTitle")}
        </Link>
        <h1 className="text-xl font-black tracking-tight">
          <span className="text-neon">{agentA.name}</span>
          <span className="mx-2 text-zinc-600">vs</span>
          <span className="text-flare">{agentB.name}</span>
        </h1>
        {mode === "live" && status === "RUNNING" ? (
          <Badge variant="volt">
            <span className="relative mr-1 flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-volt opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-volt" />
            </span>
            {t("live")}
          </Badge>
        ) : (
          <Badge variant={status === "DONE" ? "neon" : "muted"}>
            {t(`status.${status}`)}
          </Badge>
        )}
        <span className="text-xs text-zinc-600">{t("bestOfLabel", { n: bestOf })}</span>
      </header>

      <div className="relative overflow-hidden rounded-xl border border-arena-border">
        <DuelCanvas
          frameRef={frameRef}
          agentAName={agentA.name}
          agentBName={agentB.name}
          actionLabels={actionLabels}
          roundLabel={roundLabel}
        />

        {mode === "live" && !connected && !connError ? (
          <Overlay>
            <p className="text-sm text-zinc-400">{t("connecting")}</p>
          </Overlay>
        ) : null}
        {mode === "live" && connError ? (
          <Overlay>
            <p className="text-sm text-red-400">{t("stateError")}</p>
          </Overlay>
        ) : null}

        {mode === "live" && status === "DONE" ? (
          <Overlay>
            <p className="text-2xl font-black text-zinc-100">
              {winnerName ? t("winnerBanner", { name: winnerName }) : t("drawBanner")}
            </p>
            <Button onClick={() => void enterReplay()}>{t("enterReplay")}</Button>
          </Overlay>
        ) : null}
        {mode === "live" && status === "CANCELLED" ? (
          <Overlay>
            <p className="text-lg font-bold text-zinc-300">{t("matchCancelled")}</p>
            <Button variant="outline" onClick={() => void enterReplay()}>
              {t("enterReplay")}
            </Button>
          </Overlay>
        ) : null}

        {mode === "replay" && replayState === "loading" ? (
          <Overlay>
            <p className="text-sm text-zinc-400">{t("replayLoading")}</p>
          </Overlay>
        ) : null}
        {mode === "replay" && replayState === "error" ? (
          <Overlay>
            <p className="text-sm text-red-400">{t("replayError")}</p>
            <Button variant="outline" onClick={exitReplay}>
              {t("exitReplay")}
            </Button>
          </Overlay>
        ) : null}
      </div>

      {mode === "replay" && replayState === "ready" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-arena-border bg-arena-surface px-4 py-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPlaying((p) => !p)}
            disabled={replayRef.current.frames.length <= 1}
          >
            {playing ? t("pause") : t("play")}
          </Button>
          <div className="flex gap-1">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                className={`h-8 rounded-md px-2 text-xs font-medium transition-colors ${
                  speed === s
                    ? "bg-neon/15 text-neon"
                    : "text-zinc-500 hover:bg-arena-raised hover:text-zinc-200"
                }`}
              >
                {s}×
              </button>
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, replayRef.current.frames.length - 1)}
            value={replayIndex}
            onChange={(e) => scrubTo(Number(e.target.value))}
            className="min-w-40 flex-1 accent-neon"
          />
          <span className="font-mono text-xs text-zinc-500">
            {t("tickLabel", {
              round: replayRef.current.frames[replayIndex]?.round ?? 1,
              tick: replayRef.current.frames[replayIndex]?.tickInRound ?? 0,
            })}
          </span>
          <Button size="sm" variant="ghost" onClick={exitReplay}>
            {t("exitReplay")}
          </Button>
        </div>
      ) : null}

    </div>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-arena-bg/70 backdrop-blur-[2px]">
      {children}
    </div>
  );
}

function interpolateFrames(prev: CanvasFrame, curr: CanvasFrame, alpha: number): CanvasFrame {
  // Different rounds (or a reset between polls): snap, don't interpolate.
  if (prev.round !== curr.round) return curr;
  const lerp = (a: number, b: number) => a + (b - a) * alpha;
  return {
    ...curr,
    a: { ...curr.a, x: lerp(prev.a.x, curr.a.x), hp: lerp(prev.a.hp, curr.a.hp), energy: lerp(prev.a.energy, curr.a.energy) },
    b: { ...curr.b, x: lerp(prev.b.x, curr.b.x), hp: lerp(prev.b.hp, curr.b.hp), energy: lerp(prev.b.energy, curr.b.energy) },
  };
}
