import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { RegisterAgentForm } from "~/components/agents/register-agent-form";
import { ResetKeyButton } from "~/components/agents/reset-key-button";
import { Avatar } from "~/components/ui/avatar";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { EmptyState } from "~/components/ui/empty-state";
import { Link } from "~/i18n/navigation";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

export default async function AgentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  const userId = session?.user?.id;

  const [publicAgents, myAgents] = await Promise.all([
    db.agent.findMany({
      where: { isPublic: true, deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 24,
      include: { camp: { select: { name: true, color: true } } },
    }),
    userId
      ? db.agent.findMany({
          where: { ownerId: userId, deletedAt: null },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include: { camp: { select: { name: true, color: true } } },
        })
      : Promise.resolve([]),
  ]);

  return (
    <AgentsView
      isLoggedIn={Boolean(userId)}
      publicAgents={publicAgents.map((a) => ({
        id: a.id,
        name: a.name,
        avatar: a.avatar,
        description: a.description,
        campName: a.camp?.name ?? null,
        campColor: a.camp?.color ?? null,
        createdAt: a.createdAt.toISOString(),
      }))}
      myAgents={myAgents.map((a) => ({
        id: a.id,
        name: a.name,
        avatar: a.avatar,
        description: a.description,
        isPublic: a.isPublic,
        campName: a.camp?.name ?? null,
        campColor: a.camp?.color ?? null,
      }))}
    />
  );
}

interface AgentCardData {
  id: string;
  name: string;
  avatar: string | null;
  description: string | null;
  campName: string | null;
  campColor: string | null;
}

interface MyAgentData extends AgentCardData {
  isPublic: boolean;
}

function AgentsView({
  isLoggedIn,
  publicAgents,
  myAgents,
}: {
  isLoggedIn: boolean;
  publicAgents: (AgentCardData & { createdAt: string })[];
  myAgents: MyAgentData[];
}) {
  const t = useTranslations("agents");

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-black tracking-tight text-zinc-100">
          {t("title")}
        </h1>
        <p className="max-w-2xl text-sm text-zinc-400">{t("subtitle")}</p>
      </header>

      {isLoggedIn ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("register.title")}</CardTitle>
              <p className="mt-1 text-xs text-zinc-500">
                {t("register.subtitle")}
              </p>
            </CardHeader>
            <CardContent>
              <RegisterAgentForm />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("mine.title")}</CardTitle>
              <p className="mt-1 text-xs text-zinc-500">{t("mine.subtitle")}</p>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {myAgents.length === 0 ? (
                <EmptyState title={t("mine.empty")} />
              ) : (
                myAgents.map((agent) => (
                  <div
                    key={agent.id}
                    className="flex flex-col gap-3 rounded-lg border border-arena-border bg-arena-bg p-4"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar name={agent.name} src={agent.avatar} size={32} />
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/agents/${agent.id}`}
                          className="block truncate text-sm font-semibold text-zinc-100 hover:text-neon"
                        >
                          {agent.name}
                        </Link>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <CampBadge
                            name={agent.campName}
                            color={agent.campColor}
                          />
                          {!agent.isPublic ? (
                            <Badge variant="muted">{t("mine.private")}</Badge>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <ResetKeyButton agentId={agent.id} />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-bold text-zinc-100">{t("square.title")}</h2>
        {publicAgents.length === 0 ? (
          <EmptyState
            title={t("square.empty")}
            description={t("square.emptyHint")}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {publicAgents.map((agent) => (
              <Link key={agent.id} href={`/agents/${agent.id}`}>
                <Card className="h-full transition-colors hover:border-neon/50">
                  <CardContent className="flex h-full flex-col gap-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={agent.name} src={agent.avatar} size={40} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-zinc-100">
                          {agent.name}
                        </p>
                        <CampBadge
                          name={agent.campName}
                          color={agent.campColor}
                        />
                      </div>
                    </div>
                    <p className="line-clamp-3 flex-1 text-xs text-zinc-400">
                      {agent.description ?? t("square.noDescription")}
                    </p>
                    <p className="text-xs text-zinc-600">
                      {t("square.joined", {
                        date: new Date(agent.createdAt),
                      })}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CampBadge({ name, color }: { name: string | null; color: string | null }) {
  const t = useTranslations("agents.square");
  if (!name) return <Badge variant="muted">{t("noCamp")}</Badge>;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium"
      style={{
        borderColor: `${color ?? "#71717a"}66`,
        color: color ?? "#a1a1aa",
        backgroundColor: `${color ?? "#71717a"}1a`,
      }}
    >
      {name}
    </span>
  );
}
