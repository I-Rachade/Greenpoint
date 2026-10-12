"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { en } from "@/lib/i18n/en";
import { fr, type Dictionary } from "@/lib/i18n/fr";

export type Locale = "fr" | "en";
const dictionaries: Record<Locale, Dictionary> = { fr, en };
const STORAGE_KEY = "pointderecharge-locale";

interface I18nContextValue {
  locale: Locale;
  t: Dictionary;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("fr");

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(STORAGE_KEY);
    } catch {}
    const preferred = saved ?? (navigator.language.startsWith("en") ? "en" : "fr");
    // Read after mount: the server always renders French, so reading earlier would break hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (preferred === "en" || preferred === "fr") setLocaleState(preferred);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }, []);

  return (
    <I18nContext value={{ locale, t: dictionaries[locale], setLocale }}>{children}</I18nContext>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
