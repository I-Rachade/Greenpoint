"use client";

import { useLiveQuery } from "@/lib/hooks";
import { isToday, type ActivityItem } from "@shared/station-activity";
import type { StationView } from "@shared/types";
import { useApp } from "../app-provider";

export interface StationDay {
  items: ActivityItem[];
  swaps: number;
  charges: number;
  parcels: number;
  /** Taken today for swaps and charges, FCFA; and the part paid with Green Credit. */
  takenXof: number;
  creditXof: number;
  /** Parcels waiting here for their recipient (badge on the Colis tile). */
  parcelsWaiting: number;
}

/**
 * Today at the station (mockups B1 and B5), from what the staff already read: the swap log
 * (today only for staff), today's charges and the parcels of the station. A service that is
 * off, or a list the person may not read, simply counts nothing.
 */
export function useStationDay(station: StationView) {
  const { backend } = useApp();
  const active = station.activeServices ?? [];
  const has = (s: string) => active.includes(s as never);
  return useLiveQuery(
    async (): Promise<StationDay> => {
      const now = new Date();
      const [swaps, charging, parcels] = await Promise.all([
        has("swap") ? backend.stationSwaps(station.id).catch(() => []) : Promise.resolve([]),
        has("charging") || has("ev") ? backend.stationCharging(station.id).catch(() => null) : Promise.resolve(null),
        has("parcels") ? backend.stationParcels(station.id).catch(() => []) : Promise.resolve([]),
      ]);
      const todaySwaps = swaps.filter((s) => isToday(s.createdAt, now));
      const charges = (charging?.today ?? []).filter((c) => isToday(c.startedAt, now));
      const items: ActivityItem[] = [
        ...todaySwaps.map((s) => ({
          id: `swap-${s.id}`,
          kind: "swap" as const,
          at: s.createdAt,
          what: s.batteryTypeLabel,
          who: s.customer ?? s.driver ?? s.customerName ?? null,
          amountXof: s.payment === "fleet" || s.payment === "none" ? null : s.amountXof,
          payment: s.payment,
        })),
        ...charges.map((c) => ({
          id: `charge-${c.id}`,
          kind: "charge" as const,
          at: c.startedAt,
          what: c.pointLabel,
          who: c.customer,
          amountXof: c.paidAt ? c.amountXof : null,
          payment: null,
        })),
        ...parcels.flatMap((p) => [
          ...(p.fromStationId === station.id && isToday(p.createdAt, now)
            ? [{ id: `in-${p.id}`, kind: "parcel_in" as const, at: p.createdAt, what: p.trackingNo, who: p.sender.name, amountXof: null }]
            : []),
          ...(p.toStationId === station.id && isToday(p.pickedUpAt, now)
            ? [{ id: `out-${p.id}`, kind: "parcel_out" as const, at: p.pickedUpAt!, what: p.trackingNo, who: p.recipient?.name ?? null, amountXof: null }]
            : []),
        ]),
      ];
      const swapTaken = todaySwaps.reduce((n, s) => n + (s.payment === "fleet" || s.payment === "none" ? 0 : s.amountXof), 0);
      const swapCredit = todaySwaps.reduce((n, s) => n + (s.payment === "wallet" ? s.amountXof : 0), 0);
      return {
        items,
        swaps: todaySwaps.length,
        charges: charges.length,
        parcels: items.filter((i) => i.kind === "parcel_in" || i.kind === "parcel_out").length,
        takenXof: swapTaken + (charging ? charging.takings.cashXof + charging.takings.appXof : 0),
        creditXof: swapCredit + (charging?.takings.appXof ?? 0),
        parcelsWaiting: parcels.filter((p) => p.toStationId === station.id && p.status === "arrived").length,
      };
    },
    `${station.id}:${active.join(",")}`,
  );
}
