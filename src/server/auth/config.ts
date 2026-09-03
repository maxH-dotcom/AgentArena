import { PrismaAdapter } from "@auth/prisma-adapter";
import { compare } from "bcryptjs";
import { type DefaultSession, type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { z } from "zod";

import { env } from "~/env";
import { db } from "~/server/db";

// Ensures the "next-auth/jwt" augmentation below resolves.
import type {} from "next-auth/jwt";

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
  }
}

const credentialsSchema = z.object({
  name: z.string().min(1),
  password: z.string().min(1),
});

// GitHub OAuth is optional: only registered when both env vars are configured.
const oauthProviders =
  env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET
    ? [
        GitHub({
          clientId: env.AUTH_GITHUB_ID,
          clientSecret: env.AUTH_GITHUB_SECRET,
        }),
      ]
    : [];

/**
 * Options for NextAuth.js used to configure adapters, providers, callbacks, etc.
 *
 * The credentials provider requires the JWT session strategy; the Prisma adapter is
 * still used for OAuth account linking and user records.
 *
 * @see https://next-auth.js.org/configuration/options
 */
export const authConfig = {
  adapter: PrismaAdapter(db),
  session: { strategy: "jwt" },
  // Required when self-hosting outside Vercel (local dev included).
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "name-password",
      credentials: {
        name: { label: "Name", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const user = await db.user.findFirst({
          where: { name: parsed.data.name, deletedAt: null },
        });
        if (!user?.passwordHash) return null;
        const valid = await compare(parsed.data.password, user.passwordHash);
        if (!valid) return null;
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.avatar ?? user.image,
        };
      },
    }),
    ...oauthProviders,
  ],
  callbacks: {
    jwt: ({ token, user }) => {
      // `user` is only present on sign-in; persist the id into the token.
      if (user?.id) token.userId = user.id;
      return token;
    },
    session: ({ session, token }) => ({
      ...session,
      user: {
        ...session.user,
        id: token.userId ?? token.sub ?? "",
      },
    }),
  },
} satisfies NextAuthConfig;
