import type { DeliveryJob, DriverSettings, DriverStatus, FleetVehicle } from "./drivers";

/**
 * Fleet managers: an admin links drivers to a manager (each driver has at most
 * one). The manager sees them on /flotte, hands open trips to them ahead of the
 * queue and follows their trips, takings and charging costs.
 */

/** Menu and rights follow the role, like the station pages (operators.ts). */
export function managesFleet(profile: { role: string } | null | undefined): boolean {
  return profile?.role === "fleet_manager" || profile?.role === "admin";
}

/** One of the manager's drivers, without documents or QR code. */
export interface FleetDriver {
  userId: string;
  fullName: string;
  phone: string | null;
  status: DriverStatus;
  vehicle: FleetVehicle | null;
  /** Owed to us (positive) or to the driver (negative), in FCFA. */
  balanceFcfa: number;
  queue: { stationId: string; since: string; position: number } | null;
  /** The trip the driver is on or was offered. */
  job: DeliveryJob | null;
}

export interface FleetView {
  drivers: FleetDriver[];
  /** Trips nobody has yet, oldest first; customers' contacts left out. */
  openJobs: DeliveryJob[];
  settings: DriverSettings;
}

/** What one driver did in a period. */
export interface FleetDriverStats {
  userId: string;
  tripsDone: number;
  /** Deliveries nobody took (parcel brought back). */
  tripsFailed: number;
  /** Fares of the finished trips: what the driver brought in. */
  fareFcfa: number;
  /** The driver's share of those fares. */
  earningFcfa: number;
  /** Cash taken from customers. */
  collectedFcfa: number;
  /** Cash handed in at stations (positive) or paid to the driver (negative). */
  settledFcfa: number;
  /** Charging at stations: battery swaps and charging slots used. */
  batterySwaps: number;
  chargingSlots: number;
  /** Paid through the app for those (Flooz, T-Money). */
  chargingPaidFcfa: number;
}

export interface FleetStats {
  /** Inclusive days, YYYY-MM-DD (Lomé is on UTC). */
  from: string;
  to: string;
  drivers: FleetDriverStats[];
}

/** Longest period the overview covers in one go. */
export const FLEET_MAX_DAYS = 366;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The period as ISO bounds [start, end), or null when it is not a valid range. */
export function fleetRange(from: string, to: string): { start: string; end: string } | null {
  if (!DAY.test(from) || !DAY.test(to)) return null;
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;
  end.setUTCDate(end.getUTCDate() + 1);
  if ((end.getTime() - start.getTime()) / 86_400_000 > FLEET_MAX_DAYS) return null;
  return { start: start.toISOString(), end: end.toISOString() };
}

/** What a manager may see of a trip: the route and the money, not the customer's contacts. */
export function jobForManager(job: DeliveryJob): DeliveryJob {
  return {
    ...job,
    home: job.home ? { ...job.home, phone: "" } : null,
    recipient: null,
    customerName: null,
    declaredValue: null,
    proofKey: null,
  };
}
