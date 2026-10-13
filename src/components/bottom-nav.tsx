"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useApp } from "./app-provider";
import { BellIcon, HeartIcon, ListIcon, MapIcon, UserIcon } from "./icons";
import { useI18n } from "./i18n-provider";
import { useAlerts } from "./use-alerts";

/** Screens without the tab bar: sign-in, and the staff and admin tools. */
const HIDDEN_PREFIXES = ["/login", "/admin", "/operator"];

/** Tab bar at the bottom of the screen on phones (web and app). */
export function BottomNav() {
  const { t } = useI18n();
  const { profile } = useApp();
  const pathname = usePathname();
  const { unread } = useAlerts();
  const hidden = HIDDEN_PREFIXES.some((p) => pathname.startsWith(p));

  useEffect(() => {
    document.body.classList.toggle("has-tabs", !hidden);
  }, [hidden]);

  if (hidden) return null;

  const tabs = [
    { href: "/", label: t.ui.tabs.map, icon: MapIcon, active: pathname === "/" },
    { href: "/stations", label: t.ui.tabs.stations, icon: ListIcon, active: pathname.startsWith("/stations") || pathname.startsWith("/station") },
    { href: "/favoris", label: t.ui.tabs.favorites, icon: HeartIcon, active: pathname.startsWith("/favoris") },
    { href: "/notifications", label: t.ui.tabs.alerts, icon: BellIcon, active: pathname.startsWith("/notifications"), badge: unread },
    {
      href: profile ? "/compte" : "/login",
      label: t.ui.tabs.account,
      icon: UserIcon,
      active: ["/compte", "/parametres", "/reservations", "/colis", "/portefeuille"].some((p) => pathname.startsWith(p)),
    },
  ];

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
