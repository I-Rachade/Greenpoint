"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { UserRole } from "@/lib/types";
import { useApp } from "./app-provider";
import { useI18n } from "./i18n-provider";

/** Renders children only for logged-in users (optionally with one of `roles`). */
export function RequireLogin({ roles, children }: { roles?: UserRole[]; children: ReactNode }) {
  const { t } = useI18n();
  const { profile, ready } = useApp();

  if (!ready) return <p className="p-6 text-sm text-zinc-500">{t.loading}</p>;
  if (!profile) {
    return (
      <div className="p-6">
        <Link href="/login" className="rounded-full bg-green-600 px-4 py-2 text-sm font-medium text-white">
          {t.nav.login}
        </Link>
      </div>
    );
  }
  if (roles && !roles.includes(profile.role)) {
    return <p className="p-6 text-sm text-red-600">{t.errors.forbidden}</p>;
  }
  return <>{children}</>;
}
