"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DEMO_CODE, HOSTED_DEMO } from "@/lib/backend";
import { format } from "@/lib/i18n/format";
import { ADMIN_HOME } from "@/lib/config";
import { useApp } from "./app-provider";
import { BellIcon, ChevronIcon, GearIcon } from "./icons";
import { useI18n } from "./i18n-provider";
import { useAlerts } from "./use-alerts";
import { isReadOnlyOwner, isStationStaff, runsOperator, worksAtStations } from "@shared/operators";
import { ownsPoints } from "@shared/point-partners";
import { isDriverAccount } from "@shared/drivers";
import { isMerchantAccount } from "@shared/merchants";

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
  // A read-only operator account (migration 0070) gets My stations and its account, nothing else.
  const viewer = isReadOnlyOwner(profile);
  const customer = !!profile && !isDriverAccount(profile) && !fleet && !merchant && !viewer;

  // `tier`: which links stay in the bar as the screen narrows, the others go into the "Plus" menu,
  // so the bar keeps one line at any width. 0 always, 1 from lg, 2 from xl, 3 always in the menu.
  const links: { href: string; label: string; show: boolean; tier: Tier }[] = [
    { href: "/", label: t.nav.map, show: !viewer, tier: 0 },
    { href: "/stations", label: t.ui.tabs.stations, show: !viewer, tier: 0 },
    { href: "/favoris", label: t.ui.tabs.favorites, show: !viewer, tier: 3 },
    // Scan a socket or show my QR code (staff: scan the customer's); on phones it is the raised button in the tab bar.
    { href: "/scanner", label: t.ui.tabs.scan, show: !profile || customer, tier: 2 },
    { href: "/reservations", label: t.nav.reservations, show: customer, tier: 2 },
    { href: "/colis", label: t.nav.parcels, show: customer && features.parcels, tier: 3 },
    { href: "/courses", label: t.ui.tabs.trips, show: customer && features.parcels, tier: 3 },
    { href: "/portefeuille", label: t.nav.wallet, show: customer && walletShown && features.wallet, tier: 3 },
    { href: "/greenpoint", label: t.nav.greenpoint, show: customer && !isStationStaff(profile), tier: 3 },
    { href: "/chauffeur", label: t.nav.driver, show: !!profile?.driverStatus && features.parcels, tier: 1 },
    { href: "/compte", label: t.nav.account, show: !!profile, tier: 1 },
    { href: "/flotte", label: t.nav.fleet, show: fleet && features.parcels, tier: 1 },
    { href: "/marchand", label: t.merchant.nav, show: merchant, tier: 1 },
    { href: "/exploitant", label: t.nav.owner, show: runsOperator(profile), tier: 1 },
    { href: "/proprietaire", label: t.nav.points, show: ownsPoints(profile), tier: 1 },
    { href: "/operator", label: t.nav.operator, show: worksAtStations(profile), tier: 1 },
    { href: ADMIN_HOME, label: t.nav.admin, show: profile?.role === "admin", tier: 1 },
  ];

  const shown = links.filter((l) => l.show);
  const active = (href: string) =>
    pathname === href || (href === "/admin" && pathname.startsWith("/admin/")) || (href === "/operator" && pathname.startsWith("/operator/"));

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
            onClick={() => backend.reset?.()}
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
        <nav className="hidden min-w-0 flex-1 items-center gap-1 text-sm md:flex">
          {shown
            .filter((l) => l.tier < 3)
            .map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`${IN_BAR[l.tier]} whitespace-nowrap rounded-full px-3 py-1.5 font-medium ${active(l.href) ? ON : OFF}`}
              >
                {l.label}
              </Link>
            ))}
          <MoreMenu label={t.ui.more} links={shown.filter((l) => l.tier > 0)} active={active} />
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

type Tier = 0 | 1 | 2 | 3;
/** A link in the bar shows from this width up... */
const IN_BAR: Record<Tier, string> = { 0: "inline-flex", 1: "hidden lg:inline-flex", 2: "hidden xl:inline-flex", 3: "hidden" };
/** ...and in the "Plus" menu below it. */
const IN_MENU: Record<Tier, string> = { 0: "hidden", 1: "block lg:hidden", 2: "block xl:hidden", 3: "block" };

const ON = "bg-gp-forest text-white dark:bg-gp-green dark:text-gp-forest";
// Tailwind needs the full class names, so the "active below lg / xl" variants are spelled out.
const ON_BELOW_LG = "max-lg:bg-gp-forest max-lg:text-white dark:max-lg:bg-gp-green dark:max-lg:text-gp-forest";
const ON_BELOW_XL = "max-xl:bg-gp-forest max-xl:text-white dark:max-xl:bg-gp-green dark:max-xl:text-gp-forest";
const OFF = "text-zinc-700 hover:bg-gp-green/10 dark:text-zinc-300 dark:hover:bg-white/10";

/** Secondary links on computers ("Plus ▾"), so the bar keeps one line at any width. */
function MoreMenu({ label, links, active }: { label: string; links: { href: string; label: string; tier: Tier }[]; active: (href: string) => boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  // Close when the page changes, on a click elsewhere and on Escape.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (links.length === 0) return null;
  // Highlighted while the open page is one of the links in the menu at this width.
  const here = links.find((l) => active(l.href))?.tier;
  const tone = here === 3 ? ON : here === 2 ? `${OFF} ${ON_BELOW_XL}` : here === 1 ? `${OFF} ${ON_BELOW_LG}` : OFF;
  // The button goes away at the widths where every link fits in the bar.
  const top = Math.max(...links.map((l) => l.tier));
  const button = top === 3 ? "inline-flex" : top === 2 ? "inline-flex xl:hidden" : "inline-flex lg:hidden";
  return (
    <div ref={box} className={`relative ${button}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 font-medium ${tone}`}
      >
        {label}
        <ChevronIcon size={14} className={open ? "-rotate-90" : "rotate-90"} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-2 min-w-48 rounded-[14px] border border-gp-border bg-gp-surface p-1.5 shadow-lg dark:border-white/10">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`${IN_MENU[l.tier]} whitespace-nowrap rounded-[8px] px-3 py-2 ${active(l.href) ? "bg-gp-green/15 font-semibold text-gp-green-dark dark:text-gp-green" : "hover:bg-gp-green/10"}`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </div>
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
