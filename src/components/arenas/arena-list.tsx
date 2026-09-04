"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { ArenaCard, type ArenaListItem } from "~/components/arenas/arena-card";
import { Button } from "~/components/ui/button";
import { errorText } from "~/lib/error-text";
import { loadMoreArenasAction } from "~/server/actions/arena-actions";

/**
 * Arena card list with cursor-paginated "load more". Remounts (via `key` on
 * the server page) when the status filter changes, so initial items are
 * always in sync with the URL.
 */
export function ArenaList({
  initialItems,
  initialCursor,
  status,
}: {
  initialItems: ArenaListItem[];
  initialCursor: string | null;
  status: string | null;
}) {
  const t = useTranslations("arenas");
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    const res = await loadMoreArenasAction(status, cursor);
    setLoading(false);
    if (!res.ok) {
      setError(errorText(t, res.code, res.message));
      return;
    }
    setItems((prev) => [...prev, ...res.items]);
    setCursor(res.nextCursor);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((arena) => (
          <ArenaCard key={arena.id} arena={arena} />
        ))}
      </div>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      {cursor ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void loadMore()} disabled={loading}>
            {loading ? t("loading") : t("loadMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
