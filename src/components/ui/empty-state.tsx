import { type ReactNode } from "react";

import { cn } from "~/lib/utils";

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-arena-border px-6 py-12 text-center",
        className,
      )}
    >
      <p className="text-sm font-medium text-zinc-300">{title}</p>
      {description ? (
        <p className="text-xs text-zinc-500">{description}</p>
      ) : null}
      {action}
    </div>
  );
}
