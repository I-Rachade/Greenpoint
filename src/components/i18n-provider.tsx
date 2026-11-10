"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { fr, type Dictionary } from "@/lib/i18n/fr";

export type Locale = "fr" | "en";
/**
 * French ships with every page (the pages are rendered in French); English is fetched only
 * when someone uses it, so the others do not download it (about 100 KB compressed).
 */
let english: Dictionary | null = null;
const loadEnglish = (): Promise<Dictionary> =>
  english ? Promise.resolve(english) : import("@/lib/i18n/en").then((m) => (english = m.en));
const STORAGE_KEY = "poinderecharge-locale";

interface I18nContextValue {
  locale: Locale;
  t: Dictionary;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("fr");
  const [englishLoaded, setEnglishLoaded] = useState<Dictionary | null>(english);

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
    // Until English arrives (a moment, from the app's own files) the page stays in French.
    if (locale === "en" && !englishLoaded) loadEnglish().then(setEnglishLoaded, () => {});
  }, [locale, englishLoaded]);

  const dictionary = locale === "en" && englishLoaded ? englishLoaded : fr;
  const shown: Locale = dictionary === fr ? "fr" : "en";
  useEffect(() => {
    document.documentElement.lang = shown;
  }, [shown]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }, []);

  return (
    <I18nContext value={{ locale: shown, t: dictionary, setLocale }}>{children}</I18nContext>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
