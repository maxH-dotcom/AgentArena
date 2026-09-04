import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import { routing } from "./routing";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    target[key] =
      isPlainObject(existing) && isPlainObject(value)
        ? deepMerge(existing, value)
        : value;
  }
  return target;
}

/**
 * Base messages live in messages/<locale>.json; feature modules contribute
 * additional namespaces via messages/partials/*.<locale>.json (deep-merged
 * over the base, sorted by filename for deterministic precedence).
 */
async function loadMessages(locale: string): Promise<Record<string, unknown>> {
  const base = (await import(`../../messages/${locale}.json`))
    .default as Record<string, unknown>;

  const messages: Record<string, unknown> = { ...base };
  const partialsDir = path.join(process.cwd(), "messages", "partials");
  let files: string[] = [];
  try {
    files = await readdir(partialsDir);
  } catch {
    files = [];
  }
  for (const file of files.filter((f) => f.endsWith(`.${locale}.json`)).sort()) {
    try {
      const partial = JSON.parse(
        await readFile(path.join(partialsDir, file), "utf8"),
      ) as unknown;
      if (isPlainObject(partial)) deepMerge(messages, partial);
    } catch (error) {
      console.error(`Failed to load messages partial ${file}`, error);
    }
  }
  return messages;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: await loadMessages(locale),
  };
});
