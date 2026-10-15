import type { Operator, StationView } from "./types";

/**
 * Operator accounts: an operator is the company a station belongs to. An admin
 * links accounts to it (see /admin/operators); those people then work at all
 * its stations like staff, choose the staff of those stations and keep their
 * opening hours and phone up to date (see /exploitant).
 */

export interface OperatorPerson {
  userId: string;
  /** Name, else phone number or e-mail address. */
  label: string;
}

export interface OperatorStaff extends OperatorPerson {
  stationId: string;
}

/**
 * A staff member removed from a station when staff were limited to one station (migration
 * 0033, W2): the owner's list to re-staff that station.
 */
export interface StaffReassignment extends OperatorPerson {
  id: string;
  stationId: string;
  /** The station the person works at now, if any. */
  currentStationId: string | null;
  createdAt: string;
}

/** Prices the owner sets for a station (FCFA); null = none (swap) or the network default (charging). */
export interface StationPrices {
  stationId: string;
  swapXof: number | null;
  chargeKwhXof: number | null;
  chargeMinXof: number | null;
}

/** What the signed-in operator account manages; an admin sees every operator. */
export interface OwnerView {
  operators: Operator[];
  stations: StationView[];
  staff: OperatorStaff[];
  reassignments: StaffReassignment[];
  prices: StationPrices[];
}

/** The station details an operator account may change itself. Prices left out stay as they are. */
export interface OwnerStationInput {
  /** Days and times (src/lib/opening-hours.ts); never empty. */
  openingHours: string;
  phone: string | null;
  swapXof?: number | null;
  chargeKwhXof?: number | null;
  chargeMinXof?: number | null;
}

/** A price in FCFA as the owner may set it: whole, 0 to 100 000, a multiple of 5 (null = none). */
export function validPrice(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100_000 && value % 5 === 0);
}

/** Backoffice row: an operator, how many stations it has and who runs it. */
export interface AdminOperator extends Operator {
  contactPhone: string | null;
  stationCount: number;
  owners: OperatorPerson[];
}

export interface OperatorInput {
  name: string;
  contactPhone: string | null;
}

export const OPERATOR_NAME_MAX = 80;

/**
 * Whether the station pages (status, reservations, parcels) are for this profile.
 * Menu and rights follow the role: operators and admins; which stations comes from the assignments.
 */
export function worksAtStations(profile: { role: string } | null | undefined): boolean {
  return profile?.role === "operator" || profile?.role === "admin";
}

/** Station staff accounts: their menu is the map, their station and their account, and they have no greenpoints. */
export function isStationStaff(profile: { role: string } | null | undefined): boolean {
  return profile?.role === "operator";
}

/** Whether this profile runs at least one operator ("Mes stations"). */
export function runsOperator(profile: { role: string; ownerOf?: string[] } | null | undefined): boolean {
  return worksAtStations(profile) && !!profile?.ownerOf?.length;
}
