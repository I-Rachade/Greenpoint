"use client";

import { useEffect, useRef, useState } from "react";
import type { PhoneCountry } from "@/lib/countries";
import { ChevronIcon } from "./icons";
import { useI18n } from "./i18n-provider";

/**
 * Flags drawn as SVG: emoji flags show as two letters on Windows.
 * One entry per country in PHONE_COUNTRIES.
 */
const FLAGS: Record<string, React.ReactNode> = {
  TG: (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} y={i * 6} width="50" height="6" fill={i % 2 ? "#FFCE00" : "#006A4E"} />
      ))}
      <rect width="18" height="18" fill="#D21034" />
      <path
        fill="#fff"
        d="M9 3.2l1.35 4.15h4.37l-3.53 2.57 1.35 4.15L9 11.5l-3.54 2.57 1.35-4.15-3.53-2.57h4.37z"
      />
    </>
  ),
};

export function Flag({ code, className = "" }: { code: string; className?: string }) {
  return (
    <svg viewBox="0 0 50 30" className={`h-4 w-[27px] shrink-0 rounded-[3px] ring-1 ring-black/10 ${className}`} aria-hidden>
      {FLAGS[code] ?? <rect width="50" height="30" fill="#d4d4d8" />}
    </svg>
  );
}

/** Button with the flag and dialling code; opens the list of countries. */
export function CountryPicker({
  countries,
  value,
  onChange,
}: {
  countries: PhoneCountry[];
  value: PhoneCountry;
  onChange: (country: PhoneCountry) => void;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${t.login.country}: ${value.name[locale]} ${value.dial}`}
        onClick={() => setOpen(!open)}
        className="flex h-full items-center gap-2 rounded-xl border border-gp-border bg-gp-surface px-3 py-3 text-base outline-none focus:border-gp-green-dark dark:border-white/15"
      >
        <Flag code={value.code} />
        <span className="font-medium tabular-nums">{value.dial}</span>
        <ChevronIcon size={16} className={`text-gp-muted transition-transform ${open ? "-rotate-90" : "rotate-90"}`} />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={t.login.country}
          className="absolute left-0 top-full z-20 mt-1 min-w-56 overflow-hidden rounded-xl border border-gp-border bg-gp-surface py-1 shadow-lg dark:border-white/15"
        >
          {countries.map((c) => (
            <li key={c.code} role="option" aria-selected={c.code === value.code}>
              <button
                type="button"
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-gp-border/50 dark:hover:bg-white/10 ${
                  c.code === value.code ? "font-semibold" : ""
                }`}
              >
                <Flag code={c.code} />
                <span className="flex-1">{c.name[locale]}</span>
                <span className="tabular-nums text-gp-muted">{c.dial}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
