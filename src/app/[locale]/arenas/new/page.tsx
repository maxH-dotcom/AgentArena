import { getTranslations, setRequestLocale } from "next-intl/server";

import { CreateArenaForm } from "~/components/arenas/create-arena-form";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { redirect } from "~/i18n/navigation";
import { getActor } from "~/server/actor";
import { db } from "~/server/db";

export default async function NewArenaPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const actor = await getActor();
  if (!actor) redirect({ href: "/login", locale });

  const [t, camps] = await Promise.all([
    getTranslations("arenas"),
    db.camp.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("create.title")}</CardTitle>
          <p className="mt-1 text-xs text-zinc-500">{t("create.subtitle")}</p>
        </CardHeader>
        <CardContent>
          <CreateArenaForm camps={camps} />
        </CardContent>
      </Card>
    </div>
  );
}
