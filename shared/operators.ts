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

/**
 * What an operator account may do (migration 0070): `manage` runs the stations (staff, hours,
 * prices, corrections) and works there; `read` only looks at My stations.
 */
export type OwnerAccess = "manage" | "read";

/** An account linked to an operator in the backoffice, with what it may do. */
export interface OperatorOwner extends OperatorPerson {
  access: OwnerAccess;
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

/** Days a staff invite stays open (like fleet and shop invites). */
export const STAFF_INVITE_DAYS = 7;
/** Open staff invites per station at a time, so an owner cannot send them to everyone. */
export const STAFF_INVITE_LIMIT = 20;

/**
 * An open invite to work at one of the owner's stations (migration 0050). It is made for the
 * phone number or e-mail address the owner typed; the owner never learns whether an account
 * has it. `label` is that contact, masked like staff labels.
 */
export interface StaffInvite {
  id: string;
  stationId: string;
  label: string;
  createdAt: string;
  expiresAt: string;
}

/** An open staff invite for the signed-in person's phone number or e-mail address. */
export interface MyStaffInvite {
  id: string;
  stationName: string;
  operatorName: string;
  expiresAt: string;
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
  /** Open staff invites of the stations (oldest first). */
  invites: StaffInvite[];
  prices: StationPrices[];
  /** The signed-in account only reads (migration 0070): no button that changes anything. */
  readOnly: boolean;
}

/** The station details an operator account may change itself. Prices left out stay as they are. */
export interface OwnerStationInput {
  /** Days and times (shared/opening-hours.ts); never empty. */
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

/** A station as listed under its operator in the backoffice. */
export interface OperatorStation {
  id: string;
  name: string;
  address: string;
  isActive: boolean;
  /** Off only because its operator was switched off: it comes back on with the operator (migration 0067). */
  pausedWithOperator: boolean;
}

/** Backoffice row: an operator, its stations, whether it is on and who runs it. */
export interface AdminOperator extends Operator {
  contactPhone: string | null;
  /** Off: all its stations are off too (migration 0067). */
  isActive: boolean;
  stationCount: number;
  /** Its stations, by name. */
  stations: OperatorStation[];
  owners: OperatorOwner[];
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
export function worksAtStations(profile: { role: string; ownerReadOnly?: boolean } | null | undefined): boolean {
  return (profile?.role === "operator" && !profile.ownerReadOnly) || profile?.role === "admin";
}

/** Station staff accounts: their menu is the map, their station and their account, and they have no greenpoints. */
export function isStationStaff(profile: { role: string; ownerReadOnly?: boolean } | null | undefined): boolean {
  return profile?.role === "operator" && !profile.ownerReadOnly;
}

/**
 * Read-only operator account (migration 0070): its menu is My stations and its account; it changes
 * nothing and does not work at the stations (the server refuses its writes, worker/api.ts).
 */
export function isReadOnlyOwner(profile: { role: string; ownerReadOnly?: boolean; ownerOf?: string[] } | null | undefined): boolean {
  return profile?.role === "operator" && !!profile.ownerReadOnly && !!profile.ownerOf?.length;
}

/** Whether this profile runs at least one operator ("Mes stations"), read-only accounts included. */
export function runsOperator(profile: { role: string; ownerOf?: string[] } | null | undefined): boolean {
  return (profile?.role === "operator" || profile?.role === "admin") && !!profile?.ownerOf?.length;
}
