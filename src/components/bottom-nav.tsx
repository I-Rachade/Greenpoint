"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useApp } from "./app-provider";
import { BoxIcon, ListIcon, MapIcon, ScooterIcon, StoreIcon, UserIcon } from "./icons";
import { useI18n } from "./i18n-provider";
import { useAlerts } from "./use-alerts";
import { isStationStaff } from "@/lib/operators";
import { isDriverAccount } from "@/lib/drivers";

/** Screens without the tab bar: sign-in, and the staff and admin tools. */
const HIDDEN_PREFIXES = ["/login", "/admin", "/operator"];
/** Station staff keep the tab bar on their station screens, which are one of their three tabs. */
const STAFF_HIDDEN_PREFIXES = ["/login", "/admin"];

/** Tab bar at the bottom of the screen on phones (web and app). */
export function BottomNav() {
  const { t } = useI18n();
  const { profile, features } = useApp();
  const pathname = usePathname();
  const { unread } = useAlerts();
  // Station staff only get the map, their station and their account.
  const staff = isStationStaff(profile);
  // Drivers get the map, their driver page and their account (plan phase 5).
  const driver = isDriverAccount(profile);
  const hidden = (staff ? STAFF_HIDDEN_PREFIXES : HIDDEN_PREFIXES).some((p) => pathname.startsWith(p));

  useEffect(() => {
    document.body.classList.toggle("has-tabs", !hidden);
  }, [hidden]);

  if (hidden) return null;

  // Favourites and alerts live on the account page; its tab carries the unread count.
  // Parcels and trips only show while the parcel module is on in the backoffice.
  const tabs = [
    { href: "/", label: t.ui.tabs.map, icon: MapIcon, active: pathname === "/", show: true },
    { href: "/stations", label: t.ui.tabs.stations, icon: ListIcon, active: pathname.startsWith("/stations") || pathname.startsWith("/station"), show: !staff },
    { href: "/operator", label: t.ui.tabs.myStation, icon: StoreIcon, active: pathname.startsWith("/operator"), show: staff },
    { href: "/chauffeur", label: t.nav.driver, icon: ScooterIcon, active: pathname.startsWith("/chauffeur"), show: driver },
    { href: "/colis", label: t.ui.tabs.parcels, icon: BoxIcon, active: pathname.startsWith("/colis"), show: features.parcels && !staff && !driver },
    { href: "/courses", label: t.ui.tabs.trips, icon: ScooterIcon, active: pathname.startsWith("/courses"), show: features.parcels && !staff && !driver },
    {
      href: profile ? "/compte" : "/login",
      label: t.ui.tabs.account,
      icon: UserIcon,
      active: ["/compte", "/parametres", "/reservations", "/portefeuille", "/favoris", "/notifications"].some((p) => pathname.startsWith(p)),
      badge: unread,
      show: true,
    },
  ].filter((tab) => tab.show);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-gp-border bg-gp-surface/95 backdrop-blur md:hidden dark:border-white/10"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex h-16 max-w-lg items-stretch">
        {tabs.map(({ href, label, icon: Icon, active, badge }) => (
          <li key={href} className="flex-1">
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                active ? "text-gp-green-dark dark:text-gp-green" : "text-gp-muted dark:text-zinc-400"
              }`}
            >
              <span className={`relative flex h-8 w-14 items-center justify-center rounded-full ${active ? "bg-gp-green/15" : ""}`}>
                <Icon size={22} />
                {!!badge && (
                  <span className="absolute -top-0.5 right-2 min-w-4 rounded-full bg-gp-closed px-1 text-center text-[10px] leading-4 text-white">
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </span>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
