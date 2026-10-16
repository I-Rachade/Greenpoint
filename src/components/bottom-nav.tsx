"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useApp } from "./app-provider";
import { BoxIcon, ListIcon, MapIcon, QrIcon, ScooterIcon, StoreIcon, TruckIcon, UserIcon } from "./icons";
import { useI18n } from "./i18n-provider";
import { useAlerts } from "./use-alerts";
import { isStationStaff } from "@/lib/operators";
import { isDriverAccount } from "@/lib/drivers";
import { isMerchantAccount } from "@/lib/merchants";

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
  // Fleet managers get the map, the stations, their fleet and their account (plan phase 7).
  const fleet = profile?.role === "fleet_manager";
  // Merchants and their employees get the map, the stations, their shop and their account (planung/marchand.md).
  const merchant = isMerchantAccount(profile);
  const customer = !staff && !driver && !fleet && !merchant;
  const hidden = (staff ? STAFF_HIDDEN_PREFIXES : HIDDEN_PREFIXES).some((p) => pathname.startsWith(p));

  useEffect(() => {
    document.body.classList.toggle("has-tabs", !hidden);
  }, [hidden]);

  if (hidden) return null;

  // The lite version (backoffice switch) has no stations tab: the map, the scanner and the account.
  // Favourites and alerts live on the account page; its tab carries the unread count.
  // Parcels and trips only show while the parcel module is on in the backoffice.
  const tabs = [
    { href: "/", label: t.ui.tabs.map, icon: MapIcon, active: pathname === "/", show: true },
    { href: "/stations", label: t.ui.tabs.stations, icon: ListIcon, active: pathname.startsWith("/stations") || pathname.startsWith("/station"), show: !staff && !features.lite },
    { href: "/operator", label: t.ui.tabs.myStation, icon: StoreIcon, active: pathname.startsWith("/operator"), show: staff },
    { href: "/chauffeur", label: t.nav.driver, icon: ScooterIcon, active: pathname.startsWith("/chauffeur"), show: driver },
    { href: "/flotte", label: t.nav.fleet, icon: TruckIcon, active: pathname.startsWith("/flotte"), show: fleet && features.parcels },
    { href: "/marchand", label: t.merchant.nav, icon: StoreIcon, active: pathname.startsWith("/marchand"), show: merchant },
    // Parcels and trips share one tab: it opens a page to pick what to do (src/components/deliveries.tsx).
    {
      href: "/livraisons",
      label: t.ui.tabs.deliveries,
      icon: BoxIcon,
      active: ["/livraisons", "/colis", "/courses"].some((p) => pathname.startsWith(p)),
      show: features.parcels && customer,
    },
    {
      href: profile ? "/compte" : "/login",
      label: t.ui.tabs.account,
      icon: UserIcon,
      active: ["/compte", "/parametres", "/reservations", "/portefeuille", "/favoris", "/notifications"].some((p) => pathname.startsWith(p)),
      badge: unread,
      show: true,
    },
  ].filter((tab) => tab.show);

  // The scanner page (src/components/scan-hub.tsx: scan a socket or show my QR code): a raised round button in the exact middle of
  // the bar, on every page; the tabs split left and right of it. Customers and station staff get it (staff scan
  // the customer's code there); drivers, fleets and merchants don't.
  const scan = customer || staff;
  const split = scan ? Math.ceil(tabs.length / 2) : tabs.length;

  const renderTabs = (list: typeof tabs) =>
    list.map(({ href, label, icon: Icon, active, badge }) => (
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
    ));

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-gp-border bg-gp-surface/95 backdrop-blur md:hidden dark:border-white/10"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex h-16 max-w-lg items-stretch">
        <ul className="flex flex-1 items-stretch">{renderTabs(tabs.slice(0, split))}</ul>
        {scan && (
          <div className="flex w-20 shrink-0 justify-center">
            <Link
              href="/scanner"
              aria-label={t.charging.qr.scan}
              title={t.charging.qr.scan}
              aria-current={pathname.startsWith("/scanner") || pathname.startsWith("/recharge") ? "page" : undefined}
              className="-mt-7 flex h-16 w-16 items-center justify-center rounded-full bg-gp-yellow text-gp-forest shadow-lg ring-4 ring-gp-surface"
            >
              <QrIcon size={28} strokeWidth={2.2} />
            </Link>
          </div>
        )}
        {split < tabs.length && <ul className="flex flex-1 items-stretch">{renderTabs(tabs.slice(split))}</ul>}
      </div>
    </nav>
  );
}
