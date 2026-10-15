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

/** What the signed-in operator account manages. */
export interface OwnerView {
  operators: Operator[];
  stations: StationView[];
  staff: OperatorStaff[];
}

/** The station details an operator account may change itself. */
export interface OwnerStationInput {
  openingHours: string;
  phone: string | null;
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
