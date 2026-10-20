"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { useI18n } from "@/components/i18n-provider";
import {
  BatteryIcon,
  BoltIcon,
  BoxIcon,
  CarIcon,
  ClipboardIcon,
  GearIcon,
  GlobeIcon,
  GridIcon,
  HistoryIcon,
  LeafIcon,
  PhoneBoltIcon,
  PlugIcon,
  ScooterIcon,
  ShieldIcon,
  StarIcon,
  StoreIcon,
  TicketIcon,
  TruckIcon,
  UsersIcon,
  WalletIcon,
  WifiIcon,
  WrenchIcon,
} from "@/components/icons";
import type { Dictionary } from "@/lib/i18n/fr";

/** The merchants page takes its label from merchantDrivers.admin (its own i18n section). */
type NavKey = keyof Dictionary["backoffice"]["nav"] | "merchants";
type GroupKey = keyof Dictionary["backoffice"]["navGroups"];

/** The backoffice pages in five groups (plan phase 8): operations, customers, parcels and drivers, money, settings. */
export const ADMIN_NAV: { group: GroupKey; links: { href: string; key: NavKey }[] }[] = [
  {
    group: "operations",
    links: [
      { href: "/admin", key: "overview" },
      { href: "/admin/stations", key: "stations" },
      { href: "/admin/batteries", key: "batteries" },
      // Renting e-motorbikes from station to station (src/lib/share.ts).
      { href: "/admin/share", key: "share" },
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
      { href: "/admin/merchants", key: "merchants" },
    ],
  },
  {
    group: "money",
    links: [
      { href: "/admin/wallet", key: "wallet" },
      { href: "/admin/charging", key: "charging" },
      { href: "/admin/caisse", key: "stationCash" },
    ],
  },
  {
    group: "settings",
    links: [
      { href: "/admin/services", key: "services" },
      { href: "/admin/operators", key: "operators" },
      { href: "/admin/devices", key: "devices" },
      { href: "/admin/proprietaires", key: "pointPartners" },
      { href: "/admin/ev-chargers", key: "evChargers" },
      { href: "/admin/repair-centers", key: "repairCenters" },
      { href: "/admin/partners", key: "partners" },
    ],
  },
];

/** Sidebar icon of each page. */
const NAV_ICON: Record<NavKey, ComponentType<SVGProps<SVGSVGElement> & { size?: number }>> = {
  overview: GridIcon,
  stations: BoltIcon,
  batteries: BatteryIcon,
  share: ScooterIcon,
  stationBackoffice: StoreIcon,
  activity: HistoryIcon,
  reservations: TicketIcon,
  users: UsersIcon,
  greenpoint: LeafIcon,
  promotions: StarIcon,
  parcels: BoxIcon,
  drivers: ScooterIcon,
  fleets: TruckIcon,
  merchants: StoreIcon,
  wallet: WalletIcon,
  charging: PhoneBoltIcon,
  stationCash: ClipboardIcon,
  services: GearIcon,
  operators: ShieldIcon,
  devices: WifiIcon,
  pointPartners: PlugIcon,
  evChargers: CarIcon,
  repairCenters: WrenchIcon,
  partners: GlobeIcon,
};

const pill = (active: boolean) =>
  `inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-4 text-sm ${
    active ? "bg-gp-forest text-white" : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
  }`;

/**
 * Backoffice frame under /admin. Wide screens: a dark sidebar with every page by group.
 * Phones and tablets: the groups, then the pages of the open group.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const label = (key: NavKey) => (key === "merchants" ? t.merchantDrivers.admin.nav : t.backoffice.nav[key]);
  const pathname = usePathname().replace(/\/$/, "") || "/";
  const current = ADMIN_NAV.find((g) => g.links.some((l) => l.href === pathname)) ?? ADMIN_NAV[0];
  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-60 shrink-0 flex-col overflow-y-auto bg-gp-forest px-3 py-5 text-white/80 lg:flex dark:border-r dark:border-white/10 dark:bg-black/30">
        <nav aria-label={t.backoffice.title} className="space-y-4">
          {ADMIN_NAV.map((g) => (
            <div key={g.group}>
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-white/45">{t.backoffice.navGroups[g.group]}</div>
              <ul className="space-y-0.5 text-sm">
                {g.links.map((l) => {
                  const Icon = NAV_ICON[l.key];
                  const active = pathname === l.href;
                  return (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        aria-current={active ? "page" : undefined}
                        className={`flex min-h-10 items-center gap-3 rounded-lg px-3 font-medium transition-colors ${
                          active ? "bg-gp-green text-gp-forest" : "hover:bg-white/10 hover:text-white"
                        }`}
                      >
                        <Icon size={18} />
                        {label(l.key)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6 lg:px-8">
          <nav aria-label={t.backoffice.title} className="space-y-1 border-b border-black/10 pb-2 lg:hidden dark:border-white/10">
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
                    {label(l.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          {children}
        </div>
      </div>
    </div>
  );
}
