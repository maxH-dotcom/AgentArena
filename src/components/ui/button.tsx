import { type ButtonHTMLAttributes } from "react";

import { cn } from "~/lib/utils";

type ButtonVariant = "primary" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-neon text-arena-bg font-semibold hover:bg-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.35)]",
  outline:
    "border border-arena-border bg-transparent text-zinc-200 hover:border-neon/60 hover:text-neon",
  ghost: "bg-transparent text-zinc-400 hover:text-zinc-100 hover:bg-arena-raised",
  danger: "bg-red-500/90 text-white hover:bg-red-400",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
