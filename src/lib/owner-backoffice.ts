// The owner's (Betreiber's) backoffice, plan phase 8: live queue, handovers, settlement and
// statistics of the owner's stations; an admin sees every station. Staff get none.
// Worker: worker/owner.ts. Demo: src/lib/backend/demo.ts. UI: src/components/owner/.
//
// Money (stationsdienste-plan, decision "Geldfluss A", W12):
// - Swaps and charges are the station's revenue: cash stays with the owner, app payments
//   (wallet, Flooz, T-Money) are collected by poinderecharge, fleet swaps are billed to the
//   fleet by poinderecharge. Settled outside the app.
// - Parcel prices taken in cash and the cash drivers hand in at the station belong to
//   poinderecharge: shown apart ("for poinderecharge"), never in the owner's revenue.
// - Charging sockets belong to poinderecharge or a point partner, never to the station that
//   hosts them (migration 0039): at a partner's station the charges are not its revenue, and
//   the cash it took for them is owed to poinderecharge too.
// - At a shop station the swapping is poinderecharge's as well (0045): its swaps are not the
//   shop's revenue either. What a partner owes is handed over daily (src/lib/station-cash.ts).

import type { Reservation } from "./types";

/** Report periods: today, 7 days, 30 days, 12 months. */
export const REPORT_PERIODS = [1, 7, 30, 365] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export function reportPeriod(value: unknown): ReportPeriod {
  const n = Number(value);
  return (REPORT_PERIODS as readonly number[]).includes(n) ? (n as ReportPeriod) : 7;
}

/** Start of the period: midnight in Lomé (UTC), `days - 1` days before today. */
export function periodStart(days: ReportPeriod, now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1))).toISOString();
}

/** A driver waiting in line at a station. */
export interface LiveDriver {
  stationId: string;
  name: string;
  plate: string | null;
  since: string;
}

/** A collection run being loaded or under way, leaving from or coming to one of the stations. */
export interface LiveRun {
  id: string;
  stationId: string;
  driver: string;
  status: "loading" | "under_way";
  parcels: number;
  /** Parcels of the run for one of the viewer's stations (incoming). */
  incoming: number;
  createdAt: string;
}

/** Parcels waiting at a station. */
export interface LiveParcels {
  stationId: string;
  /** Handed in, waiting for a run or a driver. */
  toSend: number;
  /** On the way here. */
  incoming: number;
  /** Arrived, waiting for the recipient. */
  toPickUp: number;
}

export type HandoverKind = "handover_to_driver" | "received_at_station" | "driver_settlement";

/** A parcel scanned into or out of a driver's hands, or a driver's cash settled at the station. */
export interface Handover {
  at: string;
  stationId: string;
  kind: HandoverKind;
  driver: string | null;
  /** Parcel number (GP-…). */
  parcel: string | null;
  /** Settlement: cash handed in (+) or paid out to the driver (−). */
  amountXof: number | null;
  by: string | null;
}

/** GET /api/owner/live: what is going on now. */
export interface OwnerLive {
  reservations: Reservation[];
  drivers: LiveDriver[];
  runs: LiveRun[];
  parcels: LiveParcels[];
  /** The last 7 days, newest first, at most 50. */
  handovers: Handover[];
}

export interface DayStats {
  /** "2026-10-15" (Lomé). */
  day: string;
  swaps: number;
  charges: number;
  parcels: number;
  swapXof: number;
  chargeXof: number;
}

export interface StaffStats {
  personId: string;
  person: string;
  role: "staff" | "owner" | "admin";
  swaps: number;
  charges: number;
  /** Every logged station action (station_actions). */
  actions: number;
}

/** GET /api/owner/report: settlement and statistics of one station or all of them. */
export interface OwnerReport {
  days: ReportPeriod;
  from: string;
  perDay: DayStats[];
  /** The owner's revenue in the period. */
  revenue: {
    swapCashXof: number;
    swapAppXof: number;
    swapFleetXof: number;
    chargeCashXof: number;
    chargeAppXof: number;
    /** Cash the owner holds: swaps and charges paid in cash. */
    cashXof: number;
    totalXof: number;
  };
  /** W12: cash taken for poinderecharge (parcels, drivers' cash, charges at a partner's station), not in the revenue. */
  poinderecharge: {
    parcelsXof: number;
    driversXof: number;
    /** Charges paid in cash at a partner's station: the sockets are not the station's (0039). */
    chargesXof: number;
    /** Swaps paid in cash at a shop station: the swapping is poinderecharge's there (0045). */
    swapsXof: number;
    /** Charging cards topped up in cash at a partner's counter. */
    cardsXof: number;
    /** Green Credit loaded in cash at a partner's counter (0047). */
    creditXof: number;
    totalXof: number;
    /** Whether a station of the report belongs to a partner (the cash is owed to poinderecharge). */
    thirdParty: boolean;
  };
  /** Swaps and charges per hour of the day (peak hours), Lomé time. */
  hours: number[];
  staff: StaffStats[];
}

/** Days of the period, oldest first, with nothing counted yet. */
export function emptyDays(days: ReportPeriod, now = new Date()): DayStats[] {
  const start = new Date(periodStart(days, now));
  return Array.from({ length: days }, (_, i) => ({
    day: new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10),
    swaps: 0,
    charges: 0,
    parcels: 0,
    swapXof: 0,
    chargeXof: 0,
  }));
}

/** Twelve months instead of 365 days, for the 12-month chart. */
export function byMonth(perDay: DayStats[]): DayStats[] {
  const out = new Map<string, DayStats>();
  for (const d of perDay) {
    const key = d.day.slice(0, 7);
    const m = out.get(key) ?? { day: key, swaps: 0, charges: 0, parcels: 0, swapXof: 0, chargeXof: 0 };
    m.swaps += d.swaps;
    m.charges += d.charges;
    m.parcels += d.parcels;
    m.swapXof += d.swapXof;
    m.chargeXof += d.chargeXof;
    out.set(key, m);
  }
  return [...out.values()];
}
