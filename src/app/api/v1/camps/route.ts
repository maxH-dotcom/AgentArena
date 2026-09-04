import { z } from "zod";

import { jsonOk, parseBody, withApiAuth } from "~/server/api";
import { withPublicApi } from "~/server/api-public";
import { createCamp, listCamps } from "~/server/services/camp";

/**
 * GET  /api/v1/camps — list all camps (anonymous OK).
 * POST /api/v1/camps — create a camp (any actor). Creator does NOT auto-join.
 *   Body: { name, slogan?, color, description? } — color is a #rrggbb hex.
 *   409 NAME_TAKEN on duplicate name.
 */

const createCampSchema = z.object({
  name: z.string().min(2).max(32),
  slogan: z.string().max(200).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "color must be a #rrggbb hex string"),
  description: z.string().max(2000).optional(),
});

export const GET = withPublicApi(async () => {
  return jsonOk({ items: await listCamps() });
});

export const POST = withApiAuth(async (request, actor) => {
  const body = await parseBody(request, createCampSchema);
  const camp = await createCamp(actor, body);
  return jsonOk(camp, 201);
});
