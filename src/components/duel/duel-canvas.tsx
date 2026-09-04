"use client";

import { useEffect, useRef } from "react";

import {
  DUEL_ARENA_SIZE,
  DUEL_MAX_ENERGY,
  DUEL_MAX_HP,
  DUEL_ROUND_TICKS,
  DUEL_TICK_MS,
  type DuelAction,
} from "~/lib/constants";

import type { CanvasFrame, PublicFighter } from "./types";

/** Logical canvas resolution; the element scales to 100% width via CSS. */
const W = 960;
const H = 420;
const GROUND_Y = 340;
const ARENA_PAD = 70;

const COLOR_A = "#22d3ee"; // neon cyan
const COLOR_B = "#e879f9"; // flare magenta

const ACTION_COLORS: Record<DuelAction, string> = {
  idle: "#71717a",
  advance: "#a1a1aa",
  retreat: "#a1a1aa",
  guard: "#60a5fa",
  light: "#a3e635",
  heavy: "#fb923c",
  special: "#e879f9",
};

const ARM_REACH: Partial<Record<DuelAction, number>> = {
  light: 30,
  heavy: 42,
  special: 52,
};

function arenaX(x: number): number {
  return ARENA_PAD + (x / DUEL_ARENA_SIZE) * (W - ARENA_PAD * 2);
}

export interface DuelCanvasProps {
  /** Mutated in place by the parent (polled/replayed/interpolated frame). */
  frameRef: React.RefObject<CanvasFrame>;
  agentAName: string;
  agentBName: string;
  actionLabels: Record<DuelAction, string>;
  roundLabel: (round: number) => string;
  className?: string;
}

/**
 * Canvas renderer for the 1D duel arena. Runs its own requestAnimationFrame
 * loop (cleaned up on unmount) so hitstun flicker stays smooth regardless of
 * how often the parent updates `frameRef` (live polling is ~4 Hz).
 */
export function DuelCanvas({
  frameRef,
  agentAName,
  agentBName,
  actionLabels,
  roundLabel,
  className,
}: DuelCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;

    let raf = 0;
    const render = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(ctx, frameRef.current, t, { agentAName, agentBName, actionLabels, roundLabel });
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [frameRef, agentAName, agentBName, actionLabels, roundLabel]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height: "auto", aspectRatio: `${W} / ${H}` }}
    />
  );
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

interface DrawLabels {
  agentAName: string;
  agentBName: string;
  actionLabels: Record<DuelAction, string>;
  roundLabel: (round: number) => string;
}

function draw(
  ctx: CanvasRenderingContext2D,
  frame: CanvasFrame,
  t: number,
  labels: DrawLabels,
) {
  // Background
  ctx.fillStyle = "#0d1117";
  ctx.fillRect(0, 0, W, H);

  drawHud(ctx, frame, labels);

  // Arena floor
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ARENA_PAD - 20, GROUND_Y);
  ctx.lineTo(W - ARENA_PAD + 20, GROUND_Y);
  ctx.stroke();
  // Center mark
  ctx.strokeStyle = "#26313f";
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.moveTo(W / 2, GROUND_Y - 110);
  ctx.lineTo(W / 2, GROUND_Y);
  ctx.stroke();
  ctx.setLineDash([]);

  drawFighter(ctx, frame.a, frame.b, "A", t, labels.actionLabels);
  drawFighter(ctx, frame.b, frame.a, "B", t, labels.actionLabels);
}

