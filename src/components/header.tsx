"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { DemoBackend, DEMO_CODE, HOSTED_DEMO } from "@/lib/backend";
import { format } from "@/lib/i18n/format";
import { useApp } from "./app-provider";
import { BellIcon, GearIcon } from "./icons";
import { useI18n } from "./i18n-provider";
import { useAlerts } from "./use-alerts";
import { isStationStaff, runsOperator, worksAtStations } from "@/lib/operators";
import { ownsPoints } from "@/lib/point-partners";
import { isDriverAccount } from "@/lib/drivers";
import { isMerchantAccount } from "@/lib/merchants";

export function Header() {
  const { t, locale, setLocale } = useI18n();
  const { backend, profile, features } = useApp();
  const pathname = usePathname();
  const walletShown = useWalletShown();
  const { unread } = useAlerts();
  // The map has its own green header on phones; only the demo notice stays above it.
  const onMap = pathname === "/";
  // Drivers and fleet managers are never customers (plan phases 5 and 7): their home is
  // the driver page or the fleet page, with no customer links.
  const fleet = profile?.role === "fleet_manager";
  // Shop accounts are not customers either (planung/marchand.md): their home is /marchand.
  const merchant = isMerchantAccount(profile);
  const customer = !!profile && !isDriverAccount(profile) && !fleet && !merchant;

  const links: { href: string; label: string; show: boolean }[] = [
    { href: "/", label: t.nav.map, show: true },
    { href: "/stations", label: t.ui.tabs.stations, show: true },
    { href: "/favoris", label: t.ui.tabs.favorites, show: true },
    { href: "/reservations", label: t.nav.reservations, show: customer },
    { href: "/colis", label: t.nav.parcels, show: customer && features.parcels },
    { href: "/courses", label: t.ui.tabs.trips, show: customer && features.parcels },
    { href: "/portefeuille", label: t.nav.wallet, show: customer && walletShown && features.wallet },
    { href: "/greenpoint", label: t.nav.greenpoint, show: customer && !isStationStaff(profile) },
    { href: "/chauffeur", label: t.nav.driver, show: !!profile?.driverStatus && features.parcels },
    { href: "/compte", label: t.nav.account, show: !!profile },
    { href: "/flotte", label: t.nav.fleet, show: fleet && features.parcels },
    { href: "/marchand", label: t.merchant.nav, show: merchant },
    { href: "/exploitant", label: t.nav.owner, show: runsOperator(profile) },
    { href: "/proprietaire", label: t.nav.points, show: ownsPoints(profile) },
    { href: "/operator", label: t.nav.operator, show: worksAtStations(profile) },
    { href: "/admin", label: t.nav.admin, show: profile?.role === "admin" },
  ];

  return (
    <header className={`z-20 border-b border-black/10 bg-gp-surface dark:border-white/10 ${onMap && backend.mode !== "demo" ? "hidden md:block" : ""}`}>
      {backend.mode === "demo" && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 bg-amber-100 px-4 py-1 text-center text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
          <span className={HOSTED_DEMO ? "font-semibold" : undefined}>
            {HOSTED_DEMO ? t.demo.hostedBanner : t.demo.banner}
          </span>
          <span className="font-mono">{format(t.demo.codeHint, { code: DEMO_CODE })}</span>
          <button
            type="button"
            className="underline"
            onClick={() => backend instanceof DemoBackend && backend.reset()}
          >
            {t.demo.reset}
          </button>
        </div>
      )}
      <div className={`mx-auto max-w-6xl items-center ${onMap ? "hidden md:flex" : "flex"} gap-2 px-3 py-2 sm:gap-3 sm:px-4`}>
        <Link href="/" className="flex items-center gap-2 font-semibold text-gp-green-dark dark:text-gp-green">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mini.svg" alt="" width={28} height={28} className="h-7 w-7" />
          {t.appName}
        </Link>
        <span className="flex-1 md:hidden" />
        {/* On phones the tab bar at the bottom replaces these links. */}
        <nav className="hidden flex-1 gap-1 overflow-x-auto text-sm md:flex">
          {links
            .filter((l) => l.show)
            .map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`whitespace-nowrap rounded-full px-3 py-1 ${
                  pathname === l.href || (l.href === "/admin" && pathname.startsWith("/admin/")) || (l.href === "/operator" && pathname.startsWith("/operator/"))
                    ? "bg-gp-green-dark text-white"
                    : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                {l.label}
              </Link>
            ))}
        </nav>
        <Link
          href="/notifications"
          className="relative hidden h-9 w-9 items-center justify-center rounded-full text-gp-forest hover:bg-black/5 md:flex dark:text-zinc-200 dark:hover:bg-white/10"
          aria-label={t.ui.alerts.title}
        >
          <BellIcon size={20} />
          {unread > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-gp-closed" />}
        </Link>
        <Link
          href="/parametres"
          className="flex h-9 w-9 items-center justify-center rounded-full text-gp-forest hover:bg-black/5 dark:text-zinc-200 dark:hover:bg-white/10"
          aria-label={t.ui.settings.title}
        >
          <GearIcon size={20} />
        </Link>
        <button
          type="button"
          onClick={() => setLocale(locale === "fr" ? "en" : "fr")}
          className="rounded-full border border-black/10 px-2 py-1 text-xs font-medium uppercase dark:border-white/20"
          aria-label="Langue / Language"
        >
          {locale === "fr" ? "EN" : "FR"}
        </button>
        {profile ? (
          <button
            type="button"
            onClick={() => backend.signOut()}
            className="hidden whitespace-nowrap text-sm text-zinc-600 hover:underline md:inline dark:text-zinc-400"
          >
            {t.nav.logout}
          </button>
        ) : (
          <Link href="/login" className="hidden whitespace-nowrap rounded-full bg-gp-green-dark px-3 py-1 text-sm text-white md:inline">
            {t.nav.login}
          </Link>
        )}
      </div>
    </header>
  );
}

/** The wallet link only appears once the module is on (admins see it while testing). Checked once per login. */
export function useWalletShown(): boolean {
  const { backend, profile } = useApp();
  const [shown, setShown] = useState<{ userId: string; shown: boolean } | null>(null);
  const userId = profile?.id ?? null;
  useEffect(() => {
    if (!userId) return;
    let active = true;
    backend.myWallet().then(
      () => active && setShown({ userId, shown: true }),
      () => active && setShown({ userId, shown: false }),
    );
    return () => {
      active = false;
    };
  }, [backend, userId]);
  return !!userId && shown?.userId === userId && shown.shown;
}
