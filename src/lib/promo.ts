/**
 * Advertising popup shown when the app opens. Admins manage the ads in the
 * backoffice (/admin/promotions); see docs/BACKOFFICE.md.
 */
export interface Promotion {
  id: string;
  title: string;
  body: string;
  /** Public image URL (Cloudflare R2 via /api/media, any https URL, or a data URL in the demo). */
  imageUrl: string | null;
  /** Optional button: where it leads and what it says. */
  linkUrl: string | null;
  linkLabel: string | null;
  isActive: boolean;
  /** Shown from / until this moment; null = no limit. */
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PromotionInput = Pick<
  Promotion,
  "title" | "body" | "imageUrl" | "linkUrl" | "linkLabel" | "isActive" | "startsAt" | "endsAt"
>;

/** Largest image the backoffice accepts. */
export const MAX_PROMO_IMAGE_BYTES = 2 * 1024 * 1024;

/** Whether the ad may be shown at `now`: switched on and within its period. */
export function isRunning(p: Pick<Promotion, "isActive" | "startsAt" | "endsAt">, now: Date): boolean {
  if (!p.isActive) return false;
  const t = now.getTime();
  if (p.startsAt && new Date(p.startsAt).getTime() > t) return false;
  if (p.endsAt && new Date(p.endsAt).getTime() <= t) return false;
  return true;
}

/** The ad to show: of the running ones, the one the admin changed last. */
export function pickPromotion(list: Promotion[], now: Date): Promotion | null {
  const running = list.filter((p) => isRunning(p, now));
  running.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return running[0] ?? null;
}

/** Local calendar day ("2026-10-12"), so "once a day" follows the rider's clock. */
export function localDay(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Marker stored on the device once an ad was shown. The ad comes back the next
 * day, or straight away when the admin publishes a different or edited ad.
 */
export function seenMarker(p: Pick<Promotion, "id" | "updatedAt">, now: Date): string {
  return `${p.id}|${p.updatedAt}|${localDay(now)}`;
}

/** Only http(s) links are followed, so an ad can never run script. */
export function safeLink(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Image sources the popup accepts: http(s) URLs and inline images (demo uploads). */
export function safeImage(url: string | null): string | null {
  if (!url) return null;
  if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(url)) return url;
  return safeLink(url);
}
