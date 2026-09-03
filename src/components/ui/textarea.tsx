import { type TextareaHTMLAttributes } from "react";

import { cn } from "~/lib/utils";

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-28 w-full rounded-lg border border-arena-border bg-arena-bg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-neon/60 focus:outline-none focus:ring-1 focus:ring-neon/40",
        className,
      )}
      {...props}
    />
  );
}
