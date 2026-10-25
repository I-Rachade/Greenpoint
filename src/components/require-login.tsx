"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { loginHref } from "@/lib/next-path";
import { worksAtStations } from "@shared/operators";
import type { UserRole } from "@shared/types";
import { useApp } from "./app-provider";
import { useI18n } from "./i18n-provider";

/**
 * Renders children only for logged-in users (optionally with one of `roles`).
 * `stationWork`: station staff, operator accounts and admins.
 */
export function RequireLogin({ roles, stationWork, children }: { roles?: UserRole[]; stationWork?: boolean; children: ReactNode }) {
  const { t } = useI18n();
  const { profile, ready } = useApp();
  const pathname = usePathname();

  if (!ready) return <p className="p-6 text-sm text-zinc-500">{t.loading}</p>;
  if (!profile) {
    // After login, come back here (with the query, e.g. /portefeuille?topup=…). Only rendered once
    // `ready`, so always in the browser.
    const here = pathname + (typeof window === "undefined" ? "" : window.location.search);
    return (
      <div className="p-6">
        <Link href={loginHref(here)} className="rounded-full bg-gp-green-dark px-4 py-2 text-sm font-medium text-white">
          {t.nav.login}
        </Link>
      </div>
    );
  }
  if ((roles && !roles.includes(profile.role)) || (stationWork && !worksAtStations(profile))) {
    return <p className="p-6 text-sm text-red-600">{t.errors.forbidden}</p>;
  }
  return <>{children}</>;
}
