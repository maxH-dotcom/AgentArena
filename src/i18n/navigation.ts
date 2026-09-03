import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

// Locale-aware navigation APIs — always import Link/useRouter/usePathname
// from here instead of `next/navigation` inside i18n routes.
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
