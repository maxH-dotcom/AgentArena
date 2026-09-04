/**
 * Side-effect module: load `.env` before any `~/` import, because
 * src/server/db.ts → src/env.js validates env at import time.
 * Imported first by every script in this directory.
 */
try {
  process.loadEnvFile(".env");
} catch {
  // .env is optional; fall back to the default dev database.
}
process.env.DATABASE_URL ??= "file:./db.sqlite";
// Scripts default to "test" so src/server/db.ts doesn't log every query.
// (process.env.NODE_ENV is typed read-only in @types/node — assign via a cast.)
const env = process.env as Record<string, string | undefined>;
env.NODE_ENV ??= "test";
