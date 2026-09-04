/** Minimal structural subset of the next-intl translator used by UI helpers. */
interface Translator {
  (key: string): string;
  has(key: string): boolean;
}

/**
 * Map a server action / REST API error to a localized string. `code` is the
 * machine-readable code from HttpError (`{error:{code,message}}`); when the
 * messages file has no entry for it, fall back to the raw server message.
 */
export function errorText(
  t: Translator,
  code: string,
  fallback: string,
): string {
  return t.has(`errors.${code}`) ? t(`errors.${code}`) : fallback;
}
