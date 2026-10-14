import type { BatteryType } from "../battery-types";
import type { EvCharger } from "../ev-chargers";
import type { ChargingPoint, Operator, Station, StationStatus } from "../types";

// Example stations in Lomé (approximate positions).
export const DEMO_OPERATORS: Operator[] = [
  { id: "op-poinderecharge", name: "poinderecharge", isOwn: true },
  { id: "op-example", name: "Exemple Opérateur", isOwn: false },
];

export const DEMO_STATIONS: Station[] = [
  {
    id: "st-grand-marche",
    operatorId: "op-poinderecharge",
    operatorName: "poinderecharge",
    isOwn: true,
    name: "poinderecharge Grand Marché",
    address: "Boulevard du 13 Janvier",
    lat: 6.1262,
    lng: 1.2236,
    kind: "both",
    vehicleTypes: ["scooter", "ebike", "moped"],
    chargingSlots: 6,
    batteryCapacity: 12,
    openingHours: "00:00-24:00",
    phone: null,
  },
  {
    id: "st-tokoin",
    operatorId: "op-poinderecharge",
    operatorName: "poinderecharge",
    isOwn: true,
    name: "poinderecharge Tokoin",
    address: "Avenue de la Libération",
    lat: 6.1496,
    lng: 1.2187,
    kind: "swap",
    vehicleTypes: ["scooter", "moped", "tricycle"],
    chargingSlots: 0,
    batteryCapacity: 20,
    openingHours: "06:00-22:00",
    phone: null,
  },
  {
    id: "st-universite",
    operatorId: "op-poinderecharge",
    operatorName: "poinderecharge",
    isOwn: true,
    name: "poinderecharge Université",
    address: "Université de Lomé",
    lat: 6.1735,
    lng: 1.2115,
    kind: "charging",
    vehicleTypes: ["scooter", "ebike"],
    chargingSlots: 8,
    batteryCapacity: 0,
    openingHours: "07:00-20:00",
    phone: null,
  },
  {
    id: "st-be",
    operatorId: "op-poinderecharge",
    operatorName: "poinderecharge",
    isOwn: true,
    name: "poinderecharge Bè",
    address: "Bè Kpota",
    lat: 6.137,
    lng: 1.242,
    kind: "both",
    vehicleTypes: ["scooter", "tricycle", "moped"],
    chargingSlots: 4,
    batteryCapacity: 10,
    openingHours: "06:30-21:30",
    phone: null,
  },
  {
    id: "st-agoe",
    operatorId: "op-poinderecharge",
    operatorName: "poinderecharge",
    isOwn: true,
    name: "poinderecharge Agoè",
    address: "Agoè Assiyéyé",
    lat: 6.2245,
    lng: 1.208,
    kind: "swap",
    vehicleTypes: ["scooter", "moped", "tricycle"],
    chargingSlots: 0,
    batteryCapacity: 16,
    openingHours: "06:00-22:00",
    phone: null,
  },
  {
    id: "st-hedzranawoe",
    operatorId: "op-example",
    operatorName: "Exemple Opérateur",
    isOwn: false,
    name: "Exemple Hédzranawoé",
    address: "Hédzranawoé",
    lat: 6.1605,
    lng: 1.247,
    kind: "charging",
    vehicleTypes: ["scooter", "ebike"],
    chargingSlots: 4,
    batteryCapacity: 0,
    openingHours: "08:00-19:00",
    phone: null,
  },
  {
    id: "st-deckon",
    operatorId: "op-poinderecharge",
    operatorName: "poinderecharge",
    isOwn: true,
    name: "poinderecharge Déckon (prises connectées)",
    address: "Carrefour Déckon",
    lat: 6.1318,
    lng: 1.2296,
    kind: "charging",
    vehicleTypes: ["scooter", "ebike"],
    chargingSlots: 2,
    batteryCapacity: 0,
    openingHours: "24h/24",
    phone: null,
  },
  {
    id: "st-colis-adewui",
    operatorId: "op-poinderecharge",
    operatorName: "poinderecharge",
    isOwn: true,
    name: "poinderecharge Adewui (casiers colis)",
    address: "Marché d'Adewui",
    lat: 6.1452,
    lng: 1.2141,
    kind: "parcel",
    vehicleTypes: [],
    chargingSlots: 0,
    batteryCapacity: 0,
    openingHours: "06:00-22:00",
    phone: null,
  },
];

