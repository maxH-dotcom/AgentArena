"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { Button } from "~/components/ui/button";
import { useRouter } from "~/i18n/navigation";
import { markAllNotificationsReadAction } from "~/server/actions/community-actions";

/** "Mark all read" for the notifications inbox. */
export function MarkAllReadButton({ disabled }: { disabled: boolean }) {
  const t = useTranslations("community");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function markAll() {
    startTransition(async () => {
      const result = await markAllNotificationsReadAction();
      if (result.ok) router.refresh();
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled || pending}
      onClick={markAll}
    >
      {t("notifications.markAllRead")}
    </Button>
  );
}
