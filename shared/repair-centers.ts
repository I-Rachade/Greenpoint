import { cleanOpeningHours } from "./opening-hours";

// Repair workshops that are not at a station (migration 0046_repair_centers.sql), e.g. the
// Spiro service centres. Added in the backoffice, shown on the map with their own marker;
// they take no reservations. A workshop at a station is its "repair" amenity instead.

export interface RepairCenter {
  id: string;
  /** The brand it repairs for (an operator), if any. */
  operatorId: string | null;
  operatorName: string | null;
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone: string | null;
  /** Days and times (opening-hours.ts); "" when not known. */
  openingHours: string;
  isActive: boolean;
}

export type RepairCenterInput = Omit<RepairCenter, "id" | "operatorName">;

export const REPAIR_NAME_MAX = 80;
export const REPAIR_ADDRESS_MAX = 200;

/** The input made clean, or null when it cannot be saved. */
export function cleanRepairCenter(input: RepairCenterInput): RepairCenterInput | null {
  const name = String(input?.name ?? "").trim();
  const address = String(input?.address ?? "").trim();
  const lat = Number(input?.lat);
  const lng = Number(input?.lng);
  const rawHours = String(input?.openingHours ?? "").trim();
  const openingHours = rawHours ? cleanOpeningHours(rawHours) : "";
  if (!name || name.length > REPAIR_NAME_MAX || address.length > REPAIR_ADDRESS_MAX) return null;
  if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return null;
  if (openingHours === null) return null;
  return {
    operatorId: input.operatorId ? String(input.operatorId) : null,
    name,
    address,
    lat,
    lng,
    phone: String(input?.phone ?? "").trim().slice(0, 40) || null,
    openingHours,
    isActive: input.isActive !== false,
  };
}
