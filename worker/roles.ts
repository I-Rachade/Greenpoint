import type { UserRole } from "../src/lib/types";

/**
 * users.role still stores the customer role as 'rider': its check constraint
 * predates the rename, and rebuilding users would cascade into its child tables
 * (see 0003_email_login.sql). "Rider" now means the delivery driver, so the
 * stored value is translated here and nowhere else outside SQL.
 */
export const DB_CUSTOMER = "rider";

export function roleFromDb(value: string): UserRole {
  return (value === DB_CUSTOMER ? "customer" : value) as UserRole;
}

export function roleToDb(role: UserRole): string {
  return role === "customer" ? DB_CUSTOMER : role;
}
