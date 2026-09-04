import { jsonError, jsonOk } from "~/server/api";
import { processAll } from "~/server/eval/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/internal/eval-worker — drain the EvalJob queue (internal endpoint).
 * Requires header `x-internal-token` to match process.env.INTERNAL_TOKEN;
 * when the env var is not configured the endpoint refuses all requests.
 */
export async function POST(request: Request) {
  const token = process.env.INTERNAL_TOKEN;
  if (!token) {
    return jsonError(503, "NOT_CONFIGURED", "INTERNAL_TOKEN is not configured");
  }
  if (request.headers.get("x-internal-token") !== token) {
    return jsonError(401, "UNAUTHORIZED", "invalid x-internal-token");
  }
  const stats = await processAll();
  return jsonOk({ ok: true, ...stats });
}
