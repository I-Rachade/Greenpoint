import { isHolding } from "./availability";
import type { Dictionary } from "./i18n/fr";
import { format } from "./i18n/format";
import type { Parcel } from "./parcels";
import type { Promotion } from "./promo";
import type { Reservation } from "./types";

export type AlertTone = "success" | "info" | "warning" | "muted";

/** One line in the notifications screen, built from the customer's own data. */
export interface Alert {
  /** Changes when the underlying status changes, so a new status counts as unread again. */
  id: string;
  title: string;
  text: string | null;
  at: string;
  href: string;
  tone: AlertTone;
  icon: "reservation" | "parcel" | "promotion";
}

/** Only the last month is listed. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function buildAlerts(
  input: {
    reservations: Reservation[];
    parcels: Parcel[];
    stationNames: Map<string, string>;
    promotion: Promotion | null;
  },
  t: Dictionary,
  now: Date,
): Alert[] {
  const a = t.ui.alerts;
  const name = (id: string) => input.stationNames.get(id) ?? "–";
  const alerts: Alert[] = [];

  for (const r of input.reservations) {
    const station = name(r.stationId);
    const status = r.status === "active" && !isHolding(r, now) ? "expired" : r.status;
    const at = status === "expired" ? r.expiresAt : r.createdAt;
    if (status === "active") {
      const left = Math.max(0, Math.ceil((new Date(r.expiresAt).getTime() - now.getTime()) / 60_000));
      alerts.push({
        id: `res:${r.id}:active`,
        title: format(a.reservationActive, { station }),
        text: format(a.reservationActiveText, {
          code: r.pickupCode ?? "–",
          left: format(t.time.minutesLeft, { n: left }),
        }),
        at,
        href: "/reservations",
        tone: "success",
        icon: "reservation",
      });
    } else {
      const title =
        status === "completed" ? a.reservationCompleted : status === "cancelled" ? a.reservationCancelled : a.reservationExpired;
      alerts.push({
        id: `res:${r.id}:${status}`,
        title: format(title, { station }),
        text: r.cancelReason ? (t.reservations.cancelReasons[r.cancelReason] ?? null) : null,
        at,
        href: "/reservations",
        tone: status === "completed" ? "info" : status === "cancelled" ? "warning" : "muted",
        icon: "reservation",
      });
    }
  }

  for (const p of input.parcels) {
    const at = p.pickedUpAt ?? p.arrivedAt ?? p.inTransitAt ?? p.createdAt;
    const arrivedForMe = p.status === "arrived" && p.direction === "received";
    alerts.push({
      id: `parcel:${p.id}:${p.status}`,
      title: arrivedForMe
        ? format(a.parcelArrived, { no: p.trackingNo, station: name(p.toStationId) })
        : format(a.parcelStatus, { no: p.trackingNo, status: t.parcels.status[p.status] }),
      text: arrivedForMe && p.pickupCode ? format(a.parcelArrivedText, { code: p.pickupCode }) : null,
      at,
      href: "/colis",
      tone: arrivedForMe ? "success" : "info",
      icon: "parcel",
    });
  }

  if (input.promotion) {
    alerts.push({
      id: `promo:${input.promotion.id}:${input.promotion.updatedAt}`,
      title: input.promotion.title || a.promotion,
      text: input.promotion.body || null,
      at: input.promotion.startsAt ?? input.promotion.updatedAt,
      href: input.promotion.linkUrl ?? "/",
      tone: "info",
      icon: "promotion",
    });
  }

  return alerts
    .filter((x) => now.getTime() - new Date(x.at).getTime() < MAX_AGE_MS)
    .sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());
}
