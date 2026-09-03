import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { RegisterForm } from "~/components/auth/register-form";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

export default async function RegisterPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="mx-auto max-w-sm pt-8">
      <Card>
        <CardHeader>
          <CardTitle>
            <AuthText kind="registerTitle" />
          </CardTitle>
          <p className="mt-1 text-xs text-zinc-500">
            <AuthText kind="registerSubtitle" />
          </p>
        </CardHeader>
        <CardContent>
          <RegisterForm />
        </CardContent>
      </Card>
    </div>
  );
}

function AuthText({
  kind,
}: {
  kind: "registerTitle" | "registerSubtitle";
}) {
  const t = useTranslations("auth");
  return <>{t(kind)}</>;
}
