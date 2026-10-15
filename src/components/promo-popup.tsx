"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useApp } from "./app-provider";
import { useI18n } from "./i18n-provider";
import { useOnboarding } from "@/lib/prefs";
import { safeImage, safeLink, type Promotion } from "@/lib/promo";

/** The ad shows on the map only; other pages are never interrupted. */
const MAP_PATH = "/";

/** Ads already shown in this browser session (sessionStorage), so coming back to the map does not reopen one. */
const SEEN_KEY = "gp-promo-seen";

function seenPromos(): string[] {
  try {
    const list: unknown = JSON.parse(window.sessionStorage.getItem(SEEN_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function markSeen(id: string) {
  try {
    window.sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seenPromos().filter((x) => x !== id), id]));
  } catch {
    // Private mode or storage off: the ad may show again, which is acceptable.
  }
}

/** Content of the ad window; also used as the preview in the backoffice. */
export function PromoCard({
  promo,
  onClose,
}: {
  promo: Pick<Promotion, "title" | "body" | "imageUrl" | "linkUrl" | "linkLabel">;
  onClose?: () => void;
}) {
  const { t } = useI18n();
  const [brokenImage, setBrokenImage] = useState<string | null>(null);
  const image = safeImage(promo.imageUrl);
  const link = safeLink(promo.linkUrl);
  return (
    <div className="relative overflow-hidden rounded-2xl bg-white text-zinc-900 shadow-xl dark:bg-zinc-900 dark:text-zinc-100">
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={t.promo.close}
          className="absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-xl leading-none text-white hover:bg-black/70"
        >
          ×
        </button>
      )}
      {image && brokenImage !== image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          className="max-h-[50vh] w-full bg-zinc-100 object-cover dark:bg-zinc-800"
          onError={() => setBrokenImage(image)}
        />
      )}
      <div className="space-y-3 p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-gp-muted dark:text-zinc-400">{t.promo.label}</p>
        <h2 className="font-heading text-xl font-semibold leading-snug">{promo.title}</h2>
        {promo.body && <p className="whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300">{promo.body}</p>}
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer sponsored"
            onClick={onClose}
            className="block rounded-full bg-gp-green-dark px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-gp-forest"
          >
            {promo.linkLabel?.trim() || t.promo.more}
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Shows the current ad (managed in /admin/promotions) when the customer opens the
 * map, at most once per ad and browser session. Nothing shows when no ad is running.
 */
export function PromoPopup() {
  const { backend } = useApp();
  const pathname = usePathname();
  const [promo, setPromo] = useState<Promotion | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [introShowing] = useOnboarding();
  // Never on top of the first-launch introduction.
  const onMap = pathname === MAP_PATH && introShowing === false;

  useEffect(() => {
    if (!onMap) return;
    let active = true;
    backend.currentPromotion().then(
      (p) => {
        if (!active) return;
        if (p && !seenPromos().includes(p.id)) {
          markSeen(p.id);
          setPromo({ ...p });
        } else setPromo(null);
      },
      () => {
        // No ad is better than an error on opening the map.
      },
    );
    return () => {
      active = false;
    };
  }, [backend, onMap]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (onMap && promo && dialog && !dialog.open) dialog.showModal();
  }, [onMap, promo]);

  if (!onMap || !promo) return null;
  const close = () => dialogRef.current?.close();

  return (
    <dialog
      ref={dialogRef}
      aria-label={promo.title}
      onClose={() => setPromo(null)}
      // A tap on the dark area around the window closes it.
      onClick={(e) => e.target === e.currentTarget && close()}
      className="m-auto w-[calc(100%-2rem)] max-w-md bg-transparent p-0 backdrop:bg-black/60"
    >
      <PromoCard promo={promo} onClose={close} />
    </dialog>
  );
}
