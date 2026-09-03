import createMiddleware from "next-intl/middleware";

import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Skip: /api (REST /api/v1 + Auth.js), /.well-known (agent cards), Next internals,
  // and any path containing a file extension.
  matcher: ["/", "/(en|zh)/:path*", "/((?!api|_next|_vercel|.well-known|.*\\..*).*)"],
};
