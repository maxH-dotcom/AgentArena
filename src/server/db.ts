import { env } from "~/env";
import { PrismaClient } from "../../generated/prisma";

const createPrismaClient = () => {
  const client = new PrismaClient({
    log:
      env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });
  // SQLite: enable WAL so readers don't block writers (see docs/PLAN.md 架构评审调整 #2)
  void client.$queryRawUnsafe("PRAGMA journal_mode=WAL;").catch((e: unknown) => {
    console.error("Failed to enable SQLite WAL mode", e);
  });
  return client;
};

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") globalForPrisma.prisma = db;
