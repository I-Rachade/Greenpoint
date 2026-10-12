"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useApp } from "./app-provider";
import { useI18n } from "./i18n-provider";
import { safeImage, safeLink, seenMarker, type Promotion } from "@/lib/promo";

const SEEN_KEY = "poinderecharge-promo-seen";
/** Staff, admins and the login flow are never interrupted by an ad. */
const QUIET_PATHS = ["/admin", "/operator", "/login"];
/** Fallback when browser storage is blocked: at most once per app start. */
let shownThisSession = false;

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
 * Shows the current ad (managed in /admin/promotions) when the app opens,
 * at most once a day per device. Nothing shows when no ad is running.
 */
export function PromoPopup() {
  const { backend } = useApp();
  const pathname = usePathname();
  const [promo, setPromo] = useState<Promotion | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const quiet = QUIET_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    if (quiet || shownThisSession) return;
    let active = true;
    backend.currentPromotion().then(
      (p) => {
        if (!active || !p || shownThisSession) return;
        const marker = seenMarker(p, new Date());
        try {
          if (window.localStorage.getItem(SEEN_KEY) === marker) return;
          window.localStorage.setItem(SEEN_KEY, marker);
        } catch {
          // Storage blocked: the session flag below still limits it to once per start.
        }
        shownThisSession = true;
        setPromo(p);
      },
      () => {
        // No ad is better than an error on opening the app.
      },
    );
    return () => {
      active = false;
    };
  }, [backend, quiet]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (promo && dialog && !dialog.open) dialog.showModal();
  }, [promo]);

  if (!promo) return null;
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
