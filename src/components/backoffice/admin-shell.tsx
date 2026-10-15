"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useI18n } from "@/components/i18n-provider";
import type { Dictionary } from "@/lib/i18n/fr";

type NavKey = keyof Dictionary["backoffice"]["nav"];
type GroupKey = keyof Dictionary["backoffice"]["navGroups"];

/** The backoffice pages in five groups (plan phase 8): operations, customers, parcels and drivers, money, settings. */
export const ADMIN_NAV: { group: GroupKey; links: { href: string; key: NavKey }[] }[] = [
  {
    group: "operations",
    links: [
      { href: "/admin", key: "overview" },
      { href: "/admin/stations", key: "stations" },
      // Live queue, settlement and statistics of every station (the owners' backoffice; admin all).
      { href: "/exploitant", key: "stationBackoffice" },
      { href: "/admin/activity", key: "activity" },
    ],
  },
  {
    group: "customers",
    links: [
      { href: "/admin/reservations", key: "reservations" },
      { href: "/admin/users", key: "users" },
      { href: "/admin/greenpoint", key: "greenpoint" },
      { href: "/admin/promotions", key: "promotions" },
    ],
  },
  {
    group: "parcelsDrivers",
    links: [
      { href: "/admin/parcels", key: "parcels" },
      { href: "/admin/drivers", key: "drivers" },
      { href: "/admin/fleets", key: "fleets" },
    ],
  },
  {
    group: "money",
    links: [
      { href: "/admin/wallet", key: "wallet" },
      { href: "/admin/charging", key: "charging" },
    ],
  },
  {
    group: "settings",
    links: [
      { href: "/admin/services", key: "services" },
      { href: "/admin/operators", key: "operators" },
      { href: "/admin/devices", key: "devices" },
      { href: "/admin/ev-chargers", key: "evChargers" },
      { href: "/admin/partners", key: "partners" },
    ],
  },
];

const pill = (active: boolean) =>
  `inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-4 text-sm ${
    active ? "bg-gp-forest text-white" : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
  }`;

/** Sub-navigation for the backoffice pages under /admin: the groups, then the pages of the open group. */
export function AdminShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname().replace(/\/$/, "") || "/";
  const current = ADMIN_NAV.find((g) => g.links.some((l) => l.href === pathname)) ?? ADMIN_NAV[0];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6">
        <nav aria-label={t.backoffice.title} className="space-y-1 border-b border-black/10 pb-2 dark:border-white/10">
          <ul className="flex gap-1 overflow-x-auto text-sm font-semibold">
            {ADMIN_NAV.map((g) => (
              <li key={g.group}>
                <Link href={g.links[0].href} aria-current={g === current ? "true" : undefined} className={pill(g === current)}>
                  {t.backoffice.navGroups[g.group]}
                </Link>
              </li>
            ))}
          </ul>
          <ul className="flex gap-1 overflow-x-auto text-sm" aria-label={t.backoffice.navGroups[current.group]}>
            {current.links.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={pathname === l.href ? "page" : undefined}
                  className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-3 ${
                    pathname === l.href ? "bg-gp-green/15 font-semibold text-gp-green-dark dark:text-gp-green" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  }`}
                >
                  {t.backoffice.nav[l.key]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {children}
      </div>
    </div>
  );
}
