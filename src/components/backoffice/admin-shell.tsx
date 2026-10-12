"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useI18n } from "@/components/i18n-provider";

/** Sub-navigation for the backoffice pages under /admin. */
export function AdminShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname().replace(/\/$/, "") || "/";
  const links = [
    { href: "/admin", label: t.backoffice.nav.overview },
    { href: "/admin/stations", label: t.backoffice.nav.stations },
    { href: "/admin/reservations", label: t.backoffice.nav.reservations },
    { href: "/admin/users", label: t.backoffice.nav.users },
    { href: "/admin/activity", label: t.backoffice.nav.activity },
    { href: "/admin/devices", label: t.backoffice.nav.devices },
    { href: "/admin/promotions", label: t.backoffice.nav.promotions },
    { href: "/admin/parcels", label: t.backoffice.nav.parcels },
    { href: "/admin/partners", label: t.backoffice.nav.partners },
  ];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6">
        <nav aria-label={t.backoffice.title} className="flex gap-1 overflow-x-auto border-b border-black/10 pb-2 text-sm dark:border-white/10">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={pathname === l.href ? "page" : undefined}
              className={`whitespace-nowrap rounded-full px-3 py-1 ${
                pathname === l.href
                  ? "bg-gp-forest text-white"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        {children}
      </div>
    </div>
  );
}
