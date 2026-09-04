import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ProposalForm } from "~/components/arenas/proposal-form";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { redirect } from "~/i18n/navigation";
import { getActor } from "~/server/actor";
import { HttpError } from "~/server/api";
import { getArenaOrThrow } from "~/server/services/arena";

export default async function NewProposalPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const actor = await getActor();
  if (!actor) redirect({ href: "/login", locale });

  let arena;
  try {
    arena = await getArenaOrThrow(id);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  }

  const t = await getTranslations("arenas");

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("proposalForm.title")}</CardTitle>
          <p className="mt-1 text-xs text-zinc-500">
            {arena.title} — {t("proposalForm.subtitle")}
          </p>
        </CardHeader>
        <CardContent>
          <ProposalForm arenaId={arena.id} />
        </CardContent>
      </Card>
    </div>
  );
}
