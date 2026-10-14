import type { StationBatteryType } from "./battery-types";
import type { StationEvCharger } from "./ev-chargers";
import type { ParcelDepotInput } from "./parcels";
import type { Amenity, StationRating } from "./station-extras";

export type VehicleType = "scooter" | "tricycle" | "ebike" | "moped";
/** Battery services of a station; "parcel" = neither swap nor charging, a parcel point only. See station-points.ts. */
export type StationKind = "charging" | "swap" | "both" | "parcel";
export type UserRole = "customer" | "operator" | "fleet_manager" | "admin";
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
  /** Photo URLs set in the backoffice; the first is the cover. Missing on data saved before photos existed. */
  photos?: string[];
  /** Places to rest and services at the station (see station-extras.ts). */
  amenities?: Amenity[];
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
  /** Parcel counter and lockers, when the station has an active parcel depot (and the parcel module is on). */
  parcelPoint?: ParcelPoint | null;
  /** Battery types the swap point swaps (active types only in the app). */
  batteryTypes?: StationBatteryType[];
  /** Average stars and number of customer reviews. */
  rating?: StationRating;
  /** Active electric car chargers assigned to the station (see ev-chargers.ts). */
  evChargers?: StationEvCharger[];
}

export interface ParcelPoint {
  /** Staff take in and hand out parcels at a counter. */
  counter: boolean;
  /** Locker compartments; 0 = none. */
  lockers: number;
}

export interface Reservation {
  id: string;
  userId: string;
  stationId: string;
  type: ReservationType;
  status: ReservationStatus;
  createdAt: string;
  expiresAt: string;
  /** 4-digit code the customer shows at the station. Only present on the customer's own reservations. */
  pickupCode?: string;
  /** Set when the reservation was cancelled for the customer, e.g. "station_closed". */
  cancelReason?: string | null;
}

export interface Profile {
  id: string;
  /** Togolese number (+228…); null for accounts made with an e-mail address only. */
  phone: string | null;
  /** Lower-case e-mail address; null for accounts made with a phone number only. */
  email: string | null;
  fullName: string | null;
  role: UserRole;
  /** Set when the user applied as a driver (src/lib/drivers.ts). */
  driverStatus?: "pending" | "active" | "rejected" | "suspended" | null;
  /** Operators this person runs (operator accounts, see operators.ts). */
  ownerOf?: string[];
}

export interface StationInput {
  operatorId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  kind: StationKind;
  vehicleTypes: VehicleType[];
  /** Ignored by the server: a station's charging places are its connected outlets. */
  chargingSlots: number;
  batteryCapacity: number;
  openingHours: string;
  phone: string | null;
  /** Parcel counter and lockers, saved with the station. Left out: unchanged. */
  parcelDepot?: ParcelDepotInput;
  /** Ids of the battery types the swap point swaps, saved with the station. Left out: unchanged. */
  batteryTypeIds?: string[];
  /** Photo URLs (first = cover). Left out: unchanged. */
  photos?: string[];
  /** Left out: unchanged. */
  amenities?: Amenity[];
}

export interface Operator {
  id: string;
  name: string;
  isOwn: boolean;
}

/** How long a reservation holds a battery or slot before it lapses. */
export const RESERVATION_MINUTES = 20;
/** Status reports older than this are shown as uncertain. */
export const STALE_STATUS_HOURS = 2;
/** Unused (cancelled or expired) reservations a customer may have in 24 hours. Mirrors reserve(). */
export const MAX_UNUSED_RESERVATIONS_PER_DAY = 3;
/** Pause at a station after an unused reservation there. Mirrors reserve(). */
export const STATION_COOLDOWN_MINUTES = 60;
