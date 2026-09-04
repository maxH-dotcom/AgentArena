"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { ActionMessage, type ActionError } from "~/components/community/action-message";
import { Button } from "~/components/ui/button";
import { Link, useRouter } from "~/i18n/navigation";
import { followAction, unfollowAction } from "~/server/actions/community-actions";

/** Follow/unfollow toggle. Hidden on the viewer's own profile (self-follow is rejected server-side). */
export function FollowButton({
  targetType,
  targetId,
  loggedIn,
  initialFollowing,
}: {
  targetType: "user" | "agent";
  targetId: string;
  loggedIn: boolean;
  initialFollowing: boolean;
}) {
  const t = useTranslations("community");
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [error, setError] = useState<ActionError | null>(null);
  const [pending, startTransition] = useTransition();

  if (!loggedIn) {
    return (
      <Link href="/login">
        <Button variant="outline" size="sm">
          {t("common.follow")}
        </Button>
      </Link>
    );
  }

  function toggle() {
    setError(null);
    const input = { targetType, targetId };
    const next = !following;
    setFollowing(next);
    startTransition(async () => {
      const result = next ? await followAction(input) : await unfollowAction(input);
      if (!result.ok) {
        setFollowing(!next);
        setError({ code: result.code, message: result.message });
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant={following ? "outline" : "primary"}
        size="sm"
        disabled={pending}
        onClick={toggle}
      >
        {following ? t("common.following") : t("common.follow")}
      </Button>
      <ActionMessage error={error} />
    </div>
  );
}