function drawHud(ctx: CanvasRenderingContext2D, frame: CanvasFrame, labels: DrawLabels) {
  const barW = 380;
  const barH = 14;
  const y = 30;

  // Names
  ctx.font = "600 13px sans-serif";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = COLOR_A;
  ctx.fillText(labels.agentAName, 24, y - 6);
  ctx.textAlign = "right";
  ctx.fillStyle = COLOR_B;
  ctx.fillText(labels.agentBName, W - 24, y - 6);

  // HP bars (A fills from the left, B from the right)
  drawBar(ctx, 24, y, barW, barH, frame.a.hp / DUEL_MAX_HP, COLOR_A, false);
  drawBar(ctx, W - 24 - barW, y, barW, barH, frame.b.hp / DUEL_MAX_HP, COLOR_B, true);

  // Energy bars
  drawBar(ctx, 24, y + barH + 5, barW, 6, frame.a.energy / DUEL_MAX_ENERGY, "#a3e635", false);
  drawBar(ctx, W - 24 - barW, y + barH + 5, barW, 6, frame.b.energy / DUEL_MAX_ENERGY, "#a3e635", true);

  // Center: round, countdown, score
  ctx.textAlign = "center";
  ctx.fillStyle = "#e5e7eb";
  ctx.font = "700 22px sans-serif";
  ctx.fillText(`${frame.roundWinsA} : ${frame.roundWinsB}`, W / 2, y + 12);
  ctx.font = "500 12px sans-serif";
  ctx.fillStyle = "#9ca3af";
  const secondsLeft = Math.max(
    0,
    Math.ceil((DUEL_ROUND_TICKS - frame.tickInRound) / (1000 / DUEL_TICK_MS)),
  );
  ctx.fillText(
    frame.matchOver
      ? labels.roundLabel(frame.round)
      : `${labels.roundLabel(frame.round)} · ${secondsLeft}s`,
    W / 2,
    y + 32,
  );
}

function drawBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  ratio: number,
  color: string,
  rtl: boolean,
) {
  ctx.fillStyle = "#131a24";
  ctx.fillRect(x, y, w, h);
  const fill = Math.max(0, Math.min(1, ratio)) * w;
  ctx.fillStyle = color;
  ctx.fillRect(rtl ? x + w - fill : x, y, fill, h);
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function drawFighter(
  ctx: CanvasRenderingContext2D,
  f: PublicFighter,
  opponent: PublicFighter,
  side: "A" | "B",
  t: number,
  actionLabels: Record<DuelAction, string>,
) {
  const color = side === "A" ? COLOR_A : COLOR_B;
  const facing = side === "A" ? 1 : -1;
  const cx = arenaX(f.x);
  const knockedOut = f.hp <= 0;

  ctx.save();
  // Hitstun flicker
  if (f.hitstun > 0 && !knockedOut) {
    ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(t / 45));
  }

  if (knockedOut) {
    // KO: fighter lies flat on the ground
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = color;
    ctx.fillRect(cx - 26, GROUND_Y - 14, 52, 12); // body
    ctx.beginPath();
    ctx.arc(cx + facing * -34, GROUND_Y - 9, 10, 0, Math.PI * 2); // head
    ctx.fill();
    ctx.restore();
    drawActionLabel(ctx, f, cx, actionLabels);
    return;
  }

  const bodyW = 26;
  const bodyH = 52;
  const bodyTop = GROUND_Y - bodyH;
  const headY = bodyTop - 12;

  // Guard arc in front of the fighter
  if (f.action === "guard") {
    ctx.strokeStyle = "#60a5fa";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(
      cx + facing * 16,
      bodyTop + bodyH / 2,
      30,
      facing === 1 ? -Math.PI / 2.4 : Math.PI / 2 - Math.PI / 1.2 + Math.PI,
      facing === 1 ? Math.PI / 2.4 : Math.PI / 2 + Math.PI / 1.2 + Math.PI,
    );
    ctx.stroke();
  }

  // Body + head
  ctx.fillStyle = color;
  ctx.fillRect(cx - bodyW / 2, bodyTop, bodyW, bodyH);
  ctx.beginPath();
  ctx.arc(cx, headY, 11, 0, Math.PI * 2);
  ctx.fill();

  // Attack arm
  const reach = ARM_REACH[f.action];
  if (reach) {
    const shoulderY = bodyTop + 12;
    const isSpecial = f.action === "special";
    ctx.strokeStyle = isSpecial ? "#e879f9" : "#e5e7eb";
    ctx.lineWidth = isSpecial ? 6 : 4;
    if (isSpecial) {
      ctx.shadowColor = "#e879f9";
      ctx.shadowBlur = 14;
    }
    ctx.beginPath();
    ctx.moveTo(cx, shoulderY);
    ctx.lineTo(cx + facing * reach, shoulderY - 4);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  ctx.restore();
  drawActionLabel(ctx, f, cx, actionLabels);

  // Distance marker to the opponent (debug-ish, subtle)
  void opponent;
}

function drawActionLabel(
  ctx: CanvasRenderingContext2D,
  f: PublicFighter,
  cx: number,
  actionLabels: Record<DuelAction, string>,
) {
  ctx.font = "600 11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = ACTION_COLORS[f.action];
  ctx.fillText(actionLabels[f.action].toUpperCase(), cx, GROUND_Y - 96);
}
