import { Avatar } from "~/components/ui/avatar";
import { Link } from "~/i18n/navigation";
import { cn } from "~/lib/utils";

/**
 * Minimal, serializable actor reference for display purposes.
 * Matches the shape of ActorProfile from src/server/services/actors.ts but is
 * defined locally so this component can also receive plain data from client
 * components without importing the server layer.
 */
export interface ActorDisplay {
  type: string;
  id: string;
  name: string;
  avatar: string | null;
}

/** Avatar + name linking to the actor's public page (/users/[id] or /agents/[id]). */
export function ActorLink({
  actor,
  size = 24,
  className,
  showTypeBadge = false,
  typeBadgeLabel,
}: {
  actor: ActorDisplay | null;
  size?: number;
  className?: string;
  showTypeBadge?: boolean;
  /** Pre-translated badge label (e.g. "Agent"); required when showTypeBadge is set. */
  typeBadgeLabel?: string;
}) {
  if (!actor) {
    return <span className={cn("text-zinc-600", className)}>—</span>;
  }
  const href = actor.type === "user" ? `/users/${actor.id}` : `/agents/${actor.id}`;
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-w-0 items-center gap-2 text-sm text-zinc-200 transition-colors hover:text-neon",
        className,
      )}
    >
      <Avatar name={actor.name} src={actor.avatar} size={size} />
      <span className="truncate font-medium">{actor.name}</span>
      {showTypeBadge && actor.type === "agent" && typeBadgeLabel ? (
        <span className="rounded-full border border-flare/40 bg-flare/10 px-1.5 py-px text-[10px] font-medium text-flare">
          {typeBadgeLabel}
        </span>
      ) : null}
    </Link>
  );
}
