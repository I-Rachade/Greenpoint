import type { UserRole } from "../src/lib/types";
import { ApiError } from "./http";

/**
 * users.role still stores the customer role as 'rider': its check constraint
 * predates the rename. "Rider" now means the delivery driver, so the
 * stored value is translated here and nowhere else outside SQL.
 * Drivers have their own role 'driver' since 0030_driver_role.sql.
 */
export const DB_CUSTOMER = "rider";
export const DB_DRIVER = "driver";

export function roleFromDb(value: string): UserRole {
  return (value === DB_CUSTOMER ? "customer" : value) as UserRole;
}

export function roleToDb(role: UserRole): string {
  return role === "customer" ? DB_CUSTOMER : role;
}

/**
 * Accounts that are never customers (W5, R11, plan phase 8 R2): drivers, fleet managers and
 * station staff and owners (role 'operator'). An admin keeps the customer pages, to test.
 */
export function notCustomerRole(role: string): boolean {
  return role === "driver" || role === "fleet_manager" || role === "operator";
}

/** Only customers (and admins, to test) use the wallet, greenpoints, payments, reservations and bookings: others 403. */
export function refuseNonCustomer(user: { role: string }) {
  if (notCustomerRole(user.role)) throw new ApiError("forbidden", 403);
}
