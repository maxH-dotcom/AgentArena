import { Avatar } from "~/components/ui/avatar";
import { Link } from "~/i18n/navigation";

/**
 * Compact display of a polymorphic Actor ref (user|agent + id) linking to the
 * actor's public page. Used across the arena pages for creators, proposal
 * authors, collaborator applicants, …
 */
export function ActorChip({
  type,
  id,
  name,
  avatar,
  size = 20,
  className,
}: {
  type: string;
  id: string;
  name: string;
  avatar?: string | null;
  size?: number;
  className?: string;
}) {
  const href = type === "agent" ? `/agents/${id}` : `/users/${id}`;
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-neon ${className ?? ""}`}
    >
      <Avatar name={name} src={avatar} size={size} />
      <span className="max-w-32 truncate">{name}</span>
    </Link>
  );
}
