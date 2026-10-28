import type { OperatorPerson } from "./operators";
import type { ReportPeriod } from "./owner-backoffice";
import type { ChargingPointStatus } from "./types";

/**
 * Point partners (partenaires propriétaires, migration 0039): a charging socket belongs to
 * poinderecharge, wherever it is, unless an admin gives it to a point partner. The station
 * only hosts it. A point partner's accounts stay customers and see, read-only, where their
 * sockets are, how they are doing and what they earned (/proprietaire). An admin creates the
 * partner, links the accounts and picks the owner of each socket (/admin/proprietaires,
 * /admin/devices).
 * Worker: worker/point-partners.ts. Demo: src/lib/backend/demo.ts.
 */

export type PointPartnerStatus = "active" | "suspended";

/** On the profile of a linked account. */
export interface PointPartnerRef {
  id: string;
  name: string;
  status: PointPartnerStatus;
}

export interface PointPartnerInput {
  name: string;
  contactPhone: string | null;
}

export const POINT_PARTNER_NAME_MAX = 80;

/** Backoffice row: the partner, its accounts and its sockets. */
export interface AdminPointPartner extends PointPartnerRef {
  contactPhone: string | null;
  createdAt: string;
  accounts: OperatorPerson[];
  devices: { externalId: string; stationId: string | null; outlets: number }[];
}

/** One of the partner's charging points with what it did in the period. */
export interface PartnerPoint {
  id: string;
  label: string;
  outlet: number | null;
  deviceId: string;
  stationId: string;
  stationName: string;
  stationAddress: string;
  lat: number;
  lng: number;
  status: ChargingPointStatus;
  powerWatts: number | null;
  lastSeenAt: string | null;
  /** Paid charges of the period on this point. */
  charges: number;
  energyWh: number;
  amountXof: number;
}

/** GET /api/point-partner?days=: the partner's dashboard. */
export interface PointPartnerDashboard {
  partner: PointPartnerRef & { contactPhone: string | null };
  days: ReportPeriod;
  from: string;
  points: PartnerPoint[];
  totals: {
    charges: number;
    energyWh: number;
    amountXof: number;
    /** Paid at the counter of the station. */
    cashXof: number;
    /** Paid in the app (none so far: point partners' sockets are paid at the counter). */
    appXof: number;
  };
}

/** Whether this profile opens the point partner's dashboard ("Mes points de recharge"). */
export function ownsPoints(profile: { pointPartner?: PointPartnerRef | null } | null | undefined): boolean {
  return !!profile?.pointPartner;
}

/** Charging points grouped by station, stations in the order they first appear. */
export function pointsByStation(points: PartnerPoint[]): { stationId: string; stationName: string; stationAddress: string; points: PartnerPoint[] }[] {
  const groups = new Map<string, { stationId: string; stationName: string; stationAddress: string; points: PartnerPoint[] }>();
  for (const p of points) {
    const g = groups.get(p.stationId) ?? { stationId: p.stationId, stationName: p.stationName, stationAddress: p.stationAddress, points: [] };
    g.points.push(p);
    groups.set(p.stationId, g);
  }
  return [...groups.values()];
}
