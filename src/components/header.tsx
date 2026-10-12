"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DemoBackend, DEMO_CODE } from "@/lib/backend";
import { format } from "@/lib/i18n/format";
import { useApp } from "./app-provider";
import { useI18n } from "./i18n-provider";

export function Header() {
  const { t, locale, setLocale } = useI18n();
  const { backend, profile } = useApp();
  const pathname = usePathname();

  const links: { href: string; label: string; show: boolean }[] = [
    { href: "/", label: t.nav.map, show: true },
    { href: "/reservations", label: t.nav.reservations, show: !!profile },
    { href: "/operator", label: t.nav.operator, show: profile?.role === "operator" || profile?.role === "admin" },
    { href: "/admin", label: t.nav.admin, show: profile?.role === "admin" },
  ];

  return (
    <header className="z-20 border-b border-black/10 bg-white dark:border-white/10 dark:bg-zinc-950">
      {backend.mode === "demo" && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 bg-amber-100 px-4 py-1 text-center text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
          <span>{t.demo.banner}</span>
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
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-3 py-2 sm:flex-nowrap sm:gap-3 sm:px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold text-green-700 dark:text-green-400">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mini.svg" alt="" width={28} height={28} className="h-7 w-7" />
          {t.appName}
        </Link>
        <span className="flex-1 sm:hidden" />
        <nav className="order-last flex w-full gap-1 overflow-x-auto text-sm sm:order-none sm:w-auto sm:flex-1">
          {links
            .filter((l) => l.show)
            .map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`whitespace-nowrap rounded-full px-3 py-1 ${
                  pathname === l.href
                    ? "bg-green-600 text-white"
                    : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                {l.label}
              </Link>
            ))}
        </nav>
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
            className="whitespace-nowrap text-sm text-zinc-600 hover:underline dark:text-zinc-400"
          >
            {t.nav.logout}
          </button>
        ) : (
          <Link href="/login" className="whitespace-nowrap rounded-full bg-green-600 px-3 py-1 text-sm text-white">
            {t.nav.login}
          </Link>
        )}
      </div>
    </header>
  );
}
