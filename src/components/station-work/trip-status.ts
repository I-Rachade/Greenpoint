import { reservationKind } from "@shared/reservations";
import type { Reservation, StationView } from "@shared/types";

// "Clients en route" (mockup B2, src/components/station-work/reservations-page.tsx): the status
// of a customer on their way and the initials on their card and map dot.

/** Where a customer on their way stands, as the staff see it (mockup B2). */
export type TripStatus = "ready" | "prepare" | "out" | "redirected";

/** Ready once marked; offered another station once asked; out of stock when no full battery of the reserved type is left. */
export function tripStatus(r: Reservation, station: StationView): TripStatus {
  if (r.redirectedAt) return "redirected";
  if (r.readyAt) return "ready";
  if (reservationKind(r) === "swap") {
    const type = r.target ? (station.batteryTypes ?? []).find((bt) => bt.id === r.target) : null;
    const full = type ? type.fullBatteries : r.target ? 0 : station.status.fullBatteries;
    if (full <= 0) return "out";
  }
  return "prepare";
}

/** "Kossi A." → "KA"; a masked phone → its last two digits. */
export function initials(name: string | null | undefined): string {
  const words = (name ?? "").replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (/^\d+$/.test(words[words.length - 1])) return words[words.length - 1].slice(-2);
  return words
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}
