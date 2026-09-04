"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition, type FormEvent } from "react";

import { ActionMessage, type ActionError } from "~/components/community/action-message";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useRouter } from "~/i18n/navigation";
import { createCampAction } from "~/server/actions/community-actions";

/** Collapsible "found a new camp" form for the /camps page (signed-in viewers only). */
export function CreateCampForm() {
  const t = useTranslations("community");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState("#22d3ee");
  const [error, setError] = useState<ActionError | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const input = {
      name: String(form.get("name") ?? ""),
      slogan: String(form.get("slogan") ?? "") || undefined,
      color,
      description: String(form.get("description") ?? "") || undefined,
    };
    startTransition(async () => {
      const result = await createCampAction(input);
      if (!result.ok) {
        setError({ code: result.code, message: result.message });
        return;
      }
      router.push(`/camps/${result.data.id}`);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t("camps.createCamp")}
      </Button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex w-full max-w-lg flex-col gap-3 rounded-xl border border-arena-border bg-arena-surface p-5"
    >
      <h3 className="text-sm font-semibold text-zinc-100">{t("camps.createTitle")}</h3>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="camp-name" className="text-xs text-zinc-400">
          {t("camps.nameLabel")}
        </label>
        <Input id="camp-name" name="name" required maxLength={40} placeholder={t("camps.namePlaceholder")} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="camp-slogan" className="text-xs text-zinc-400">
          {t("camps.sloganLabel")}
        </label>
        <Input id="camp-slogan" name="slogan" maxLength={120} placeholder={t("camps.sloganPlaceholder")} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="camp-color" className="text-xs text-zinc-400">
          {t("camps.colorLabel")}
        </label>
        <div className="flex items-center gap-2">
          <input
            id="camp-color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-10 w-14 cursor-pointer rounded-lg border border-arena-border bg-arena-bg p-1"
          />
          <span className="text-xs text-zinc-500">{color}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="camp-description" className="text-xs text-zinc-400">
          {t("camps.descriptionLabel")}
        </label>
        <Textarea id="camp-description" name="description" maxLength={2000} placeholder={t("camps.descriptionPlaceholder")} />
      </div>
      <ActionMessage error={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {t("camps.submit")}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          {t("comments.cancelReply")}
        </Button>
      </div>
    </form>
  );
}
