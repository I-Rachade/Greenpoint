"use client";

import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { useOnboarding } from "@/lib/prefs";
import { useI18n } from "./i18n-provider";

/**
 * Pages that open without the introduction (legal pages, links from the stores, staff,
 * shared station and login links, and the outlet QR codes). Each entry also covers the pages below it,
 * but "/station" does not cover "/stations".
 */
const SKIP_PREFIXES = ["/admin", "/operator", "/cgu", "/confidentialite", "/mentions-legales", "/developpeurs", "/compte", "/station", "/login", "/recharge"];
const skipsIntro = (path: string) => SKIP_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

/**
 * Three-slide introduction on first launch (web and app). Swipe or tap "Next";
 * "Skip" closes it. Settings has "Replay the introduction".
 */
export function Onboarding() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [show, setSeen] = useOnboarding();
  const [index, setIndex] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const slides = t.ui.onboarding.slides;

  if (!show || skipsIntro(pathname)) return null;

  const last = index === slides.length - 1;
  const goTo = (i: number) => {
    const el = track.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
    setIndex(i);
  };
  const finish = () => {
    setSeen(true);
    setIndex(0);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
      role="dialog"
      aria-modal
      aria-label={slides[index].title}
    >
      <div className="flex justify-end p-4">
        {!last && (
          <button type="button" onClick={finish} className="rounded-full px-3 py-1 text-sm font-medium text-gp-muted">
            {t.ui.onboarding.skip}
          </button>
        )}
      </div>

      <div
        ref={track}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]"
        onScroll={(e) => {
          const el = e.currentTarget;
          const i = Math.round(el.scrollLeft / el.clientWidth);
          if (i !== index) setIndex(i);
        }}
      >
        {slides.map((slide, i) => (
          <section key={i} className="flex w-full shrink-0 snap-center flex-col items-center justify-center gap-8 px-8 text-center">
            <div className="flex aspect-square w-full max-w-72 items-center justify-center rounded-[2.5rem] bg-gp-green/15 dark:bg-gp-green/10">
              <Illustration index={i} />
            </div>
            <div className="max-w-sm space-y-3">
              <h2 className="text-2xl font-bold text-gp-forest dark:text-zinc-50">{slide.title}</h2>
              <p className="text-base text-gp-muted dark:text-zinc-300">{slide.text}</p>
            </div>
          </section>
        ))}
      </div>

      <div className="flex items-center justify-between gap-4 p-6">
        <div className="flex gap-2" aria-hidden>
          {slides.map((_, i) => (
            <span
              key={i}
              className={`h-2 rounded-full transition-all ${i === index ? "w-6 bg-gp-green-dark" : "w-2 bg-gp-border dark:bg-white/20"}`}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => (last ? finish() : goTo(index + 1))}
          className="min-w-32 rounded-full bg-gp-green-dark px-6 py-3 font-semibold text-white shadow-sm"
        >
          {last ? t.ui.onboarding.start : t.ui.onboarding.next}
        </button>
      </div>
    </div>
  );
}

/** Simple drawings in the brand colours, one per slide; token classes so dark mode follows. */
function Illustration({ index }: { index: number }) {
  const common = { width: 200, height: 200, viewBox: "0 0 200 200", "aria-hidden": true } as const;
  // Dark parts (phone, battery) lift to the border tone in dark mode so they stay visible.
  const body = "fill-gp-forest dark:fill-gp-border";
  if (index === 0) {
    return (
      <svg {...common}>
        <rect x="20" y="30" width="160" height="140" rx="22" strokeWidth="3" className="fill-gp-surface stroke-gp-border" />
        <path d="M20 95h160M85 30v140M140 30v140" strokeWidth="10" className="stroke-gp-border" opacity=".6" />
        <circle cx="62" cy="128" r="10" strokeWidth="4" className="fill-gp-info stroke-gp-surface" />
        <circle cx="62" cy="128" r="22" opacity=".15" className="fill-gp-info" />
        <path d="M120 112s-18-17-18-31a18 18 0 0 1 36 0c0 14-18 31-18 31Z" className="fill-gp-green" />
        <path d="m123 70-8 12h7l-3 9 9-13h-7l2-8Z" className="fill-gp-forest" />
        <path d="M156 70s-9-8-9-15a9 9 0 0 1 18 0c0 7-9 15-9 15Z" opacity=".6" className="fill-gp-green-dark dark:fill-gp-green" />
        <path d="M48 70s-9-8-9-15a9 9 0 0 1 18 0c0 7-9 15-9 15Z" opacity=".6" className="fill-gp-green-dark dark:fill-gp-green" />
        <path d="M62 128c20-6 40-6 58-16" strokeWidth="3" strokeDasharray="4 6" fill="none" className="stroke-gp-forest dark:stroke-gp-muted" />
      </svg>
    );
  }
  if (index === 1) {
    return (
      <svg {...common}>
        <rect x="55" y="18" width="90" height="164" rx="18" className={body} />
        <rect x="63" y="34" width="74" height="132" rx="10" className="fill-gp-surface" />
        <rect x="72" y="48" width="56" height="10" rx="5" className="fill-gp-border" />
        <rect x="72" y="70" width="56" height="44" rx="10" opacity=".18" className="fill-gp-green" />
        <text x="100" y="99" textAnchor="middle" fontFamily="Poppins, sans-serif" fontWeight="700" fontSize="20" className="fill-gp-green-dark dark:fill-gp-green">
          4827
        </text>
        <rect x="72" y="126" width="56" height="16" rx="8" className="fill-gp-green-dark" />
        <circle cx="150" cy="56" r="20" className="fill-gp-yellow" />
        <path d="M150 44v12l8 5" strokeWidth="4" strokeLinecap="round" fill="none" className="stroke-gp-forest" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="40" y="70" width="70" height="40" rx="8" className={body} />
      <rect x="110" y="82" width="8" height="16" rx="3" className={body} />
      <rect x="47" y="77" width="48" height="26" rx="4" className="fill-gp-green" />
      <path d="m78 76-12 16h9l-4 12 13-17h-9l3-11Z" className="fill-gp-yellow" />
      <path d="M150 60a55 55 0 0 0-95-20" strokeWidth="7" strokeLinecap="round" fill="none" className="stroke-gp-green-dark dark:stroke-gp-green" />
      <path d="m48 26 6 17 17-5" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" className="stroke-gp-green-dark dark:stroke-gp-green" />
      <path d="M50 140a55 55 0 0 0 95 20" strokeWidth="7" strokeLinecap="round" fill="none" className="stroke-gp-green" />
      <path d="m152 174-6-17-17 5" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" className="stroke-gp-green" />
    </svg>
  );
}
