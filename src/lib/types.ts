export type VehicleType = "scooter" | "tricycle" | "ebike" | "moped";
export type StationKind = "charging" | "swap" | "both";
export type UserRole = "rider" | "operator" | "fleet_manager" | "admin";
export type ReservationType = "battery" | "slot";
export type ReservationStatus = "active" | "completed" | "cancelled" | "expired";
export type ChargingPointStatus = "free" | "reserved" | "charging" | "done" | "fault";

export const VEHICLE_TYPES: VehicleType[] = ["scooter", "tricycle", "ebike", "moped"];

export interface Station {
  id: string;
  operatorId: string;
  operatorName: string;
  isOwn: boolean;
  name: string;
  address: string;
  lat: number;
  lng: number;
  kind: StationKind;
  vehicleTypes: VehicleType[];
  chargingSlots: number;
  batteryCapacity: number;
  openingHours: string;
  phone: string | null;
}

export interface StationStatus {
  stationId: string;
  isOpen: boolean;
  freeSlots: number;
  fullBatteries: number;
  updatedAt: string;
}

/** One outlet. `deviceId` is set when a connected socket (e.g. LoRa) reports its status. */
export interface ChargingPoint {
  id: string;
  stationId: string;
  label: string;
  status: ChargingPointStatus;
  deviceId: string | null;
  outlet: number | null;
  powerWatts: number | null;
  lastSeenAt: string | null;
}

/** A station merged with its live status and the reservations currently holding capacity. */
export interface StationView extends Station {
  status: StationStatus;
  reservedSlots: number;
  reservedBatteries: number;
  /** Individual outlets, when the station has any registered. */
  chargingPoints?: ChargingPoint[];
}

export interface Reservation {
  id: string;
  userId: string;
  stationId: string;
  type: ReservationType;
  status: ReservationStatus;
  createdAt: string;
  expiresAt: string;
}

export interface Profile {
  id: string;
  phone: string;
  fullName: string | null;
  role: UserRole;
}

export interface StationInput {
  operatorId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  kind: StationKind;
  vehicleTypes: VehicleType[];
  chargingSlots: number;
  batteryCapacity: number;
  openingHours: string;
  phone: string | null;
}

export interface Operator {
  id: string;
  name: string;
  isOwn: boolean;
}

/** How long a reservation holds a battery or slot before it lapses. */
export const RESERVATION_MINUTES = 20;
