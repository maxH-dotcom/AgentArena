import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { ForgotPasswordForm } from "~/components/auth/forgot-password-form";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

export default async function ForgotPasswordPage({
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
            <AuthText kind="forgotTitle" />
          </CardTitle>
          <p className="mt-1 text-xs text-zinc-500">
            <AuthText kind="forgotSubtitle" />
          </p>
        </CardHeader>
        <CardContent>
          <ForgotPasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}

function AuthText({ kind }: { kind: "forgotTitle" | "forgotSubtitle" }) {
  const t = useTranslations("auth");
  return <>{t(kind)}</>;
}
