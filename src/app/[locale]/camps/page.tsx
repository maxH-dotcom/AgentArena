import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";

import { CampJoinLeave } from "~/components/community/camp-join-leave";
import { CreateCampForm } from "~/components/community/create-camp-form";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { EmptyState } from "~/components/ui/empty-state";
import { Link } from "~/i18n/navigation";
import { listCamps } from "~/server/services/camp";
import { getViewerContext } from "~/server/viewer";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "community" });
  return { title: t("camps.title") };
}

export default async function CampsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [t, camps, viewer] = await Promise.all([
    getTranslations("community"),
    listCamps(),
    getViewerContext(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-black tracking-tight text-zinc-100">
          {t("camps.title")}
        </h1>
        <p className="max-w-2xl text-sm text-zinc-400">{t("camps.subtitle")}</p>
      </header>

      {viewer.actor ? (
        <CreateCampForm />
      ) : (
        <p className="text-xs text-zinc-500">
          <Link href="/login" className="text-neon hover:underline">
            {t("common.signInToAct")}
          </Link>
        </p>
      )}

      {camps.length === 0 ? (
        <EmptyState title={t("camps.empty")} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {camps.map((camp) => {
            const isMine = viewer.campId === camp.id;
            return (
              <Card key={camp.id} className="overflow-hidden">
                <div
                  aria-hidden
                  className="h-1.5 w-full"
                  style={{ backgroundColor: camp.color }}
                />
                <CardContent className="flex flex-col gap-3 pt-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/camps/${camp.id}`}
                      className="text-base font-bold text-zinc-100 transition-colors hover:text-neon"
                    >
                      {camp.name}
                    </Link>
                    {isMine ? <Badge variant="neon">{t("camps.yourCamp")}</Badge> : null}
                  </div>
                  {camp.slogan ? (
                    <p className="text-xs italic text-zinc-500">“{camp.slogan}”</p>
                  ) : null}
                  <div className="flex items-center gap-4 text-xs text-zinc-400">
                    <span>
                      <span className="font-semibold text-zinc-200">{camp.memberCount}</span>{" "}
                      {t("common.members")}
                    </span>
                    <span>
                      <span className="font-semibold text-volt">{camp.winCount}</span>{" "}
                      {t("common.wins")}
                    </span>
                  </div>
                  {viewer.actor ? (
                    <CampJoinLeave
                      campId={camp.id}
                      loggedIn
                      isMember={isMine}
                      size="sm"
                    />
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
