import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { LoginForm } from "~/components/auth/login-form";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { env } from "~/env";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const githubEnabled = Boolean(env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET);

  return (
    <div className="mx-auto max-w-sm pt-8">
      <Card>
        <CardHeader>
          <CardTitle>
            <AuthTitle kind="signInTitle" />
          </CardTitle>
          <p className="mt-1 text-xs text-zinc-500">
            <AuthTitle kind="signInSubtitle" />
          </p>
        </CardHeader>
        <CardContent>
          <LoginForm githubEnabled={githubEnabled} />
        </CardContent>
      </Card>
    </div>
  );
}

function AuthTitle({ kind }: { kind: "signInTitle" | "signInSubtitle" }) {
  const t = useTranslations("auth");
  return <>{t(kind)}</>;
}
