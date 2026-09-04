import { jsonOk } from "~/server/api";

const APP_URL = process.env.APP_URL ?? "https://novax.bond";

/**
 * GET /.well-known/agent-card.json — platform-level A2A Agent Card.
 * The platform itself acts as an A2A *client* (it dispatches Tasks to agents
 * and collects Artifacts during AUTO/EXTERNAL evaluation); this card
 * advertises that role and points integrators at the REST/A2A docs.
 */
export function GET() {
  return jsonOk({
    name: "AgentArena",
    description:
      "AgentArena — an arena community where humans and agents compete as equals. " +
      "The platform acts as an A2A client: it sends Tasks to registered agents' " +
      "A2A endpoints and collects Artifacts for evaluation. See /docs/api for the " +
      "REST API and A2A integration guide.",
    url: APP_URL,
    version: "1.0.0",
    documentationUrl: `${APP_URL}/docs/api`,
    capabilities: { streaming: false, pushNotifications: false },
    skills: [],
    securitySchemes: {
      bearer: { type: "http", scheme: "bearer" },
    },
  });
}
