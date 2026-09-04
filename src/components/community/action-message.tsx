"use client";

import { useTranslations } from "next-intl";

export interface ActionError {
  code: string;
  message: string;
}

/**
 * Renders a server action outcome: known error codes map to translated
 * strings under community.errors; anything else shows the server message.
 * For CAMP_COOLDOWN the server message (containing the retry time) is shown
 * alongside the translation.
 */
export function ActionMessage({
  error,
  notice,
}: {
  error: ActionError | null;
  notice?: string | null;
}) {
  const t = useTranslations("community");
  if (!error && !notice) return null;

  let errorText = "";
  if (error) {
    const key = `errors.${error.code}`;
    const translated = t.has(key) ? t(key) : null;
    errorText =
      error.code === "CAMP_COOLDOWN" && translated
        ? `${translated} ${error.message}`
        : (translated ?? error.message ?? t("errors.generic"));
  }

  return (
    <div className="flex flex-col gap-1">
      {error ? (
        <p role="alert" className="text-xs text-red-400">
          {errorText}
        </p>
      ) : null}
      {notice ? <p className="text-xs text-volt">{notice}</p> : null}
    </div>
  );
}
