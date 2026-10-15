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

/** Drivers are never customers (R11): wallet, greenpoints, reservations and bookings answer 403. */
export function refuseDriver(user: { role: string }) {
  if (user.role === "driver") throw new ApiError("forbidden", 403);
}
