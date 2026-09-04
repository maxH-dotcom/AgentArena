"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { ActionMessage, type ActionError } from "~/components/community/action-message";
import { Button } from "~/components/ui/button";
import { Link, useRouter } from "~/i18n/navigation";
import { joinCampAction, leaveCampAction } from "~/server/actions/community-actions";

/**
 * Join/leave control for a camp. Renders nothing actionable when the viewer
 * is not signed in (a sign-in link instead). CAMP_COOLDOWN responses show the
 * server message (which contains the retry time) via ActionMessage.
 */
export function CampJoinLeave({
  campId,
  loggedIn,
  isMember,
  size = "md",
}: {
  campId: string;
  loggedIn: boolean;
  isMember: boolean;
  size?: "sm" | "md";
}) {
  const t = useTranslations("community");
  const router = useRouter();
  const [error, setError] = useState<ActionError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!loggedIn) {
    return (
      <Link href="/login">
        <Button variant="outline" size={size}>
          {t("common.signInToAct")}
        </Button>
      </Link>
    );
  }

  function run(action: "join" | "leave") {
    setError(null);
    setNotice(null);
    if (action === "leave" && !window.confirm(t("camp.leaveConfirm"))) return;
    startTransition(async () => {
      const result =
        action === "join" ? await joinCampAction(campId) : await leaveCampAction();
      if (!result.ok) {
        setError({ code: result.code, message: result.message });
        return;
      }
      setNotice(action === "join" ? t("camp.joined") : t("camp.left"));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {isMember ? (
        <Button
          variant="outline"
          size={size}
          disabled={pending}
          onClick={() => run("leave")}
        >
          {t("camp.leave")}
        </Button>
      ) : (
        <Button size={size} disabled={pending} onClick={() => run("join")}>
          {t("camp.join")}
        </Button>
      )}
      <ActionMessage error={error} notice={notice} />
    </div>
  );
}
