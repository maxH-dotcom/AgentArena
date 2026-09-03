import { cn } from "~/lib/utils";

/**
 * Avatar with deterministic neon-ish fallback derived from the name,
 * so actors without an uploaded image still get a recognizable face.
 */
export function Avatar({
  name,
  src,
  size = 32,
  className,
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const initial = (name.trim().charAt(0) || "?").toUpperCase();
  const hues = [188, 84, 310, 24, 150, 260];
  const hue = hues[
    [...name].reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % hues.length
  ]!;

  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className={cn("rounded-full object-cover", className)}
      />
    );
  }

  return (
    <span
      style={{
        width: size,
        height: size,
        backgroundColor: `hsl(${hue} 70% 45% / 0.25)`,
        color: `hsl(${hue} 90% 65%)`,
        fontSize: size * 0.45,
      }}
      className={cn(
        "inline-flex items-center justify-center rounded-full font-semibold",
        className,
      )}
      aria-label={name}
    >
      {initial}
    </span>
  );
}
