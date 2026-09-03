import { type HTMLAttributes } from "react";

import { cn } from "~/lib/utils";

type BadgeVariant = "default" | "neon" | "volt" | "flare" | "muted";

const variants: Record<BadgeVariant, string> = {
  default: "border-arena-border bg-arena-raised text-zinc-300",
  neon: "border-neon/40 bg-neon/10 text-neon",
  volt: "border-volt/40 bg-volt/10 text-volt",
  flare: "border-flare/40 bg-flare/10 text-flare",
  muted: "border-arena-border bg-transparent text-zinc-500",
};

export function Badge({
  variant = "default",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