/** One LoRa dual-outlet socket at Déckon. The demo backend stamps them as just seen. */
export const DEMO_CHARGING_POINTS: ChargingPoint[] = [
  {
    id: "cp-deckon-1",
    stationId: "st-deckon",
    label: "F0A1-1",
    status: "charging",
    deviceId: "A84041000181F0A1",
    outlet: 1,
    powerWatts: 180,
    lastSeenAt: null,
  },
  {
    id: "cp-deckon-2",
    stationId: "st-deckon",
    label: "F0A1-2",
    status: "free",
    deviceId: "A84041000181F0A1",
    outlet: 2,
    powerWatts: 0,
    lastSeenAt: null,
  },
];

/**
 * Demo sockets at the other charging stations, one outlet per charging place: the first
 * `free` outlets are free, the rest charging. A station's charging places are its sockets.
 */
export function demoSocketPoints(stationId: string, deviceId: string, outlets: number, free: number): ChargingPoint[] {
  return Array.from({ length: outlets }, (_, i) => ({
    id: `cp-${deviceId}-${i + 1}`,
    stationId,
    label: `${deviceId.slice(-4)}-${i + 1}`,
    status: i < free ? ("free" as const) : ("charging" as const),
    deviceId,
    outlet: i + 1,
    powerWatts: i < free ? 0 : 180,
    lastSeenAt: null,
  }));
}

export function initialDemoStatus(now: string): StationStatus[] {
  const levels: Record<string, [number, number]> = {
    "st-grand-marche": [3, 7],
    "st-tokoin": [0, 2],
    "st-universite": [5, 0],
    "st-be": [0, 0],
    "st-agoe": [0, 11],
    "st-hedzranawoe": [1, 0],
    "st-deckon": [1, 0],
  };
  return DEMO_STATIONS.map((s) => ({
    stationId: s.id,
    isOpen: s.id !== "st-be",
    freeSlots: levels[s.id]?.[0] ?? s.chargingSlots,
    fullBatteries: levels[s.id]?.[1] ?? s.batteryCapacity,
    updatedAt: now,
  }));
}

/** Example swap batteries of two motorbike brands. */
export const DEMO_BATTERY_TYPES: BatteryType[] = [
  { id: "bt-spiro-72", brand: "Spiro", name: "72 V", isActive: true },
  { id: "bt-ovt-60", brand: "Omnivoltaic", name: "60 V", isActive: true },
  { id: "bt-ovt-72", brand: "Omnivoltaic", name: "72 V", isActive: true },
];

/** Battery types each demo swap station swaps. */
export const DEMO_STATION_BATTERY_TYPES: Record<string, string[]> = {
  "st-grand-marche": ["bt-spiro-72", "bt-ovt-60", "bt-ovt-72"],
  "st-tokoin": ["bt-spiro-72"],
  "st-be": ["bt-ovt-60"],
  "st-agoe": ["bt-ovt-60", "bt-ovt-72"],
};

/** Electric car chargers: two assigned to stations, one waiting to be assigned. */
export const DEMO_EV_CHARGERS: EvCharger[] = [
  { id: "ev-grand-marche-1", name: "Borne VE 1", connector: "type2", powerKw: 22, stationId: "st-grand-marche", isActive: true },
  { id: "ev-agoe-1", name: "Borne rapide Agoè", connector: "ccs2", powerKw: 60, stationId: "st-agoe", isActive: true },
  { id: "ev-stock-1", name: "Borne VE 3", connector: "type2", powerKw: 7.4, stationId: null, isActive: true },
];
