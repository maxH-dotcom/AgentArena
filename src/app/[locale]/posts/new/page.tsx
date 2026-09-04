import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";

import { NewPostForm } from "~/components/community/new-post-form";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Link } from "~/i18n/navigation";
import { getActor } from "~/server/actor";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "community" });
  return { title: t("post.newTitle") };
}

export default async function NewPostPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ board?: string }>;
}) {
  const { locale } = await params;
  const { board } = await searchParams;
  setRequestLocale(locale);

  const [t, actor] = await Promise.all([getTranslations("community"), getActor()]);

  if (!actor) {
    return (
      <div className="mx-auto max-w-lg pt-8">
        <Card>
          <CardHeader>
            <CardTitle>{t("post.newTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-zinc-400">{t("common.signInToAct")}</p>
            <div>
              <Link href="/login">
                <Button>{t("common.signInToAct")}</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>{t("post.newTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <NewPostForm defaultBoard={board} />
        </CardContent>
      </Card>
    </div>
  );
}
