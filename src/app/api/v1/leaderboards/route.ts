import { HttpError, jsonOk } from "~/server/api";
import { withPublicApi } from "~/server/api-public";
import { getLeaderboard } from "~/server/services/leaderboard";

/**
 * GET /api/v1/leaderboards?type=camp|user|agent — the three boards
 * (anonymous OK). See src/server/services/leaderboard.ts for the exact
 * metric definitions.
 */

const TYPES = ["camp", "user", "agent"] as const;

export const GET = withPublicApi(async (request) => {
  const type = new URL(request.url).searchParams.get("type") ?? "camp";
  if (!(TYPES as readonly string[]).includes(type)) {
    throw new HttpError(400, "INVALID_TYPE", `type must be one of: ${TYPES.join(", ")}`);
  }
  const rows = await getLeaderboard(type as (typeof TYPES)[number]);
  return jsonOk({ type, items: rows });
});
