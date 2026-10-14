import { countHolding, isHolding, offersCharging, offersSwap, withinOpeningHours } from "../availability";
import {
  MAX_UNUSED_RESERVATIONS_PER_DAY,
  RESERVATION_MINUTES,
  STALE_STATUS_HOURS,
  STATION_COOLDOWN_MINUTES,
  type Operator,
  type Profile,
  type Reservation,
  type ReservationType,
  type Station,
  type StationInput,
  type StationStatus,
  type StationView,
  type UserRole,
  type VehicleType,
} from "../types";
import { BackendError, type Backend, type CodeChannel, type StatusPatch } from "./backend";
import {
  DEMO_CHARGING_POINTS,
  DEMO_OPERATORS,
  DEMO_STATIONS,
  demoSocketPoints,
  initialDemoStatus,
  DEMO_BATTERY_TYPES,
  DEMO_STATION_BATTERY_TYPES,
  DEMO_STATION_EXTRAS,
  demoReviews,
  type DemoReview,
} from "./demo-data";
import { cleanAmenities, cleanPhotos, cleanReview, ratingOf, shortName, type ReviewInput, type StationReview } from "../station-extras";
import { depotPoints, hasAnyPoint, kindFor } from "../station-points";
import { validBatteryType, type BatteryType, type BatteryTypeInput } from "../battery-types";
import { DEMO_STAFF, demoHistory, demoUsers } from "../admin/demo-seed";
import {
  ADMIN_HISTORY_DAYS,
  type AdminSnapshot,
  type AdminUser,
  type AuditEntry,
  type AuditFilter,
  type StaffAssignment,
} from "../admin/types";
import { validPinFormat, weakPin } from "../pin";
import type { Features } from "../features";
import { MAX_PROMO_IMAGE_BYTES, pickPromotion, type Promotion, type PromotionInput } from "../promo";
import {
  DEFAULT_PARCEL_SIZES,
  newTrackingNo,
  PARCEL_CODE_LOCK_MINUTES,
  PARCEL_MAX_CODE_FAILURES,
  PARCEL_PICKUP_DAYS,
  parseHandoverInput,
  parsePickupInput,
  sizeFor,
  type AdminParcels,
  type Parcel,
  type ParcelDepot,
  type ParcelDepotInput,
  type ParcelInput,
  type ParcelMeasures,
  type ParcelSizeTier,
} from "../parcels";
import {
  BOOKING_DAYS,
  keyPrefix,
  newApiKey,
  newWebhookSecret,
  validWebhookUrl,
  type AdminPartners,
  type Partner,
  type PartnerInput,
  type PartnerKey,
  type StationBooking,
} from "../partners";
import { normalizeTogoPhone } from "../phone";
import {
  balanceOf,
  BUSY_JOB_STATUSES,
  DEFAULT_DRIVER_SETTINGS,
  driverEarning,
  fareFor,
  FLEET_VEHICLE_TYPES,
  inServiceArea,
  nearestStation,
  newDriverCode,
  parseDriverBadge,
  pickDriver,
  validPoint,
  validSettings,
  vehicleFits,
  vehicleSeats,
  MAX_PASSENGERS,
  type AdminDrivers,
  type DeliveryJob,
  type Driver,
  type DriverApplication,
  type DriverAtStation,
  type DriverDecision,
  type DriverDocument,
  type DriverHome,
  type DriverSettings,
  type FleetVehicle,
  type FleetVehicleInput,
  type HomePoint,
  type JobStatus,
  type LedgerEntry,
  type PickupBooking,
  type RideBooking,
  type StationDrivers,
} from "../drivers";
import { distanceMeters, type LatLng } from "../geo";
import { parseContact } from "../contact";
import { fleetRange, jobForManager, managesFleet, type FleetStats, type FleetView } from "../fleet";
import {
  checkLimits,
  DEFAULT_FEE_SETTINGS,
  newTrxId,
  parseAmount,
  periodStarts,
  personLabel,
  quoteFee,
  receivePayload,
  TOPUP_MAX_XOF,
  TOPUP_MIN_XOF,
  TOPUP_NETWORK_LABEL,
  validFeeSetting,
  WALLET_REMARK_MAX,
  type AdminWallet,
  type AdminWalletTransaction,
  type SendMoneyInput,
  type TopupInput,
  type WalletAdjustInput,
  type WalletFeeSetting,
  type WalletRecipient,
  type WalletTopup,
  type WalletTransaction,
  type WalletView,
} from "../wallet";
import {
  DEFAULT_FACTORS,
  dayStart,
  levelFor,
  MAX_EARNINGS_PER_DAY,
  nextLevel,
  pointsFor,
  REDEEM_CODE_MINUTES,
  rewardAvailable,
  treesFor,
  tripGrams,
  validFactors,
  validRewardInput,
  type AdminGreenpoint,
  type GreenpointEntry,
  type GreenpointFactors,
  type GreenpointReceipt,
  type GreenpointRedemption,
  type GreenpointReward,
  type GreenpointRewardInput,
  type GreenpointView,
} from "../greenpoint";
import { OPERATOR_NAME_MAX, type AdminOperator, type OperatorInput, type OwnerStationInput, type OwnerView } from "../operators";
import { canSwitch, normalizeDeviceId, outletLabel, validDeviceInput, type Device, type DeviceInput } from "../iot/devices";

const STORAGE_KEY = "poinderecharge-demo-v3";
/** Every demo registration accepts this SMS code. */
export const DEMO_CODE = "123456";
/**
 * True when this build was made by Cloudflare (see next.config.ts) but set to the
 * demo backend. Visitors then see a clear notice and can only try the customer view.
 */
export const HOSTED_DEMO = process.env.NEXT_PUBLIC_HOSTED_BUILD === "1" && process.env.NEXT_PUBLIC_BACKEND === "demo";

function pickupCode(): string {
  return String(Math.floor(Math.random() * 10_000)).padStart(4, "0");
}

interface DemoState {
  operators: Operator[];
  stations: Station[];
  statuses: StationStatus[];
  reservations: Reservation[];
  profile: Profile | null;
  // Backoffice (optional: older saved demo states lack them).
  users?: AdminUser[];
  staff?: StaffAssignment[];
  inactive?: string[];
  audit?: AuditEntry[];
  promotions?: Promotion[];
  devices?: Device[];
  /** Parcel depot; parcels keep their pickup code here (demo only). */
  parcels?: Parcel[];
  parcelDepots?: ParcelDepot[];
  batteryTypes?: BatteryType[];
  /** Battery types each station swaps, by station id. */
  stationBatteryTypes?: Record<string, string[]>;
  /** Full batteries per battery type, by station id then type id (default: the station's total spread over its types). */
  typeBatteries?: Record<string, Record<string, number>>;
  parcelSizes?: ParcelSizeTier[];
  parcelCodeFailures?: { stationId: string; at: string }[];
  /** Drivers (see src/lib/drivers.ts). */
  drivers?: DemoDriver[];
  fleet?: FleetVehicle[];
  jobs?: DemoJob[];
  driverQueue?: { driverId: string; stationId: string; since: string }[];
  ledger?: DemoLedger[];
  driverSettings?: DriverSettings;
  /** Driver documents and door photos as data URLs (demo only). */
  driverFiles?: Record<string, string>;
  /** Partner API: partners and bookings waiting for drop-off (demo only, no API calls). */
  partners?: Partner[];
  bookings?: (StationBooking & { partnerId: string; fromStationId: string })[];
  /** Wallet (demo only: switched on, everyone starts with DEMO_WALLET_START francs). */
  wallet?: DemoWallet;
  /** greenpoint (demo only). */
  greenpoint?: DemoGreenpoint;
  /** Fleet managers: which manager each linked driver belongs to (missing = nobody). */
  fleetLinks?: { driverId: string; managerId: string }[];
  /** Operator accounts: who runs which operator (missing = nobody). */
  operatorOwners?: { operatorId: string; userId: string }[];
  /** Contact phones of operators, set in the backoffice. */
  operatorPhones?: Record<string, string | null>;
  /** Parcel module switch of the backoffice (missing = on). */
  parcelsEnabled?: boolean;
  /** Demo PINs by phone number or e-mail address (stored in clear: demo only). */
  pins?: Record<string, string>;
  /** Customer reviews (missing = the example reviews). */
  reviews?: DemoReview[];
}

interface DemoWallet {
  enabled: boolean;
  settings: WalletFeeSetting[];
  balances: Record<string, number>;
  frozen: string[];
  /** Ledger, newest first, with the idempotency key of each payment. */
  transactions: (AdminWalletTransaction & { key?: string })[];
  /** Simulated Flooz/T-Money top-ups; confirmed on the first status check. */
  topups?: (WalletTopup & { userId: string })[];
}

/** Starting balance of every demo wallet, so sending money can be tried right away. */
export const DEMO_WALLET_START = 25_000;

function demoTopupView(t: WalletTopup): WalletTopup {
  return { id: t.id, amountXof: t.amountXof, network: t.network, status: t.status, failureReason: t.failureReason, createdAt: t.createdAt, paidAt: t.paidAt };
}

interface DemoGreenpoint {
  factors: GreenpointFactors;
  rewards: GreenpointReward[];
  /** Ledger, newest first. */
  ledger: (GreenpointEntry & { userId: string; reservationId: string | null; jobId?: string })[];
  redemptions: (GreenpointRedemption & { userId: string; rewardId: string; status: "open" | "used" | "cancelled" })[];
  vehicles: Record<string, VehicleType>;
}

/** The main reward, as in migration 0015. */
const DEMO_REWARDS: GreenpointReward[] = [
  {
    id: "free-swap",
    title: "Échange de batterie offert",
    description: "Un échange de batterie gratuit dans une station poinderecharge.",
    costPoints: 150,
    provider: "network",
    partnerName: null,
    stock: null,
    validUntil: null,
    isActive: true,
  },
];

function freshGreenpoint(): DemoGreenpoint {
  return { factors: DEFAULT_FACTORS, rewards: DEMO_REWARDS, ledger: [], redemptions: [], vehicles: {} };
}

function freshWallet(): DemoWallet {
  return { enabled: true, settings: DEFAULT_FEE_SETTINGS, balances: {}, frozen: [], transactions: [] };
}

function freshState(): DemoState {
  const now = new Date();
  return {
    operators: DEMO_OPERATORS,
    stations: DEMO_STATIONS,
    statuses: initialDemoStatus(now.toISOString()),
    reservations: demoHistory(now),
    profile: null,
    users: demoUsers(now),
    staff: DEMO_STAFF,
    inactive: [],
    audit: [],
    promotions: [demoPromotion(now)],
  };
}

/** The connected socket of the "Déckon" station, as a device. */
function seedDevices(): Device[] {
  const [first] = DEMO_CHARGING_POINTS;
  return [
    {
      externalId: first.deviceId!,
      stationId: first.stationId,
      vendor: "LoRa",
      model: "2 prises",
      link: "lorawan",
      outlets: DEMO_CHARGING_POINTS.length,
      lastSeenAt: null,
      createdAt: "2026-10-01T08:00:00.000Z",
      points: DEMO_CHARGING_POINTS,
    },
    ...(
      [
        ["st-grand-marche", "DEMO-GM01", 6, 3],
        ["st-universite", "DEMO-UL01", 8, 5],
        ["st-be", "DEMO-BE01", 4, 0],
        ["st-hedzranawoe", "DEMO-HZ01", 4, 1],
      ] as const
    ).map(([stationId, externalId, outlets, free]) => ({
      externalId,
      stationId,
      vendor: "Xingke",
      model: `${outlets} prises`,
      link: "vendor_cloud" as const,
      outlets,
      lastSeenAt: null,
      createdAt: "2026-10-01T08:00:00.000Z",
      points: demoSocketPoints(stationId, externalId, outlets, free),
    })),
  ];
}

interface DemoDriver {
  userId: string;
  status: Driver["status"];
  fullName: string;
  phone: string | null;
  idNumber: string;
  licenseNumber: string;
  wantedType: Driver["wantedType"];
  documents: Driver["documents"];
  vehicleId: string | null;
  code: string;
  createdAt: string;
  reviewedAt: string | null;
}

/** A trip as the demo keeps it: the view (driver filled in on reading) plus bookkeeping. */
interface DemoJob extends Omit<DeliveryJob, "driver" | "trackingNo"> {
  customerUserId: string | null;
  driverId: string | null;
  driverStationId: string | null;
  declined: string[];
}

interface DemoLedger extends LedgerEntry {
  driverId: string;
}

/** Three of our vehicles, so drivers can be approved right away. */
function seedFleet(): FleetVehicle[] {
  return [
    { id: "veh-moto", type: "moto", plate: "TG 1001 AA", isActive: true },
    { id: "veh-tricycle", type: "tricycle", plate: "TG 2002 BB", isActive: true },
    { id: "veh-cargo", type: "cargo_tricycle", plate: "TG 3003 CC", isActive: true },
  ];
}

/** Depots at four own stations, so parcels can be tried right away. */
function seedDepots(): ParcelDepot[] {
  return ["st-grand-marche", "st-tokoin", "st-universite", "st-be"].map((stationId) => ({
    stationId,
    isActive: true,
    note: "au comptoir",
    counter: true,
    lockers: 0,
  })).concat({ stationId: "st-colis-adewui", isActive: true, note: "à l'entrée du marché", counter: false, lockers: 24 });
}

/** One partner shop and one booked parcel, so the drop-off at the station can be tried. */
function seedPartners(): Partner[] {
  return [
    {
      id: "partner-demo",
      name: "Boutique Démo",
      contactEmail: "contact@boutique-demo.tg",
      contactPhone: "+22890000099",
      isActive: true,
      webhookUrl: null,
      webhookSecret: "whsec_demo",
      sharePickupCode: false,
      createdAt: "2026-10-01T08:00:00.000Z",
      keys: [],
      parcels30d: 0,
      amount30d: 0,
      openBookings: 1,
    },
  ];
}

function seedBookings(now: Date): NonNullable<DemoState["bookings"]> {
  return [
    {
      id: "booking-demo",
      partnerId: "partner-demo",
      partnerName: "Boutique Démo",
      reference: "CMD-1042",
      trackingNo: "GP-DEM42X",
      fromStationId: "st-grand-marche",
      toStationId: "st-tokoin",
      sender: { name: "Boutique Démo", phone: "+22890000099" },
      recipient: { name: "Afi", phone: "+22891234567" },
      content: "Chaussures",
      declaredValue: 15000,
      measures: { lengthCm: 35, widthCm: 25, heightCm: 15, weightKg: 1.5 },
      size: "M",
      priceFcfa: 500,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + BOOKING_DAYS * 86_400_000).toISOString(),
    },
  ];
}

/** An example ad, switched off, so testers can try the popup from the backoffice. */
function demoPromotion(now: Date): Promotion {
  const at = now.toISOString();
  return {
    id: "promo-demo",
    title: "1ère recharge offerte",
    body: "Réservez votre première batterie avec poinderecharge : la recharge est offerte dans toutes nos stations à Lomé.",
    imageUrl: null,
    linkUrl: null,
    linkLabel: null,
    isActive: false,
    startsAt: null,
    endsAt: null,
    createdAt: at,
    updatedAt: at,
  };
}

const EMPTY_PROMOTION: Promotion = {
  id: "",
  title: "",
  body: "",
  imageUrl: null,
  linkUrl: null,
  linkLabel: null,
  isActive: false,
  startsAt: null,
  endsAt: null,
  createdAt: "",
  updatedAt: "",
};

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new BackendError("unknown", "image unreadable"));
    reader.readAsDataURL(file);
  });
}

type AuditInput = Pick<AuditEntry, "table" | "action" | "rowId" | "changes"> &
  Partial<Pick<AuditEntry, "stationId" | "userId">>;

/** Operators this demo account runs. */
function ownedOperators(state: DemoState, userId: string): string[] {
  return (state.operatorOwners ?? []).filter((x) => x.userId === userId).map((x) => x.operatorId);
}

/** Whoever gets station work becomes "operator" (customers only; admins stay admins). */
function promoted(state: DemoState, userId: string) {
  const users = state.users ?? demoUsers(new Date());
  // One role per person: a fleet manager would lose their drivers.
  if (users.find((u) => u.id === userId)?.role === "fleet_manager") throw new BackendError("has_other_role");
  return users.map((u) => (u.id === userId && u.role === "customer" ? { ...u, role: "operator" as const } : u));
}

/** Whoever has no station and runs no operator any more goes back to customer. */
function demotedIfIdle(state: DemoState, userId: string) {
  const busy =
    (state.staff ?? DEMO_STAFF).some((a) => a.userId === userId) || (state.operatorOwners ?? []).some((x) => x.userId === userId);
  return (state.users ?? demoUsers(new Date())).map((u) =>
    u.id === userId && u.role === "operator" && !busy ? { ...u, role: "customer" as const } : u,
  );
}

/** Appends an activity log entry, like the Worker does on Cloudflare. */
function withAudit(state: DemoState, entry: AuditInput): DemoState {
  const audit = state.audit ?? [];
  const row: AuditEntry = {
    id: (audit[0]?.id ?? 0) + 1,
    at: new Date().toISOString(),
    actorId: state.profile?.id ?? null,
    stationId: null,
    userId: null,
    ...entry,
  };
  return { ...state, audit: [row, ...audit].slice(0, 500) };
}

/** `{column: [old, new]}` for the fields that changed. */
function diff<T extends object>(before: T, after: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (key === "updatedAt") continue;
    // Column names as in the database (freeSlots -> free_slots), so the log reads the same.
    const column = (key as string).replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) out[column] = [before[key], after[key]];
  }
  return out;
}

/**
 * Runs the whole app inside the browser with example data, so it can be tried
 * without the Cloudflare API. Changes sync live between tabs of the same browser
 * (open the operator view in one tab and the map in another).
 */
export class DemoBackend implements Backend {
  readonly mode = "demo" as const;
  private listeners = new Set<() => void>();
  private memory: DemoState | null = null;

  private load(): DemoState {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as DemoState;
    } catch {
      // Storage blocked (private mode): fall back to memory.
    }
    this.memory ??= freshState();
    return this.memory;
  }

  private save(state: DemoState) {
    this.memory = state;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore: memory copy is used instead.
    }
    this.listeners.forEach((fn) => fn());
  }

  private views(state: DemoState, stations: Station[]): StationView[] {
    const seen = new Date().toISOString();
    const reviews = this.reviews(state);
    return stations.map((s) => {
      let status = state.statuses.find((st) => st.stationId === s.id)!;
      // Pretend staff report regularly, so an old demo session does not turn grey.
      if (Date.now() - new Date(status.updatedAt).getTime() > STALE_STATUS_HOURS * 3_600_000) {
        status = { ...status, updatedAt: new Date().toISOString() };
      }
      const held = countHolding(state.reservations, s.id);
      // Demo sockets pretend to report all the time.
      const chargingPoints = (state.devices ?? seedDevices())
        .flatMap((d) => d.points)
        .filter((p) => p.stationId === s.id)
        .map((p) => ({ ...p, lastSeenAt: seen }));
      // Charging places are the connected outlets.
      const chargingSlots = chargingPoints.filter((p) => p.deviceId).length;
      const depot = (state.parcelDepots ?? seedDepots()).find((d) => d.stationId === s.id);
      const parcelPoint = depot?.isActive ? { counter: depot.counter ?? true, lockers: depot.lockers } : null;
      const types = state.batteryTypes ?? DEMO_BATTERY_TYPES;
      const swapped = (state.stationBatteryTypes ?? DEMO_STATION_BATTERY_TYPES)[s.id] ?? [];
      const counts = typeCounts(state, s.id, status.fullBatteries);
      const batteryTypes = types
        .filter((t) => swapped.includes(t.id))
        .sort((a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name))
        .map((t) => ({ ...t, fullBatteries: counts[t.id] ?? 0 }));
      const extras = DEMO_STATION_EXTRAS[s.id];
      return {
        ...s,
        photos: s.photos ?? extras?.photos ?? [],
        amenities: s.amenities ?? extras?.amenities ?? [],
        rating: ratingOf(reviews.filter((r) => r.stationId === s.id)),
        chargingSlots,
        status: { ...status, freeSlots: Math.min(status.freeSlots, chargingSlots) },
        reservedSlots: held.slots,
        reservedBatteries: held.batteries,
        chargingPoints,
        parcelPoint,
        batteryTypes,
      };
    });
  }

  private requireProfile(state: DemoState): Profile {
    if (!state.profile) throw new BackendError("not_authenticated");
    return state.profile;
  }

  async listStations() {
    const state = this.load();
    const views = this.views(state, this.activeStations(state)).map((s) => ({
      ...s,
      batteryTypes: (s.batteryTypes ?? []).filter((t) => t.isActive),
    }));
    if (state.parcelsEnabled !== false) return views;
    return views.filter((s) => s.kind !== "parcel").map((s) => ({ ...s, parcelPoint: null }));
  }

  private activeStations(state: DemoState): Station[] {
    const inactive = new Set(state.inactive ?? []);
    return state.stations.filter((s) => !inactive.has(s.id));
  }

  subscribe(onChange: () => void) {
    this.listeners.add(onChange);
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) onChange();
    };
    window.addEventListener("storage", onStorage);
    // Re-render periodically so expired reservations release their capacity.
    const timer = window.setInterval(onChange, 30_000);
    return () => {
      this.listeners.delete(onChange);
      window.removeEventListener("storage", onStorage);
      window.clearInterval(timer);
    };
  }

  /** The profile with its driver status, as the Worker sends it. */
  private profileOf(state: DemoState): Profile | null {
    if (!state.profile) return null;
    const driver = (state.drivers ?? []).find((d) => d.userId === state.profile!.id);
    return { ...state.profile, driverStatus: driver?.status ?? null };
  }

  async getProfile() {
    return this.profileOf(this.load());
  }

  onAuthChange(callback: (profile: Profile | null) => void) {
    return this.subscribe(() => callback(this.profileOf(this.load())));
  }

  async sendCode() {
    // Nothing is sent in demo mode; the code is always DEMO_CODE.
  }

  async register(contact: string, code: string, pin: string, demoRole: UserRole = "customer") {
    if (!validPinFormat(pin)) throw new BackendError("bad_pin");
    if (weakPin(pin)) throw new BackendError("weak_pin");
    if (code.trim() !== DEMO_CODE) throw new BackendError("invalid_code");
    const state = this.load();
    this.save({ ...state, pins: { ...state.pins, [contact]: pin } });
    return this.signInAs(contact, demoRole);
  }

  async signIn(contact: string, pin: string, demoRole: UserRole = "customer") {
    if (!validPinFormat(pin) || this.load().pins?.[contact] !== pin) throw new BackendError("invalid_pin");
    return this.signInAs(contact, demoRole);
  }

  private signInAs(contact: string, demoRole: UserRole) {
    if (HOSTED_DEMO && demoRole !== "customer") throw new BackendError("forbidden");
    const state = this.load();
    const users = state.users ?? demoUsers(new Date());
    const known = users.find((u) => u.id === `demo-${demoRole}`);
    const isEmail = contact.includes("@");
    const profile: Profile = {
      id: `demo-${demoRole}`,
      phone: isEmail ? null : contact,
      email: isEmail ? contact : null,
      fullName: known?.fullName ?? null,
      role: demoRole,
      ownerOf: ownedOperators(state, `demo-${demoRole}`),
    };
    const signedIn: AdminUser = {
      ...profile,
      createdAt: known?.createdAt ?? new Date().toISOString(),
      lastSignInAt: new Date().toISOString(),
    };
    this.save({ ...state, profile, users: [signedIn, ...users.filter((u) => u.id !== profile.id)] });
    return profile;
  }

  async signOut() {
    this.save({ ...this.load(), profile: null });
  }

  async sendContactCode() {
    this.requireProfile(this.load());
  }

  async addContact(contact: string, code: string) {
    const state = this.load();
    const profile = this.requireProfile(state);
    if (code.trim() !== DEMO_CODE) throw new BackendError("invalid_code");
    const field = contact.includes("@") ? "email" : "phone";
    const updated: Profile = { ...profile, [field]: contact };
    // The same PIN works with every contact of the account.
    const pin = state.pins?.[profile.phone ?? ""] ?? state.pins?.[profile.email ?? ""];
    this.save({
      ...state,
      profile: updated,
      pins: pin ? { ...state.pins, [contact]: pin } : state.pins,
      users: (state.users ?? []).map((u) => (u.id === profile.id ? { ...u, [field]: contact } : u)),
    });
    return updated;
  }

  async sendDeleteCode(channel: CodeChannel) {
    const profile = this.requireProfile(this.load());
    if (!(channel === "email" ? profile.email : profile.phone)) throw new BackendError("unknown");
  }

  async deleteAccount(channel: CodeChannel, code: string) {
    const state = this.load();
    const profile = this.requireProfile(state);
    if (!(channel === "email" ? profile.email : profile.phone)) throw new BackendError("unknown");
    if (code.trim() !== DEMO_CODE) throw new BackendError("invalid_code");
    const pins = { ...state.pins };
    if (profile.phone) delete pins[profile.phone];
    if (profile.email) delete pins[profile.email];
    this.save({
      ...state,
      profile: null,
      pins,
      users: (state.users ?? []).filter((u) => u.id !== profile.id),
      reservations: state.reservations.filter((r) => r.userId !== profile.id),
      reviews: this.reviews(state).filter((r) => r.userId !== profile.id),
    });
  }

  async myReservations() {
    const state = this.load();
    if (!state.profile) return [];
    const id = state.profile.id;
    return state.reservations
      .filter((r) => r.userId === id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async reserve(stationId: string, type: ReservationType) {
    const state = this.load();
    const profile = this.requireProfile(state);
    const now = new Date();
    if (state.reservations.some((r) => r.userId === profile.id && isHolding(r, now))) {
      throw new BackendError("already_reserved");
    }
    // Same rules as reserve() in SQL: limit unused reservations, pause after one at a station.
    const unused = state.reservations.filter(
      (r) =>
        r.userId === profile.id &&
        !r.cancelReason &&
        (r.status === "cancelled" || (r.status !== "completed" && !isHolding(r, now))) &&
        now.getTime() - new Date(r.createdAt).getTime() < 24 * 3_600_000,
    );
    if (unused.length >= MAX_UNUSED_RESERVATIONS_PER_DAY) throw new BackendError("daily_limit");
    if (
      unused.some(
        (r) =>
          r.stationId === stationId &&
          now.getTime() - new Date(r.createdAt).getTime() < STATION_COOLDOWN_MINUTES * 60_000,
      )
    ) {
      throw new BackendError("cooldown");
    }
    const station = state.stations.find((s) => s.id === stationId);
    const status = state.statuses.find((s) => s.stationId === stationId);
    if (!station || !status) throw new BackendError("station_not_found");
    if (!status.isOpen || !withinOpeningHours(station.openingHours, now)) throw new BackendError("station_closed");
    if ((type === "slot" && !offersCharging(station.kind)) || (type === "battery" && !offersSwap(station.kind))) {
      throw new BackendError("service_not_offered");
    }
    const held = countHolding(state.reservations, stationId);
    const left = type === "slot" ? status.freeSlots - held.slots : status.fullBatteries - held.batteries;
    if (left <= 0) throw new BackendError("none_available");

    const reservation: Reservation = {
      id: crypto.randomUUID(),
      userId: profile.id,
      stationId,
      type,
      status: "active",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + RESERVATION_MINUTES * 60_000).toISOString(),
      pickupCode: pickupCode(),
    };
    this.save(
      withAudit(
        { ...state, reservations: [...state.reservations, reservation] },
        { table: "reservations", action: "insert", rowId: reservation.id, stationId, userId: profile.id, changes: { type, status: "active", station_id: stationId } },
      ),
    );
    return reservation;
  }

  async cancelReservation(id: string) {
    this.setReservationStatus(id, "cancelled");
  }

  async staffStations() {
    const state = this.load();
    const profile = this.requireProfile(state);
    // Menu and rights follow the role, like on Cloudflare.
    if (profile.role !== "operator" && profile.role !== "admin") return [];
    const owned = new Set(profile.ownerOf ?? []);
    // Demo staff run every own station, operator accounts their operator's stations; admins see all.
    const active = this.activeStations(state);
    const stations =
      profile.role === "admin"
        ? active
        : active.filter((s) => owned.has(s.operatorId) || (profile.role === "operator" && s.isOwn));
    return this.views(state, stations);
  }

  async updateStatus(stationId: string, patch: StatusPatch) {
    const state = this.load();
    this.requireProfile(state);
    const closing = patch.isOpen === false && state.statuses.some((s) => s.stationId === stationId && s.isOpen);
    // Closing cancels the station's active reservations, like the trigger in SQL.
    const reservations = closing
      ? state.reservations.map((r) =>
          r.stationId === stationId && r.status === "active"
            ? { ...r, status: "cancelled" as const, cancelReason: "station_closed" }
            : r,
        )
      : state.reservations;
    const { typeBatteries: typePatch, ...statusPatch } = patch;
    let typeBatteries = state.typeBatteries;
    let typeTotal: number | undefined;
    if (typePatch) {
      // Counts per battery type: the station's total becomes their sum.
      const swapped = (state.stationBatteryTypes ?? DEMO_STATION_BATTERY_TYPES)[stationId] ?? [];
      if (Object.keys(typePatch).some((id) => !swapped.includes(id))) throw new BackendError("unknown", "battery type not swapped here");
      const current = state.statuses.find((s) => s.stationId === stationId)?.fullBatteries ?? 0;
      const counts = { ...typeCounts(state, stationId, current) };
      for (const [id, n] of Object.entries(typePatch)) counts[id] = Math.max(0, Math.floor(n));
      typeBatteries = { ...state.typeBatteries, [stationId]: counts };
      typeTotal = swapped.reduce((sum, id) => sum + (counts[id] ?? 0), 0);
    }
    const statuses = state.statuses.map((s) =>
      s.stationId === stationId
        ? {
            ...s,
            ...statusPatch,
            freeSlots: Math.max(0, patch.freeSlots ?? s.freeSlots),
            fullBatteries: Math.max(0, typeTotal ?? patch.fullBatteries ?? s.fullBatteries),
            updatedAt: new Date().toISOString(),
          }
        : s,
    );
    const before = state.statuses.find((s) => s.stationId === stationId);
    const after = statuses.find((s) => s.stationId === stationId);
    const changes = before && after ? diff(before, after) : {};
    this.save(
      Object.keys(changes).length
        ? withAudit({ ...state, statuses, reservations, typeBatteries }, { table: "station_status", action: "update", rowId: stationId, stationId, changes })
        : { ...state, statuses, reservations, typeBatteries },
    );
  }

  async stationReservations(stationId: string) {
    // Staff never see the pickup code; the customer shows it.
    return this.load()
      .reservations.filter((r) => r.stationId === stationId)
      .map((r) => ({ ...r, pickupCode: undefined }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async completeReservation(id: string, code: string) {
    const state = this.load();
    const profile = this.requireProfile(state);
    const r = state.reservations.find((x) => x.id === id);
    if (!r) throw new BackendError("forbidden");
    if (r.userId === profile.id) throw new BackendError("own_reservation");
    if (!isHolding(r)) throw new BackendError("reservation_not_active");
    if (code.trim() !== r.pickupCode) throw new BackendError("wrong_pickup_code");
    // Taking the battery or slot off the counter is part of completing (as in complete_reservation()).
    const statuses = state.statuses.map((s) =>
      s.stationId === r.stationId
        ? {
            ...s,
            fullBatteries: r.type === "battery" ? Math.max(0, s.fullBatteries - 1) : s.fullBatteries,
            freeSlots: r.type === "slot" ? Math.max(0, s.freeSlots - 1) : s.freeSlots,
            updatedAt: new Date().toISOString(),
          }
        : s,
    );
    this.save({
      ...this.earn(state, { userId: r.userId, type: r.type, stationId: r.stationId, reservationId: r.id }),
      statuses,
      reservations: state.reservations.map((x) => (x.id === id ? { ...x, status: "completed" as const } : x)),
    });
  }

  async listOperators() {
    return this.load().operators;
  }

  async saveStation(id: string | null, input: StationInput) {
    const state = this.load();
    const operator = state.operators.find((o) => o.id === input.operatorId);
    if (!operator) throw new BackendError("unknown", "operator not found");
    const { parcelDepot, batteryTypeIds, ...fields } = input;
    const allTypes = state.batteryTypes ?? DEMO_BATTERY_TYPES;
    if (batteryTypeIds?.some((t) => !allTypes.some((x) => x.id === t))) throw new BackendError("unknown", "unknown battery type");
    const existing = id ? (state.parcelDepots ?? seedDepots()).find((d) => d.stationId === id) : undefined;
    const depot = depotPoints(parcelDepot ?? existing);
    if (!hasAnyPoint({ swap: offersSwap(input.kind), charging: offersCharging(input.kind), ...depot })) {
      throw new BackendError("station_without_point");
    }
    const before = id ? state.stations.find((s) => s.id === id) : undefined;
    const extras = id ? DEMO_STATION_EXTRAS[id] : undefined;
    const station: Station = {
      ...fields,
      id: id ?? crypto.randomUUID(),
      operatorName: operator.name,
      isOwn: operator.isOwn,
      // Left out of the input: unchanged.
      photos: input.photos ? cleanPhotos(input.photos) : (before?.photos ?? extras?.photos ?? []),
      amenities: input.amenities ? cleanAmenities(input.amenities) : (before?.amenities ?? extras?.amenities ?? []),
    };
    if (id) {
      this.save(
        withAudit(
          { ...state, stations: state.stations.map((s) => (s.id === id ? station : s)) },
          { table: "stations", action: "update", rowId: id, stationId: id, changes: before ? diff(before, station) : {} },
        ),
      );
    } else {
      const status: StationStatus = {
        stationId: station.id,
        isOpen: true,
        freeSlots: 0,
        fullBatteries: station.batteryCapacity,
        updatedAt: new Date().toISOString(),
      };
      this.save(
        withAudit(
          { ...state, stations: [...state.stations, station], statuses: [...state.statuses, status] },
          { table: "stations", action: "insert", rowId: station.id, stationId: station.id, changes: { name: input.name } },
        ),
      );
    }
    if (batteryTypeIds) {
      const after = this.load();
      this.save({
        ...after,
        stationBatteryTypes: {
          ...(after.stationBatteryTypes ?? DEMO_STATION_BATTERY_TYPES),
          [station.id]: offersSwap(input.kind) ? [...new Set(batteryTypeIds)] : [],
        },
      });
    }
    if (parcelDepot) await this.writeDepot(station.id, parcelDepot);
  }

  async listBatteryTypes() {
    const state = this.load();
    this.requireAdmin(state);
    return [...(state.batteryTypes ?? DEMO_BATTERY_TYPES)].sort((a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name));
  }

  async saveBatteryType(id: string | null, input: BatteryTypeInput) {
    const state = this.load();
    this.requireAdmin(state);
    if (!validBatteryType(input)) throw new BackendError("unknown", "invalid battery type");
    const types = state.batteryTypes ?? DEMO_BATTERY_TYPES;
    const type: BatteryType = { id: id ?? crypto.randomUUID(), brand: input.brand.trim(), name: input.name.trim(), isActive: input.isActive };
    if (types.some((t) => t.id !== type.id && t.brand === type.brand && t.name === type.name)) throw new BackendError("battery_type_exists");
    const before = types.find((t) => t.id === id);
    this.save(
      withAudit(
        { ...state, batteryTypes: before ? types.map((t) => (t.id === id ? type : t)) : [...types, type] },
        {
          table: "battery_types",
          action: before ? "update" : "insert",
          rowId: type.id,
          changes: before ? diff(before, type) : { brand: type.brand, name: type.name },
        },
      ),
    );
  }

  /** Restores the example data (used by the "reset demo" button). */
  reset() {
    const profile = this.load().profile;
    this.save({ ...freshState(), profile });
  }

  private setReservationStatus(id: string, status: Reservation["status"]) {
    const state = this.load();
    const before = state.reservations.find((r) => r.id === id);
    const next = { ...state, reservations: state.reservations.map((r) => (r.id === id ? { ...r, status } : r)) };
    this.save(
      before && before.status !== status
        ? withAudit(next, {
            table: "reservations",
            action: "update",
            rowId: id,
            stationId: before.stationId,
            userId: before.userId,
            changes: { status: [before.status, status] },
          })
        : next,
    );
  }

  // Backoffice ---------------------------------------------------------------

  private requireAdmin(state: DemoState) {
    if (this.requireProfile(state).role !== "admin") throw new BackendError("forbidden");
  }

  async adminSnapshot(): Promise<AdminSnapshot> {
    const state = this.load();
    this.requireAdmin(state);
    const inactive = new Set(state.inactive ?? []);
    const since = Date.now() - ADMIN_HISTORY_DAYS * 86_400_000;
    return {
      stations: this.views(state, state.stations).map((s) => ({ ...s, isActive: !inactive.has(s.id) })),
      users: state.users ?? demoUsers(new Date()),
      staff: state.staff ?? DEMO_STAFF,
      reservations: state.reservations
        .filter((r) => new Date(r.createdAt).getTime() >= since)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      chargingPoints: [],
    };
  }

  async auditLog(filter: AuditFilter): Promise<AuditEntry[]> {
    const state = this.load();
    this.requireAdmin(state);
    return (state.audit ?? [])
      .filter(
        (e) =>
          (!filter.table || e.table === filter.table) &&
          (!filter.actorId || e.actorId === filter.actorId) &&
          (!filter.stationId || e.stationId === filter.stationId) &&
          (!filter.beforeId || e.id < filter.beforeId),
      )
      .slice(0, filter.limit ?? 100);
  }

  async setUserRole(userId: string, role: UserRole) {
    const state = this.load();
    this.requireAdmin(state);
    const users = state.users ?? demoUsers(new Date());
    const before = users.find((u) => u.id === userId);
    if (!before) throw new BackendError("unknown", "user not found");
    if (before.role === role) return;
    let next = withAudit(
      { ...state, users: users.map((u) => (u.id === userId ? { ...u, role } : u)) },
      { table: "profiles", action: "update", rowId: userId, userId, changes: { role: [before.role, role] } },
    );
    // Leaving "operator" ends every station assignment and operator account, like on Cloudflare.
    if (role !== "operator") {
      for (const a of (state.staff ?? DEMO_STAFF).filter((x) => x.userId === userId)) {
        next = withAudit(
          { ...next, staff: (next.staff ?? DEMO_STAFF).filter((x) => x !== a) },
          { table: "station_staff", action: "delete", rowId: `${a.stationId}:${userId}`, stationId: a.stationId, userId, changes: {} },
        );
      }
      for (const o of (state.operatorOwners ?? []).filter((x) => x.userId === userId)) {
        next = withAudit(
          { ...next, operatorOwners: (next.operatorOwners ?? []).filter((x) => x !== o) },
          { table: "operator_owners", action: "delete", rowId: `${o.operatorId}:${userId}`, userId, changes: { operator_id: o.operatorId } },
        );
      }
    }
    // Leaving "fleet_manager" ends the links to the drivers.
    if (role !== "fleet_manager") {
      for (const l of (state.fleetLinks ?? []).filter((x) => x.managerId === userId)) {
        next = withAudit(
          { ...next, fleetLinks: (next.fleetLinks ?? []).filter((x) => x !== l) },
          { table: "fleet_manager_drivers", action: "delete", rowId: l.driverId, userId: l.driverId, changes: { manager_id: userId } },
        );
      }
    }
    this.save(next);
  }

  async assignStaff(stationId: string, userId: string) {
    const state = this.load();
    this.requireAdmin(state);
    this.save(this.withStaff(state, stationId, userId));
  }

  private withStaff(state: DemoState, stationId: string, userId: string): DemoState {
    const staff = state.staff ?? DEMO_STAFF;
    if (staff.some((a) => a.stationId === stationId && a.userId === userId)) return state;
    return withAudit(
      {
        ...state,
        staff: [...staff, { stationId, userId }],
        // The role follows the assignment, like on Cloudflare.
        users: promoted(state, userId),
      },
      { table: "station_staff", action: "insert", rowId: `${stationId}:${userId}`, stationId, userId, changes: {} },
    );
  }

  async unassignStaff(stationId: string, userId: string) {
    const state = this.load();
    this.requireAdmin(state);
    this.save(this.withoutStaff(state, stationId, userId));
  }

  private withoutStaff(state: DemoState, stationId: string, userId: string): DemoState {
    const staff = (state.staff ?? DEMO_STAFF).filter((a) => !(a.stationId === stationId && a.userId === userId));
    return withAudit(
      { ...state, staff, users: demotedIfIdle({ ...state, staff }, userId) },
      { table: "station_staff", action: "delete", rowId: `${stationId}:${userId}`, stationId, userId, changes: {} },
    );
  }

  // Operator accounts --------------------------------------------------------

  /** The signed-in operator account (admins too), and the operators it may manage. */
  private requireOwnerOf(state: DemoState, stationId: string): Profile {
    const profile = this.requireProfile(state);
    if (profile.role === "admin") return profile;
    if (profile.role !== "operator") throw new BackendError("forbidden");
    const station = state.stations.find((s) => s.id === stationId);
    if (!station || !ownedOperators(state, profile.id).includes(station.operatorId)) throw new BackendError("forbidden");
    return profile;
  }

  private label(state: DemoState, userId: string) {
    const u = (state.users ?? demoUsers(new Date())).find((x) => x.id === userId);
    return { userId, label: u ? personLabel(u) : "?" };
  }

  private accountByContact(state: DemoState, contact: string) {
    const parsed = parseContact(contact);
    if (!parsed) throw new BackendError(contact.includes("@") ? "invalid_contact" : "phone_not_allowed");
    const user = (state.users ?? demoUsers(new Date())).find((u) =>
      parsed.kind === "phone" ? u.phone === parsed.value : u.email === parsed.value,
    );
    if (!user) throw new BackendError("account_not_found");
    return user;
  }

  async ownerView(): Promise<OwnerView> {
    const state = this.load();
    const profile = this.requireProfile(state);
    const owned = new Set(ownedOperators(state, profile.id));
    if ((profile.role !== "operator" && profile.role !== "admin") || !owned.size) throw new BackendError("forbidden");
    const stations = this.activeStations(state).filter((s) => owned.has(s.operatorId));
    const ids = new Set(stations.map((s) => s.id));
    return {
      operators: state.operators.filter((o) => owned.has(o.id)),
      stations: this.views(state, stations),
      staff: (state.staff ?? DEMO_STAFF)
        .filter((a) => ids.has(a.stationId))
        .map((a) => ({ stationId: a.stationId, ...this.label(state, a.userId) })),
    };
  }

  async ownerAddStaff(stationId: string, contact: string) {
    const state = this.load();
    this.requireOwnerOf(state, stationId);
    this.save(this.withStaff(state, stationId, this.accountByContact(state, contact).id));
  }

  async ownerRemoveStaff(stationId: string, userId: string) {
    const state = this.load();
    this.requireOwnerOf(state, stationId);
    this.save(this.withoutStaff(state, stationId, userId));
  }

  async ownerSaveStation(stationId: string, input: OwnerStationInput) {
    const state = this.load();
    this.requireOwnerOf(state, stationId);
    const openingHours = input.openingHours.trim().slice(0, 200);
    const phone = input.phone?.trim().slice(0, 40) || null;
    this.save(
      withAudit(
        { ...state, stations: state.stations.map((s) => (s.id === stationId ? { ...s, openingHours, phone } : s)) },
        { table: "stations", action: "update", rowId: stationId, stationId, changes: { opening_hours: openingHours, phone } },
      ),
    );
  }

  async adminOperators(): Promise<AdminOperator[]> {
    const state = this.load();
    this.requireAdmin(state);
    const owners = state.operatorOwners ?? [];
    return [...state.operators]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((o) => ({
        ...o,
        contactPhone: state.operatorPhones?.[o.id] ?? null,
        stationCount: state.stations.filter((s) => s.operatorId === o.id).length,
        owners: owners.filter((x) => x.operatorId === o.id).map((x) => this.label(state, x.userId)),
      }));
  }

  async saveOperator(id: string | null, input: OperatorInput) {
    const state = this.load();
    this.requireAdmin(state);
    const name = input.name.trim().replace(/\s+/g, " ");
    if (!name || name.length > OPERATOR_NAME_MAX) throw new BackendError("unknown", "invalid name");
    const contactPhone = input.contactPhone?.trim() ? normalizeTogoPhone(input.contactPhone) : null;
    if (input.contactPhone?.trim() && !contactPhone) throw new BackendError("phone_not_allowed");
    const operatorId = id ?? `demo-op-${Date.now()}`;
    const operators = id
      ? state.operators.map((o) => (o.id === id ? { ...o, name } : o))
      : [...state.operators, { id: operatorId, name, isOwn: false }];
    this.save(
      withAudit(
        {
          ...state,
          operators,
          // Station names carry the operator name, like the join on Cloudflare.
          stations: state.stations.map((s) => (s.operatorId === operatorId ? { ...s, operatorName: name } : s)),
          operatorPhones: { ...state.operatorPhones, [operatorId]: contactPhone },
        },
        { table: "operators", action: id ? "update" : "insert", rowId: operatorId, changes: { name, contact_phone: contactPhone } },
      ),
    );
  }

  async addOperatorOwner(operatorId: string, contact: string) {
    const state = this.load();
    this.requireAdmin(state);
    if (!state.operators.some((o) => o.id === operatorId)) throw new BackendError("unknown", "operator not found");
    const user = this.accountByContact(state, contact);
    const owners = state.operatorOwners ?? [];
    if (owners.some((x) => x.operatorId === operatorId && x.userId === user.id)) return;
    this.saveOwners(
      { ...state, users: promoted(state, user.id) },
      [...owners, { operatorId, userId: user.id }],
      { table: "operator_owners", action: "insert", rowId: `${operatorId}:${user.id}`, userId: user.id, changes: { operator_id: operatorId } },
    );
  }

  async removeOperatorOwner(operatorId: string, userId: string) {
    const state = this.load();
    this.requireAdmin(state);
    const operatorOwners = (state.operatorOwners ?? []).filter((x) => !(x.operatorId === operatorId && x.userId === userId));
    this.saveOwners(
      { ...state, users: demotedIfIdle({ ...state, operatorOwners }, userId) },
      operatorOwners,
      { table: "operator_owners", action: "delete", rowId: `${operatorId}:${userId}`, userId, changes: { operator_id: operatorId } },
    );
  }

  private saveOwners(state: DemoState, operatorOwners: { operatorId: string; userId: string }[], audit: AuditInput) {
    const next = { ...state, operatorOwners };
    const profile = state.profile && { ...state.profile, ownerOf: ownedOperators(next, state.profile.id) };
    this.save(withAudit({ ...next, profile }, audit));
  }

  async setStationActive(stationId: string, active: boolean) {
    const state = this.load();
    this.requireAdmin(state);
    const inactive = (state.inactive ?? []).filter((id) => id !== stationId);
    this.save(
      withAudit(
        { ...state, inactive: active ? inactive : [...inactive, stationId] },
        { table: "stations", action: "update", rowId: stationId, stationId, changes: { is_active: [!active, active] } },
      ),
    );
  }

  // Advertising popup ---------------------------------------------------------

  // Connected sockets ---------------------------------------------------------

  async listDevices(): Promise<Device[]> {
    const state = this.load();
    this.requireAdmin(state);
    const seen = new Date().toISOString();
    return (state.devices ?? seedDevices()).map((d) => ({
      ...d,
      lastSeenAt: seen,
      points: d.points.map((p) => ({ ...p, lastSeenAt: seen })),
    }));
  }

  async createDevice(input: DeviceInput) {
    const state = this.load();
    this.requireAdmin(state);
    if (!validDeviceInput(input)) throw new BackendError("invalid_device");
    if (!state.stations.some((s) => s.id === input.stationId)) throw new BackendError("station_not_found");
    const externalId = normalizeDeviceId(input.externalId);
    const devices = state.devices ?? seedDevices();
    if (devices.some((d) => d.externalId === externalId)) throw new BackendError("device_exists");
    const outlets = input.outlets ?? 2;
    const device: Device = {
      externalId,
      stationId: input.stationId,
      vendor: input.vendor?.trim() ?? "",
      model: input.model?.trim() ?? "",
      link: input.link ?? "lorawan",
      outlets,
      lastSeenAt: null,
      createdAt: new Date().toISOString(),
      points: Array.from({ length: outlets }, (_, i) => ({
        id: `cp-${externalId}-${i + 1}`,
        stationId: input.stationId,
        label: outletLabel(externalId, i + 1),
        status: "free",
        deviceId: externalId,
        outlet: i + 1,
        powerWatts: 0,
        lastSeenAt: null,
      })),
    };
    // A connected socket makes the station a charging point.
    const stations = state.stations.map((s) =>
      s.id === input.stationId && !offersCharging(s.kind) ? { ...s, kind: kindFor(offersSwap(s.kind), true) } : s,
    );
    this.save(
      withAudit(
        { ...state, stations, devices: [device, ...devices] },
        { table: "charging_points", action: "insert", rowId: externalId, stationId: input.stationId, changes: { device: externalId, outlets } },
      ),
    );
  }

  async deleteDevice(externalId: string) {
    const state = this.load();
    this.requireAdmin(state);
    const devices = state.devices ?? seedDevices();
    const before = devices.find((d) => d.externalId === externalId);
    if (!before) return;
    this.save(
      withAudit(
        { ...state, devices: devices.filter((d) => d !== before) },
        { table: "charging_points", action: "delete", rowId: externalId, stationId: before.stationId, changes: { device: externalId } },
      ),
    );
  }

  async switchOutlet(externalId: string, outlet: number, on: boolean) {
    const state = this.load();
    this.requireAdmin(state);
    const all = state.devices ?? seedDevices();
    const device = all.find((d) => d.externalId === externalId);
    if (!device || !canSwitch(device)) throw new BackendError("forbidden");
    const devices = all.map((d) =>
      d.externalId !== externalId
        ? d
        : {
            ...d,
            points: d.points.map((p) =>
              p.outlet === outlet ? { ...p, status: on ? ("charging" as const) : ("free" as const), powerWatts: on ? 150 : 0 } : p,
            ),
          },
    );
    this.save({ ...state, devices });
  }

  // Parcel depot --------------------------------------------------------------

  /** Parcels past their pickup deadline go into storage (the Worker does this in a daily job). */
  private parcelsOf(state: DemoState): Parcel[] {
    const now = new Date().toISOString();
    return (state.parcels ?? []).map((p) =>
      p.status === "arrived" && p.pickupDeadline && p.pickupDeadline <= now
        ? { ...p, status: "stored" as const, pickupCode: undefined }
        : p,
    );
  }

  private saveParcels(state: DemoState, parcels: Parcel[], audit?: AuditInput) {
    const next = { ...state, parcels };
    this.save(audit ? withAudit(next, audit) : next);
  }

  private requireStaff(state: DemoState): Profile {
    const profile = this.requireProfile(state);
    if (profile.role !== "operator" && profile.role !== "admin") throw new BackendError("forbidden");
    return profile;
  }

  private activeDepot(state: DemoState, stationId: string): boolean {
    const inactive = new Set(state.inactive ?? []);
    return (state.parcelDepots ?? seedDepots()).some((d) => d.stationId === stationId && d.isActive) && !inactive.has(stationId);
  }

  async parcelInfo() {
    const state = this.load();
    return {
      depots: (state.parcelDepots ?? seedDepots()).filter((d) => this.activeDepot(state, d.stationId)),
      sizes: state.parcelSizes ?? DEFAULT_PARCEL_SIZES,
      driverSettings: state.driverSettings ?? DEFAULT_DRIVER_SETTINGS,
    };
  }

  async myParcels(): Promise<Parcel[]> {
    const state = this.load();
    const profile = state.profile;
    if (!profile) return [];
    const mine = (party: Parcel["sender"]) => party.userId === profile.id || (!!profile.phone && party.phone === profile.phone);
    return this.parcelsOf(state)
      .filter((p) => mine(p.sender) || mine(p.recipient))
      .map((p) => {
        const received = mine(p.recipient);
        return { ...p, pickupCode: received && p.status === "arrived" ? p.pickupCode : undefined, direction: received ? "received" : "sent" } as Parcel;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async stationParcels(stationId: string): Promise<Parcel[]> {
    const state = this.load();
    this.requireStaff(state);
    return this.parcelsOf(state)
      .filter((p) => p.fromStationId === stationId || p.toStationId === stationId)
      .map((p) => ({ ...p, pickupCode: undefined }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** The demo account of this phone number; adds one (without PIN) when there is none. */
  private demoAccount(state: DemoState, phone: string, name: string | null): { state: DemoState; userId: string } {
    const users = state.users ?? demoUsers(new Date());
    const known = users.find((u) => u.phone === phone);
    if (known) return { state, userId: known.id };
    const user: AdminUser = {
      id: `demo-parcel-${phone.slice(-8)}`,
      phone,
      email: null,
      fullName: name,
      role: "customer",
      createdAt: new Date().toISOString(),
      lastSignInAt: null,
    };
    return { state: { ...state, users: [user, ...users] }, userId: user.id };
  }

  async createParcel(stationId: string, input: ParcelInput): Promise<Parcel> {
    let state = this.load();
    const staff = this.requireStaff(state);
    const senderPhone = normalizeTogoPhone(input.senderPhone ?? "");
    const recipientPhone = normalizeTogoPhone(input.recipientPhone ?? "");
    if (!senderPhone || !recipientPhone) throw new BackendError("phone_not_allowed");
    if (input.toStationId === stationId) throw new BackendError("same_station");
    if (!this.activeDepot(state, stationId) || !this.activeDepot(state, input.toStationId)) throw new BackendError("depot_inactive");
    const content = (input.content ?? "").trim();
    if (!content) throw new BackendError("unknown", "content missing");
    const tier = sizeFor(input.measures, state.parcelSizes ?? DEFAULT_PARCEL_SIZES);
    if (!tier) throw new BackendError("parcel_too_large");
    const senderName = input.senderName?.trim() || null;
    const recipientName = input.recipientName?.trim() || null;
    const sender = this.demoAccount(state, senderPhone, senderName);
    const recipient = this.demoAccount(sender.state, recipientPhone, recipientName);
    state = recipient.state;
    const now = new Date().toISOString();
    const parcel: Parcel = {
      id: crypto.randomUUID(),
      trackingNo: newTrackingNo(),
      fromStationId: stationId,
      toStationId: input.toStationId,
      sender: { userId: sender.userId, phone: senderPhone, name: senderName },
      recipient: { userId: recipient.userId, phone: recipientPhone, name: recipientName },
      content: content.slice(0, 300),
      declaredValue: input.declaredValue ?? null,
      measures: input.measures,
      size: tier.size,
      priceFcfa: tier.priceFcfa,
      paymentMethod: "cash",
      paidAt: now,
      status: "deposited",
      createdAt: now,
      inTransitAt: null,
      arrivedAt: null,
      pickedUpAt: null,
      pickupDeadline: null,
      lockerNo: null,
      express: !!input.express,
      deliveryStatus: null,
      jobId: null,
    };
    if (input.express) {
      const job = this.newExpressJob(state, parcel);
      parcel.jobId = job.id;
      state = { ...state, jobs: [job, ...(state.jobs ?? [])] };
    }
    this.saveParcels(state, [parcel, ...this.parcelsOf(state)], {
      table: "parcels",
      action: "insert",
      rowId: parcel.id,
      stationId,
      userId: sender.userId,
      changes: { tracking_no: parcel.trackingNo, to_station_id: parcel.toStationId, size: tier.size, price_fcfa: tier.priceFcfa, created_by: staff.id },
    });
    if (input.express) this.dispatch();
    return parcel;
  }

  async markParcelsInTransit(stationId: string, ids: string[]) {
    const state = this.load();
    this.requireStaff(state);
    const parcels = this.parcelsOf(state);
    const chosen = parcels.filter((p) => ids.includes(p.id));
    if (chosen.length !== ids.length || chosen.some((p) => p.fromStationId !== stationId || p.status !== "deposited" || p.express)) {
      throw new BackendError("parcel_wrong_status");
    }
    const now = new Date().toISOString();
    this.saveParcels(
      state,
      parcels.map((p) => (ids.includes(p.id) ? { ...p, status: "in_transit" as const, inTransitAt: now } : p)),
      { table: "parcels", action: "update", rowId: ids.join(","), stationId, changes: { status: ["deposited", "in_transit"] } },
    );
  }

  async markParcelsArrived(stationId: string, ids: string[]) {
    const state = this.load();
    this.requireStaff(state);
    const parcels = this.parcelsOf(state);
    const chosen = parcels.filter((p) => ids.includes(p.id));
    if (chosen.length !== ids.length || chosen.some((p) => p.toStationId !== stationId || p.status !== "in_transit" || p.express)) {
      throw new BackendError("parcel_wrong_status");
    }
    const now = new Date();
    const deadline = new Date(now.getTime() + PARCEL_PICKUP_DAYS * 86_400_000).toISOString();
    const taken = new Set(parcels.filter((p) => p.toStationId === stationId && p.status === "arrived").map((p) => p.pickupCode));
    const newCode = () => {
      let code: string;
      do code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
      while (taken.has(code));
      taken.add(code);
      return code;
    };
    this.saveParcels(
      state,
      parcels.map((p) =>
        ids.includes(p.id)
          ? { ...p, status: "arrived" as const, arrivedAt: now.toISOString(), pickupDeadline: deadline, pickupCode: newCode() }
          : p,
      ),
      { table: "parcels", action: "update", rowId: ids.join(","), stationId, changes: { status: ["in_transit", "arrived"] } },
    );
  }

  async pickUpParcel(stationId: string, codeOrQr: string): Promise<Parcel> {
    const state = this.load();
    this.requireStaff(state);
    const since = Date.now() - PARCEL_CODE_LOCK_MINUTES * 60_000;
    const failures = (state.parcelCodeFailures ?? []).filter((f) => f.stationId === stationId && new Date(f.at).getTime() > since);
    if (failures.length >= PARCEL_MAX_CODE_FAILURES) throw new BackendError("code_locked");
    const input = parseHandoverInput(codeOrQr);
    const parcels = this.parcelsOf(state);
    const parcel = input
      ? parcels.find(
          (p) =>
            p.toStationId === stationId &&
            p.status === "arrived" &&
            (input.code ? p.pickupCode === input.code : true) &&
            (!input.trackingNo || p.trackingNo === input.trackingNo),
        )
      : undefined;
    if (parcel?.deliveryStatus === "out_for_delivery") throw new BackendError("parcel_with_driver");
    if (!parcel) {
      this.save({ ...state, parcelCodeFailures: [...failures, { stationId, at: new Date().toISOString() }] });
      if (input && !input.code && parcels.some((p) => p.trackingNo === input.trackingNo)) throw new BackendError("parcel_not_arrived");
      throw new BackendError("wrong_pickup_code");
    }
    const done: Parcel = { ...parcel, status: "picked_up", pickedUpAt: new Date().toISOString(), pickupCode: undefined };
    // The recipient came in person after booking a home delivery: the trip is off.
    const jobs = (state.jobs ?? []).map((j) =>
      j.parcelId === parcel.id && ["open", "assigned", "accepted"].includes(j.status) ? { ...j, status: "cancelled" as const } : j,
    );
    this.saveParcels(
      { ...state, jobs },
      parcels.map((p) => (p.id === parcel.id ? done : p)),
      { table: "parcels", action: "update", rowId: parcel.id, stationId, changes: { status: ["arrived", "picked_up"] } },
    );
    return done;
  }

  async cancelParcel(id: string) {
    const state = this.load();
    this.requireStaff(state);
    const parcels = this.parcelsOf(state);
    const parcel = parcels.find((p) => p.id === id);
    if (!parcel) throw new BackendError("parcel_not_found");
    if (parcel.status !== "deposited") throw new BackendError("parcel_wrong_status");
    this.saveParcels(
      state,
      parcels.map((p) => (p.id === id ? { ...p, status: "cancelled" as const } : p)),
      { table: "parcels", action: "update", rowId: id, stationId: parcel.fromStationId, changes: { status: ["deposited", "cancelled"] } },
    );
    if (parcel.jobId) this.cancelJobs(this.load(), (j) => j.parcelId === id);
  }

  async resendPickupCode(id: string) {
    const state = this.load();
    this.requireStaff(state);
    const parcel = this.parcelsOf(state).find((p) => p.id === id);
    if (!parcel) throw new BackendError("parcel_not_found");
    if (parcel.status !== "arrived") throw new BackendError("parcel_wrong_status");
    // Nothing is sent in demo mode.
  }

  async adminParcels(): Promise<AdminParcels> {
    const state = this.load();
    this.requireAdmin(state);
    return {
      parcels: this.parcelsOf(state).map((p) => ({ ...p, pickupCode: undefined })),
      depots: state.parcelDepots ?? seedDepots(),
      sizes: state.parcelSizes ?? DEFAULT_PARCEL_SIZES,
    };
  }

  async saveParcelDepot(stationId: string, input: ParcelDepotInput) {
    const state = this.load();
    this.requireAdmin(state);
    const station = state.stations.find((s) => s.id === stationId);
    if (!station) throw new BackendError("station_not_found");
    // A parcel point has nothing else, so its depot cannot be switched off here.
    if (station.kind === "parcel" && !input.isActive) throw new BackendError("station_without_point");
    await this.writeDepot(stationId, input);
  }

  private async writeDepot(stationId: string, input: ParcelDepotInput) {
    const state = this.load();
    const depots = state.parcelDepots ?? seedDepots();
    const before = depots.find((d) => d.stationId === stationId);
    const lockers = Math.max(0, Math.floor(input.lockers));
    const counter = input.counter ?? before?.counter ?? true;
    if (input.isActive && !counter && lockers === 0) throw new BackendError("unknown", "a depot needs a counter or lockers");
    const depot: ParcelDepot = { stationId, isActive: input.isActive, note: input.note.trim().slice(0, 200), counter, lockers };
    this.save(
      withAudit(
        { ...state, parcelDepots: [...depots.filter((d) => d.stationId !== stationId), depot] },
        {
          table: "parcel_depots",
          action: before ? "update" : "insert",
          rowId: stationId,
          stationId,
          changes: before ? diff(before, depot) : { is_active: depot.isActive, note: depot.note, has_counter: counter, lockers: depot.lockers },
        },
      ),
    );
  }

  async saveParcelSizes(sizes: ParcelSizeTier[]) {
    const state = this.load();
    this.requireAdmin(state);
    const before = state.parcelSizes ?? DEFAULT_PARCEL_SIZES;
    const changes: Record<string, unknown> = {};
    for (const tier of sizes) {
      const old = before.find((b) => b.size === tier.size);
      if (old) {
        const d = diff(old, tier);
        if (Object.keys(d).length) changes[tier.size] = d;
      }
    }
    this.save(withAudit({ ...state, parcelSizes: sizes }, { table: "parcel_sizes", action: "update", rowId: "sizes", changes }));
  }

  async closeStoredParcel(id: string, outcome: "released" | "auctioned") {
    const state = this.load();
    this.requireAdmin(state);
    const parcels = this.parcelsOf(state);
    const parcel = parcels.find((p) => p.id === id);
    if (!parcel) throw new BackendError("parcel_not_found");
    if (parcel.status !== "stored") throw new BackendError("parcel_wrong_status");
    this.saveParcels(
      state,
      parcels.map((p) => (p.id === id ? { ...p, status: outcome } : p)),
      { table: "parcels", action: "update", rowId: id, stationId: parcel.toStationId, changes: { status: ["stored", outcome] } },
    );
  }

  // Drivers ---------------------------------------------------------------------

  private settingsOf(state: DemoState): DriverSettings {
    return state.driverSettings ?? DEFAULT_DRIVER_SETTINGS;
  }

  private depotPoints(state: DemoState) {
    return state.stations.filter((st) => this.activeDepot(state, st.id));
  }

  private stationAt(state: DemoState, id: string | null): LatLng | null {
    return state.stations.find((st) => st.id === id) ?? null;
  }

  private balanceOfDriver(state: DemoState, driverId: string): number {
    return balanceOf((state.ledger ?? []).filter((e) => e.driverId === driverId));
  }

  private busyJob(state: DemoState, driverId: string): DemoJob | null {
    return (state.jobs ?? []).find((j) => j.driverId === driverId && BUSY_JOB_STATUSES.includes(j.status)) ?? null;
  }

  private viewJob(state: DemoState, j: DemoJob): DeliveryJob {
    const driver = (state.drivers ?? []).find((d) => d.userId === j.driverId);
    const vehicle = (state.fleet ?? seedFleet()).find((v) => v.id === driver?.vehicleId);
    const parcel = (state.parcels ?? []).find((p) => p.id === j.parcelId);
    return {
      id: j.id,
      kind: j.kind,
      status: j.status,
      parcelId: j.parcelId,
      trackingNo: parcel?.trackingNo ?? null,
      fromStationId: j.fromStationId,
      toStationId: j.toStationId,
      home: j.home,
      dropoff: j.dropoff ?? null,
      passengers: j.passengers ?? null,
      size: j.size,
      weightKg: j.weightKg,
      content: j.content,
      distanceM: j.distanceM,
      fareFcfa: j.fareFcfa,
      collectFcfa: j.collectFcfa,
      recipient: j.recipient,
      declaredValue: j.declaredValue,
      driver: driver ? { name: driver.fullName, phone: driver.phone, plate: vehicle?.plate ?? null, vehicleType: vehicle?.type ?? null } : null,
      customerName: j.customerName,
      createdAt: j.createdAt,
      assignedAt: j.assignedAt,
      acceptedAt: j.acceptedAt,
      pickedUpAt: j.pickedUpAt,
      atDoorAt: j.atDoorAt,
      doneAt: j.doneAt,
      proofKey: j.proofKey,
    };
  }

  private viewDriver(state: DemoState, d: DemoDriver, withCode: boolean): Driver {
    const vehicle = (state.fleet ?? seedFleet()).find((v) => v.id === d.vehicleId) ?? null;
    const queue = state.driverQueue ?? [];
    const mine = queue.find((q) => q.driverId === d.userId);
    const settled = (state.ledger ?? []).filter((e) => e.driverId === d.userId && e.kind === "settlement");
    return {
      userId: d.userId,
      status: d.status,
      fullName: d.fullName,
      phone: d.phone,
      idNumber: d.idNumber,
      licenseNumber: d.licenseNumber,
      wantedType: d.wantedType,
      vehicle,
      documents: d.documents,
      ...(withCode ? { code: d.code } : {}),
      createdAt: d.createdAt,
      reviewedAt: d.reviewedAt,
      balanceFcfa: this.balanceOfDriver(state, d.userId),
      lastSettledAt: settled.map((e) => e.at).sort().pop() ?? null,
      queue: mine
        ? {
            stationId: mine.stationId,
            since: mine.since,
            position: queue.filter((q) => q.stationId === mine.stationId && q.since <= mine.since).length,
          }
        : null,
    };
  }

  private newJob(fields: Partial<DemoJob> & Pick<DemoJob, "kind" | "size" | "distanceM" | "fareFcfa">): DemoJob {
    return {
      id: crypto.randomUUID(),
      status: "open",
      parcelId: null,
      fromStationId: null,
      toStationId: null,
      home: null,
      dropoff: null,
      passengers: null,
      weightKg: null,
      content: "",
      collectFcfa: 0,
      recipient: null,
      declaredValue: null,
      customerName: null,
      createdAt: new Date().toISOString(),
      assignedAt: null,
      acceptedAt: null,
      pickedUpAt: null,
      atDoorAt: null,
      doneAt: null,
      proofKey: null,
      customerUserId: null,
      driverId: null,
      driverStationId: null,
      declined: [],
      ...fields,
    };
  }

  private newExpressJob(state: DemoState, parcel: Parcel): DemoJob {
    const from = this.stationAt(state, parcel.fromStationId);
    const to = this.stationAt(state, parcel.toStationId);
    const distanceM = from && to ? Math.round(distanceMeters(from, to)) : 0;
    return this.newJob({
      kind: "express",
      parcelId: parcel.id,
      fromStationId: parcel.fromStationId,
      toStationId: parcel.toStationId,
      size: parcel.size,
      weightKg: parcel.measures.weightKg,
      content: parcel.content,
      distanceM,
      fareFcfa: fareFor(distanceM, true, this.settingsOf(state)),
    });
  }

  /** Same rules as dispatch() in worker/drivers.ts. */
  private dispatch() {
    const state = this.load();
    const s = this.settingsOf(state);
    const stale = new Date(Date.now() - s.acceptMinutes * 60_000).toISOString();
    let jobs = (state.jobs ?? []).map((j) =>
      j.status === "assigned" && j.assignedAt && j.assignedAt < stale
        ? { ...j, status: "open" as const, driverId: null, assignedAt: null, declined: [...j.declined, j.driverId ?? ""] }
        : j,
    );
    let queue = [...(state.driverQueue ?? [])];
    const drivers = state.drivers ?? [];
    const fleet = state.fleet ?? seedFleet();
    const stations = this.depotPoints(state);
    const tiers = state.parcelSizes ?? DEFAULT_PARCEL_SIZES;
    for (const job of [...jobs].filter((j) => j.status === "open").sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      const start = job.kind === "pickup" || job.kind === "ride" ? job.home : this.stationAt(state, job.fromStationId);
      if (!start) continue;
      const entries = queue
        .filter((q) => !job.declined.includes(q.driverId))
        .map((q) => {
          const d = drivers.find((x) => x.userId === q.driverId);
          const v = fleet.find((x) => x.id === d?.vehicleId);
          return d?.status === "active" && v?.isActive ? { ...q, vehicleType: v.type } : null;
        })
        .filter((q) => q !== null);
      const weight = job.weightKg ?? tiers.find((t) => t.size === job.size)?.maxWeightKg ?? 50;
      const pick = pickDriver(start, entries, stations, (type) =>
        job.kind === "ride" ? vehicleSeats(type, job.passengers ?? 1) : vehicleFits(type, job.size, weight, s),
      );
      if (!pick) continue;
      queue = queue.filter((q) => q.driverId !== pick.driverId);
      jobs = jobs.map((j) =>
        j.id === job.id ? { ...j, status: "assigned" as const, driverId: pick.driverId, driverStationId: pick.stationId, assignedAt: new Date().toISOString() } : j,
      );
    }
    if (JSON.stringify(jobs) !== JSON.stringify(state.jobs ?? []) || queue.length !== (state.driverQueue ?? []).length) {
      this.save({ ...state, jobs, driverQueue: queue });
    }
  }

  private saveJobs(state: DemoState, jobs: DemoJob[], audit?: AuditInput, extra: Partial<DemoState> = {}) {
    const next = { ...state, jobs, ...extra };
    this.save(audit ? withAudit(next, audit) : next);
  }

  private updateJob(state: DemoState, id: string, from: JobStatus[], patch: Partial<DemoJob>): DemoJob[] {
    const job = (state.jobs ?? []).find((j) => j.id === id);
    if (!job) throw new BackendError("job_not_found");
    if (!from.includes(job.status)) throw new BackendError("job_wrong_status");
    return (state.jobs ?? []).map((j) => (j.id === id ? { ...j, ...patch } : j));
  }

  private cancelJobs(state: DemoState, which: (j: DemoJob) => boolean) {
    const cancellable: JobStatus[] = ["open", "assigned", "accepted"];
    const hit = (state.jobs ?? []).filter((j) => which(j) && cancellable.includes(j.status));
    if (!hit.length) return;
    const jobs = (state.jobs ?? []).map((j) => (hit.includes(j) ? { ...j, status: "cancelled" as const, doneAt: new Date().toISOString() } : j));
    const parcels = (state.parcels ?? []).map((p) => {
      const job = hit.find((j) => j.parcelId === p.id);
      if (!job) return p;
      if (job.kind === "delivery" && p.deliveryStatus === "booked") return { ...p, deliveryStatus: null };
      if (job.kind === "express" && p.status === "deposited") return { ...p, express: false };
      return p;
    });
    const back = hit.filter((j) => j.driverId && j.driverStationId).map((j) => ({ driverId: j.driverId!, stationId: j.driverStationId!, since: new Date().toISOString() }));
    this.save(
      withAudit(
        { ...state, jobs, parcels, driverQueue: [...(state.driverQueue ?? []).filter((q) => !back.some((b) => b.driverId === q.driverId)), ...back] },
        { table: "delivery_jobs", action: "update", rowId: hit.map((j) => j.id).join(","), changes: { status: ["open", "cancelled"] } },
      ),
    );
  }

  private demoDriver(state: DemoState): { profile: Profile; driver: DemoDriver } {
    const profile = this.requireProfile(state);
    const driver = (state.drivers ?? []).find((d) => d.userId === profile.id);
    if (!driver || driver.status !== "active") throw new BackendError("not_a_driver");
    return { profile, driver };
  }

  private myDemoJob(state: DemoState, id: string): { driver: DemoDriver; job: DemoJob } {
    const { driver } = this.demoDriver(state);
    const job = (state.jobs ?? []).find((j) => j.id === id && j.driverId === driver.userId);
    if (!job) throw new BackendError("job_not_found");
    return { driver, job };
  }

  private ledgerEntry(driverId: string, kind: LedgerEntry["kind"], amountFcfa: number, jobId: string | null, stationId: string | null): DemoLedger {
    return { id: crypto.randomUUID(), at: new Date().toISOString(), driverId, kind, amountFcfa, jobId, stationId };
  }

  async driverHome(): Promise<DriverHome> {
    this.dispatch();
    const state = this.load();
    const profile = this.requireProfile(state);
    const settings = this.settingsOf(state);
    const d = (state.drivers ?? []).find((x) => x.userId === profile.id);
    if (!d) return { driver: null, job: null, history: [], ledger: [], settings };
    const mine = (state.jobs ?? []).filter((j) => j.driverId === profile.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const busy = mine.find((j) => BUSY_JOB_STATUSES.includes(j.status));
    return {
      driver: this.viewDriver(state, d, true),
      job: busy ? this.viewJob(state, busy) : null,
      history: mine.filter((j) => j !== busy).slice(0, 30).map((j) => this.viewJob(state, j)),
      ledger: (state.ledger ?? []).filter((e) => e.driverId === profile.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100),
      settings,
    };
  }

  async applyDriver(input: DriverApplication) {
    const state = this.load();
    const profile = this.requireProfile(state);
    if (!profile.phone) throw new BackendError("phone_required");
    const text = (v: string, min: number) => {
      const t = (v ?? "").trim();
      if (t.length < min || t.length > (min === 2 ? 80 : 40)) throw new BackendError("unknown", "invalid field");
      return t;
    };
    const fields = { fullName: text(input.fullName, 2), idNumber: text(input.idNumber, 3), licenseNumber: text(input.licenseNumber, 3), wantedType: input.wantedType };
    const existing = (state.drivers ?? []).find((d) => d.userId === profile.id);
    if (existing && (existing.status === "active" || existing.status === "suspended")) throw new BackendError("forbidden");
    const driver: DemoDriver = existing
      ? { ...existing, ...fields, status: "pending" }
      : { userId: profile.id, status: "pending", phone: profile.phone, documents: {}, vehicleId: null, code: newDriverCode(), createdAt: new Date().toISOString(), reviewedAt: null, ...fields };
    this.save(
      withAudit(
        { ...state, drivers: [driver, ...(state.drivers ?? []).filter((d) => d.userId !== profile.id)] },
        { table: "drivers", action: existing ? "update" : "insert", rowId: profile.id, userId: profile.id, changes: { status: "pending", wanted_type: fields.wantedType } },
      ),
    );
  }

  async uploadDriverDocument(kind: DriverDocument, image: Blob) {
    const state = this.load();
    const profile = this.requireProfile(state);
    const driver = (state.drivers ?? []).find((d) => d.userId === profile.id);
    if (!driver || (driver.status !== "pending" && driver.status !== "rejected")) throw new BackendError("forbidden");
    if (image.size > MAX_PROMO_IMAGE_BYTES / 4) throw new BackendError("image_too_large");
    const key = `drivers/${profile.id}/${kind}-${Date.now().toString(36)}.jpg`;
    const url = await readAsDataUrl(image as File);
    const fresh = this.load();
    const files = { ...fresh.driverFiles };
    const old = driver.documents[kind];
    if (old) delete files[old];
    files[key] = url;
    this.save({
      ...fresh,
      driverFiles: files,
      drivers: (fresh.drivers ?? []).map((d) => (d.userId === profile.id ? { ...d, documents: { ...d.documents, [kind]: key } } : d)),
    });
  }

  async joinDriverQueue(stationId: string, position: LatLng | null) {
    const state = this.load();
    const { driver } = this.demoDriver(state);
    const vehicle = (state.fleet ?? seedFleet()).find((v) => v.id === driver.vehicleId);
    if (!vehicle?.isActive) throw new BackendError("no_vehicle");
    if (this.busyJob(state, driver.userId)) throw new BackendError("driver_busy");
    if (this.balanceOfDriver(state, driver.userId) >= this.settingsOf(state).cashLimitFcfa) throw new BackendError("cash_limit");
    if (!this.activeDepot(state, stationId)) throw new BackendError("depot_inactive");
    // The demo runs anywhere, so it does not check that the driver is at the station.
    void position;
    const queue = state.driverQueue ?? [];
    if (queue.find((q) => q.driverId === driver.userId)?.stationId !== stationId) {
      this.save({ ...state, driverQueue: [...queue.filter((q) => q.driverId !== driver.userId), { driverId: driver.userId, stationId, since: new Date().toISOString() }] });
    }
    this.dispatch();
  }

  async leaveDriverQueue() {
    const state = this.load();
    const profile = this.requireProfile(state);
    this.save({ ...state, driverQueue: (state.driverQueue ?? []).filter((q) => q.driverId !== profile.id) });
  }

  async acceptJob(id: string) {
    const state = this.load();
    const { job } = this.myDemoJob(state, id);
    this.saveJobs(state, this.updateJob(state, job.id, ["assigned"], { status: "accepted", acceptedAt: new Date().toISOString() }));
  }

  async declineJob(id: string) {
    const state = this.load();
    const { driver, job } = this.myDemoJob(state, id);
    const jobs = this.updateJob(state, job.id, ["assigned"], { status: "open", driverId: null, assignedAt: null, declined: [...job.declined, driver.userId] });
    const queue = (state.driverQueue ?? []).filter((q) => q.driverId !== driver.userId);
    if (job.driverStationId) queue.push({ driverId: driver.userId, stationId: job.driverStationId, since: new Date().toISOString() });
    this.saveJobs(state, jobs, undefined, { driverQueue: queue });
    this.dispatch();
  }

  async collectPickup(id: string, measures: ParcelMeasures): Promise<DeliveryJob> {
    let state = this.load();
    const { driver, job } = this.myDemoJob(state, id);
    if (job.kind !== "pickup" || job.status !== "accepted" || !job.home || !job.toStationId || !job.recipient) throw new BackendError("job_wrong_status");
    const tier = sizeFor(measures, state.parcelSizes ?? DEFAULT_PARCEL_SIZES);
    if (!tier) throw new BackendError("parcel_too_large");
    const vehicle = (state.fleet ?? seedFleet()).find((v) => v.id === driver.vehicleId);
    if (!vehicle || !vehicleFits(vehicle.type, tier.size, measures.weightKg, this.settingsOf(state))) throw new BackendError("vehicle_too_small");
    const from = nearestStation(job.home, this.depotPoints(state).filter((st) => st.id !== job.toStationId));
    if (!from) throw new BackendError("depot_inactive");
    const recipient = this.demoAccount(state, job.recipient.phone, job.recipient.name);
    state = recipient.state;
    const now = new Date().toISOString();
    const collect = tier.priceFcfa + job.fareFcfa;
    const parcel: Parcel = {
      id: crypto.randomUUID(),
      trackingNo: newTrackingNo(),
      fromStationId: from.id,
      toStationId: job.toStationId,
      sender: { userId: job.customerUserId, phone: job.home.phone, name: job.customerName },
      recipient: { userId: recipient.userId, phone: job.recipient.phone, name: job.recipient.name },
      content: job.content,
      declaredValue: job.declaredValue,
      measures,
      size: tier.size,
      priceFcfa: tier.priceFcfa,
      paymentMethod: "cash_driver",
      paidAt: now,
      status: "in_transit",
      createdAt: now,
      inTransitAt: now,
      arrivedAt: null,
      pickedUpAt: null,
      pickupDeadline: null,
      lockerNo: null,
      express: true,
      deliveryStatus: null,
      jobId: job.id,
    };
    const jobs = this.updateJob(state, job.id, ["accepted"], {
      status: "picked_up",
      pickedUpAt: now,
      parcelId: parcel.id,
      size: tier.size,
      weightKg: measures.weightKg,
      collectFcfa: collect,
    });
    this.saveJobs(
      state,
      jobs,
      { table: "parcels", action: "insert", rowId: parcel.id, stationId: from.id, userId: job.customerUserId, changes: { tracking_no: parcel.trackingNo, size: tier.size, collect_fcfa: collect } },
      { parcels: [parcel, ...(state.parcels ?? [])], ledger: [this.ledgerEntry(driver.userId, "collected", collect, job.id, null), ...(state.ledger ?? [])] },
    );
    const saved = this.load();
    return this.viewJob(saved, (saved.jobs ?? []).find((j) => j.id === job.id)!);
  }

  async arriveAtDoor(id: string) {
    const state = this.load();
    const { job } = this.myDemoJob(state, id);
    if (job.kind !== "delivery") throw new BackendError("job_wrong_status");
    this.saveJobs(state, this.updateJob(state, job.id, ["picked_up"], { status: "at_door", atDoorAt: new Date().toISOString() }));
  }

  async uploadDeliveryPhoto(id: string, image: Blob) {
    const state = this.load();
    const { job } = this.myDemoJob(state, id);
    if (job.kind !== "delivery" || !["picked_up", "at_door"].includes(job.status)) throw new BackendError("job_wrong_status");
    if (image.size > MAX_PROMO_IMAGE_BYTES / 4) throw new BackendError("image_too_large");
    const key = `proofs/${job.id}-${Date.now().toString(36)}.jpg`;
    const url = await readAsDataUrl(image as File);
    const fresh = this.load();
    const files = { ...fresh.driverFiles };
    if (job.proofKey) delete files[job.proofKey];
    files[key] = url;
    this.save({ ...fresh, driverFiles: files, jobs: (fresh.jobs ?? []).map((j) => (j.id === job.id ? { ...j, proofKey: key } : j)) });
  }

  async deliverJob(id: string, code: string) {
    const state = this.load();
    const { driver, job } = this.myDemoJob(state, id);
    if (job.kind !== "delivery" || !["picked_up", "at_door"].includes(job.status)) throw new BackendError("job_wrong_status");
    if (!job.proofKey) throw new BackendError("photo_missing");
    const lockKey = `job:${job.id}`;
    const since = Date.now() - PARCEL_CODE_LOCK_MINUTES * 60_000;
    const failures = (state.parcelCodeFailures ?? []).filter((f) => f.stationId === lockKey && new Date(f.at).getTime() > since);
    if (failures.length >= PARCEL_MAX_CODE_FAILURES) throw new BackendError("code_locked");
    const parcel = (state.parcels ?? []).find((p) => p.id === job.parcelId);
    const input = parsePickupInput(code);
    if (!parcel || !input || input.code !== parcel.pickupCode) {
      this.save({ ...state, parcelCodeFailures: [...(state.parcelCodeFailures ?? []), { stationId: lockKey, at: new Date().toISOString() }] });
      throw new BackendError("wrong_pickup_code");
    }
    const now = new Date().toISOString();
    const jobs = this.updateJob(state, job.id, ["picked_up", "at_door"], { status: "done", doneAt: now });
    this.saveJobs(
      state,
      jobs,
      { table: "parcels", action: "update", rowId: parcel.id, userId: parcel.recipient.userId, changes: { status: ["arrived", "picked_up"], delivery_status: ["out_for_delivery", "delivered"] } },
      {
        parcels: (state.parcels ?? []).map((p) =>
          p.id === parcel.id ? { ...p, status: "picked_up" as const, pickedUpAt: now, pickupCode: undefined, deliveryStatus: "delivered" as const } : p,
        ),
        greenpoint: this.tripGreenpoint(state, driver.userId, job, job.fromStationId),
        ledger: [
          this.ledgerEntry(driver.userId, "collected", job.collectFcfa, job.id, null),
          this.ledgerEntry(driver.userId, "earning", driverEarning(job.fareFcfa, this.settingsOf(state)), job.id, null),
          ...(state.ledger ?? []),
        ],
      },
    );
  }

  async failDelivery(id: string) {
    const state = this.load();
    const { job } = this.myDemoJob(state, id);
    if (job.kind !== "delivery" || job.status !== "at_door" || !job.atDoorAt) throw new BackendError("job_wrong_status");
    if (Date.now() - new Date(job.atDoorAt).getTime() < this.settingsOf(state).waitMinutes * 60_000) throw new BackendError("wait_longer");
    this.saveJobs(state, this.updateJob(state, job.id, ["at_door"], { status: "returning" }));
  }

  async boardRide(id: string) {
    const state = this.load();
    const { job } = this.myDemoJob(state, id);
    if (job.kind !== "ride") throw new BackendError("job_wrong_status");
    this.saveJobs(state, this.updateJob(state, job.id, ["accepted"], { status: "picked_up", pickedUpAt: new Date().toISOString() }));
  }

  async finishRide(id: string) {
    const state = this.load();
    const { driver, job } = this.myDemoJob(state, id);
    if (job.kind !== "ride") throw new BackendError("job_wrong_status");
    const jobs = this.updateJob(state, job.id, ["picked_up"], { status: "done", doneAt: new Date().toISOString() });
    this.saveJobs(
      state,
      jobs,
      { table: "delivery_jobs", action: "update", rowId: job.id, userId: driver.userId, changes: { status: ["picked_up", "done"], collect_fcfa: job.collectFcfa } },
      {
        greenpoint: this.tripGreenpoint(state, driver.userId, job, job.driverStationId),
        ledger: [
          this.ledgerEntry(driver.userId, "collected", job.collectFcfa, job.id, null),
          this.ledgerEntry(driver.userId, "earning", driverEarning(job.fareFcfa, this.settingsOf(state)), job.id, null),
          ...(state.ledger ?? []),
        ],
      },
    );
  }

  async myJobs(): Promise<DeliveryJob[]> {
    const state = this.load();
    if (!state.profile) return [];
    return (state.jobs ?? [])
      .filter((j) => j.customerUserId === state.profile!.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((j) => this.viewJob(state, j));
  }

  private cleanHome(home: HomePoint): HomePoint {
    if (!validPoint(home)) throw new BackendError("unknown", "no position");
    if (!inServiceArea(home)) throw new BackendError("outside_area");
    const phone = normalizeTogoPhone(home.phone ?? "");
    if (!phone) throw new BackendError("phone_not_allowed");
    return { lat: home.lat, lng: home.lng, note: (home.note ?? "").trim().slice(0, 300), phone };
  }

  async bookPickup(input: PickupBooking): Promise<DeliveryJob> {
    const state = this.load();
    const profile = this.requireProfile(state);
    const home = this.cleanHome(input.home);
    if (!this.activeDepot(state, input.toStationId)) throw new BackendError("depot_inactive");
    const recipientPhone = normalizeTogoPhone(input.recipientPhone ?? "");
    if (!recipientPhone) throw new BackendError("phone_not_allowed");
    const content = (input.content ?? "").trim().slice(0, 300);
    if (!content) throw new BackendError("unknown", "content missing");
    const tier = (state.parcelSizes ?? DEFAULT_PARCEL_SIZES).find((t) => t.size === input.size);
    if (!tier) throw new BackendError("parcel_too_large");
    const to = this.stationAt(state, input.toStationId)!;
    const distanceM = Math.round(distanceMeters(home, to));
    const fare = fareFor(distanceM, false, this.settingsOf(state));
    const job = this.newJob({
      kind: "pickup",
      toStationId: input.toStationId,
      home,
      size: tier.size,
      weightKg: tier.maxWeightKg,
      content,
      declaredValue: input.declaredValue ?? null,
      recipient: { phone: recipientPhone, name: input.recipientName?.trim() || null },
      distanceM,
      fareFcfa: fare,
      collectFcfa: tier.priceFcfa + fare,
      customerUserId: profile.id,
      customerName: profile.fullName,
    });
    this.saveJobs(state, [job, ...(state.jobs ?? [])], {
      table: "delivery_jobs",
      action: "insert",
      rowId: job.id,
      stationId: input.toStationId,
      userId: profile.id,
      changes: { kind: "pickup", fare_fcfa: fare },
    });
    this.dispatch();
    const saved = this.load();
    return this.viewJob(saved, (saved.jobs ?? []).find((j) => j.id === job.id)!);
  }

  async bookRide(input: RideBooking): Promise<DeliveryJob> {
    const state = this.load();
    const profile = this.requireProfile(state);
    const pickup = this.cleanHome(input.pickup);
    const d = input.dropoff;
    if (!validPoint(d)) throw new BackendError("unknown", "no destination");
    if (!inServiceArea(d)) throw new BackendError("outside_area");
    if (!Number.isInteger(input.passengers) || input.passengers < 1 || input.passengers > MAX_PASSENGERS) throw new BackendError("unknown", "passengers");
    const done: JobStatus[] = ["done", "failed", "cancelled"];
    if ((state.jobs ?? []).some((j) => j.kind === "ride" && j.customerUserId === profile.id && !done.includes(j.status))) throw new BackendError("ride_open");
    const distanceM = Math.round(distanceMeters(pickup, d));
    const fare = fareFor(distanceM, false, this.settingsOf(state));
    const job = this.newJob({
      kind: "ride",
      home: pickup,
      dropoff: { lat: d.lat, lng: d.lng, note: (d.note ?? "").trim().slice(0, 300) },
      passengers: input.passengers,
      size: "S",
      distanceM,
      fareFcfa: fare,
      collectFcfa: fare,
      customerUserId: profile.id,
      customerName: profile.fullName,
    });
    this.saveJobs(state, [job, ...(state.jobs ?? [])], {
      table: "delivery_jobs",
      action: "insert",
      rowId: job.id,
      userId: profile.id,
      changes: { kind: "ride", passengers: input.passengers, fare_fcfa: fare },
    });
    this.dispatch();
    const saved = this.load();
    return this.viewJob(saved, (saved.jobs ?? []).find((j) => j.id === job.id)!);
  }

  async bookDelivery(parcelId: string, input: HomePoint): Promise<DeliveryJob> {
    const state = this.load();
    const profile = this.requireProfile(state);
    const home = this.cleanHome(input);
    const parcel = this.parcelsOf(state).find((p) => p.id === parcelId);
    if (!parcel) throw new BackendError("parcel_not_found");
    const isRecipient = parcel.recipient.userId === profile.id || (!!profile.phone && parcel.recipient.phone === profile.phone);
    if (!isRecipient) throw new BackendError("forbidden");
    if (parcel.status !== "arrived" || (parcel.deliveryStatus && parcel.deliveryStatus !== "failed")) throw new BackendError("parcel_wrong_status");
    const from = this.stationAt(state, parcel.toStationId)!;
    const distanceM = Math.round(distanceMeters(from, home));
    const fare = fareFor(distanceM, false, this.settingsOf(state));
    const job = this.newJob({
      kind: "delivery",
      parcelId: parcel.id,
      fromStationId: parcel.toStationId,
      home,
      size: parcel.size,
      weightKg: parcel.measures.weightKg,
      content: parcel.content,
      distanceM,
      fareFcfa: fare,
      collectFcfa: fare,
      customerUserId: profile.id,
      customerName: parcel.recipient.name ?? profile.fullName,
    });
    this.saveJobs(
      state,
      [job, ...(state.jobs ?? [])],
      { table: "parcels", action: "update", rowId: parcel.id, stationId: parcel.toStationId, userId: profile.id, changes: { delivery_status: [parcel.deliveryStatus ?? null, "booked"] } },
      { parcels: (state.parcels ?? []).map((p) => (p.id === parcel.id ? { ...p, deliveryStatus: "booked" as const, jobId: job.id } : p)) },
    );
    this.dispatch();
    const saved = this.load();
    return this.viewJob(saved, (saved.jobs ?? []).find((j) => j.id === job.id)!);
  }

  async cancelJob(id: string) {
    const state = this.load();
    const profile = this.requireProfile(state);
    const job = (state.jobs ?? []).find((j) => j.id === id);
    if (!job) throw new BackendError("job_not_found");
    if (profile.role !== "admin" && job.customerUserId !== profile.id) throw new BackendError("forbidden");
    if (!["open", "assigned", "accepted"].includes(job.status)) throw new BackendError("job_wrong_status");
    this.cancelJobs(state, (j) => j.id === id);
  }

  async stationDrivers(stationId: string): Promise<StationDrivers> {
    this.dispatch();
    const state = this.load();
    this.requireStaff(state);
    const jobs = state.jobs ?? [];
    const drivers = state.drivers ?? [];
    const fleet = state.fleet ?? seedFleet();
    return {
      queue: (state.driverQueue ?? [])
        .filter((q) => q.stationId === stationId)
        .sort((a, b) => a.since.localeCompare(b.since))
        .map((q) => {
          const d = drivers.find((x) => x.userId === q.driverId);
          const v = fleet.find((x) => x.id === d?.vehicleId);
          return { driver: { name: d?.fullName ?? "?", phone: d?.phone ?? null, plate: v?.plate ?? null, vehicleType: v?.type ?? null }, since: q.since };
        }),
      outgoing: jobs
        .filter((j) => j.fromStationId === stationId && (j.kind === "express" || j.kind === "delivery") && ["open", "assigned", "accepted"].includes(j.status))
        .map((j) => this.viewJob(state, j)),
      incoming: jobs
        .filter(
          (j) =>
            (j.toStationId === stationId && (j.kind === "express" || j.kind === "pickup") && j.status === "picked_up") ||
            (j.fromStationId === stationId && j.kind === "delivery" && j.status === "returning"),
        )
        .map((j) => this.viewJob(state, j)),
    };
  }

  private byBadge(state: DemoState, badge: string): DemoDriver {
    const code = parseDriverBadge(badge);
    const driver = (state.drivers ?? []).find((d) => d.code === code && d.status === "active");
    if (!code || !driver) throw new BackendError("driver_not_found");
    return driver;
  }

  private stationJobs(state: DemoState, stationId: string, driverId: string) {
    const job = this.busyJob(state, driverId);
    const handOver =
      job && job.fromStationId === stationId && (job.kind === "express" || job.kind === "delivery") && ["assigned", "accepted"].includes(job.status) ? job : null;
    const receive =
      job &&
      ((job.status === "picked_up" && job.toStationId === stationId && (job.kind === "express" || job.kind === "pickup")) ||
        (job.status === "returning" && job.fromStationId === stationId && job.kind === "delivery"))
        ? job
        : null;
    return { handOver, receive };
  }

  async driverAtStation(stationId: string, badge: string): Promise<DriverAtStation> {
    const state = this.load();
    this.requireStaff(state);
    const d = this.byBadge(state, badge);
    const vehicle = (state.fleet ?? seedFleet()).find((v) => v.id === d.vehicleId);
    const { handOver, receive } = this.stationJobs(state, stationId, d.userId);
    return {
      driver: { userId: d.userId, name: d.fullName, phone: d.phone, plate: vehicle?.plate ?? null, vehicleType: vehicle?.type ?? null },
      balanceFcfa: this.balanceOfDriver(state, d.userId),
      handOver: handOver ? this.viewJob(state, handOver) : null,
      receive: receive ? this.viewJob(state, receive) : null,
    };
  }

  async handToDriver(stationId: string, badge: string, jobId: string) {
    const state = this.load();
    this.requireStaff(state);
    const d = this.byBadge(state, badge);
    const { handOver: job } = this.stationJobs(state, stationId, d.userId);
    if (!job || job.id !== jobId) throw new BackendError("job_wrong_status");
    const now = new Date().toISOString();
    const parcels = (state.parcels ?? []).map((p) => {
      if (p.id !== job.parcelId) return p;
      if (job.kind === "express") {
        if (p.status !== "deposited") throw new BackendError("parcel_wrong_status");
        return { ...p, status: "in_transit" as const, inTransitAt: now };
      }
      if (p.status !== "arrived" || p.deliveryStatus !== "booked") throw new BackendError("parcel_wrong_status");
      return { ...p, deliveryStatus: "out_for_delivery" as const };
    });
    this.saveJobs(
      state,
      this.updateJob(state, job.id, ["assigned", "accepted"], { status: "picked_up", pickedUpAt: now, acceptedAt: job.acceptedAt ?? now }),
      { table: "delivery_jobs", action: "update", rowId: job.id, stationId, userId: d.userId, changes: { status: [job.status, "picked_up"] } },
      { parcels },
    );
  }

  async receiveFromDriver(stationId: string, badge: string, jobId: string) {
    const state = this.load();
    this.requireStaff(state);
    const d = this.byBadge(state, badge);
    const { receive: job } = this.stationJobs(state, stationId, d.userId);
    if (!job || job.id !== jobId) throw new BackendError("job_wrong_status");
    const now = new Date();
    if (job.status === "returning") {
      this.saveJobs(
        state,
        this.updateJob(state, job.id, ["returning"], { status: "failed", doneAt: now.toISOString() }),
        { table: "delivery_jobs", action: "update", rowId: job.id, stationId, userId: d.userId, changes: { status: ["returning", "failed"] } },
        { parcels: (state.parcels ?? []).map((p) => (p.id === job.parcelId ? { ...p, deliveryStatus: "failed" as const } : p)) },
      );
      return;
    }
    const taken = new Set((state.parcels ?? []).filter((p) => p.toStationId === stationId && p.status === "arrived").map((p) => p.pickupCode));
    let code: string;
    do code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    while (taken.has(code));
    const deadline = new Date(now.getTime() + PARCEL_PICKUP_DAYS * 86_400_000).toISOString();
    this.saveJobs(
      state,
      this.updateJob(state, job.id, ["picked_up"], { status: "done", doneAt: now.toISOString() }),
      { table: "delivery_jobs", action: "update", rowId: job.id, stationId, userId: d.userId, changes: { status: ["picked_up", "done"] } },
      {
        parcels: (state.parcels ?? []).map((p) =>
          p.id === job.parcelId ? { ...p, status: "arrived" as const, arrivedAt: now.toISOString(), pickupDeadline: deadline, pickupCode: code } : p,
        ),
        ledger: [this.ledgerEntry(d.userId, "earning", driverEarning(job.fareFcfa, this.settingsOf(state)), job.id, stationId), ...(state.ledger ?? [])],
        greenpoint: this.tripGreenpoint(state, d.userId, job, stationId),
      },
    );
  }

  async settleDriver(stationId: string, badge: string, amountFcfa: number) {
    const state = this.load();
    this.requireStaff(state);
    const d = this.byBadge(state, badge);
    const current = this.balanceOfDriver(state, d.userId);
    if (amountFcfa !== current) throw new BackendError("balance_changed");
    if (current === 0) return;
    this.save(
      withAudit(
        { ...state, ledger: [this.ledgerEntry(d.userId, "settlement", current, null, stationId), ...(state.ledger ?? [])] },
        { table: "driver_ledger", action: "insert", rowId: d.userId, stationId, userId: d.userId, changes: { settlement: current } },
      ),
    );
  }

  // Partner API ---------------------------------------------------------------

  private bookingsOf(state: DemoState) {
    return state.bookings ?? seedBookings(new Date());
  }

  private partnersOf(state: DemoState) {
    return state.partners ?? seedPartners();
  }

  async stationBookings(stationId: string): Promise<StationBooking[]> {
    const state = this.load();
    this.requireStaff(state);
    return this.bookingsOf(state).filter((b) => b.fromStationId === stationId);
  }

  async acceptBooking(stationId: string, bookingId: string, measures: ParcelMeasures): Promise<Parcel> {
    const state = this.load();
    const booking = this.bookingsOf(state).find((b) => b.id === bookingId && b.fromStationId === stationId);
    if (!booking) throw new BackendError("parcel_not_found");
    // Takes it in like a parcel handed in at the counter, then keeps the booking's number.
    const parcel = await this.createParcel(stationId, {
      senderPhone: booking.sender.phone,
      senderName: booking.sender.name ?? undefined,
      recipientPhone: booking.recipient.phone,
      recipientName: booking.recipient.name ?? undefined,
      toStationId: booking.toStationId,
      content: booking.content,
      declaredValue: booking.declaredValue,
      measures,
    });
    const after = this.load();
    const taken: Parcel = { ...parcel, trackingNo: booking.trackingNo, paymentMethod: "partner", paidAt: null };
    this.save({
      ...after,
      parcels: (after.parcels ?? []).map((p) => (p.id === parcel.id ? taken : p)),
      bookings: this.bookingsOf(after).filter((b) => b.id !== bookingId),
    });
    return taken;
  }

  async adminPartners(): Promise<AdminPartners> {
    const state = this.load();
    this.requireAdmin(state);
    const bookings = this.bookingsOf(state);
    return {
      partners: this.partnersOf(state).map((p) => ({ ...p, openBookings: bookings.filter((b) => b.partnerId === p.id).length })),
      events: [],
    };
  }

  async savePartner(id: string | null, input: PartnerInput) {
    const state = this.load();
    this.requireAdmin(state);
    const name = input.name.trim().slice(0, 80);
    const contactPhone = normalizeTogoPhone(input.contactPhone);
    if (!name) throw new BackendError("unknown", "name missing");
    if (!contactPhone) throw new BackendError("phone_not_allowed");
    const webhookUrl = input.webhookUrl.trim() || null;
    if (webhookUrl && !validWebhookUrl(webhookUrl)) throw new BackendError("invalid_webhook");
    const partners = this.partnersOf(state);
    const fields = { name, contactPhone, contactEmail: input.contactEmail.trim() || null, isActive: input.isActive, webhookUrl, sharePickupCode: input.sharePickupCode };
    const before = id ? partners.find((p) => p.id === id) : undefined;
    const saved: Partner = before
      ? { ...before, ...fields }
      : { id: `partner-${Date.now().toString(36)}`, ...fields, webhookSecret: newWebhookSecret(), createdAt: new Date().toISOString(), keys: [], parcels30d: 0, amount30d: 0, openBookings: 0 };
    this.save(
      withAudit(
        { ...state, partners: before ? partners.map((p) => (p.id === id ? saved : p)) : [...partners, saved] },
        { table: "partners", action: before ? "update" : "insert", rowId: saved.id, changes: before ? diff(before, saved) : fields },
      ),
    );
  }

  async adminDrivers(): Promise<AdminDrivers> {
    this.dispatch();
    const state = this.load();
    this.requireAdmin(state);
    return {
      drivers: (state.drivers ?? []).map((d) => {
        const link = (state.fleetLinks ?? []).find((l) => l.driverId === d.userId);
        return { ...this.viewDriver(state, d, true), manager: link ? this.label(state, link.managerId) : null };
      }),
      vehicles: state.fleet ?? seedFleet(),
      jobs: [...(state.jobs ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 500).map((j) => this.viewJob(state, j)),
      settings: this.settingsOf(state),
    };
  }

  async reviewDriver(userId: string, decision: DriverDecision) {
    const state = this.load();
    this.requireAdmin(state);
    const d = (state.drivers ?? []).find((x) => x.userId === userId);
    if (!d) throw new BackendError("driver_not_found");
    const fleet = state.fleet ?? seedFleet();
    const busy = this.busyJob(state, userId);
    const vehicleFree = (id: string) => {
      if (!fleet.find((v) => v.id === id)?.isActive || (state.drivers ?? []).some((x) => x.vehicleId === id && x.userId !== userId)) {
        throw new BackendError("vehicle_unavailable");
      }
    };
    const now = new Date().toISOString();
    let next: DemoDriver = d;
    let queue = state.driverQueue ?? [];
    let jobs = state.jobs ?? [];
    switch (decision.action) {
      case "approve":
        if (d.status !== "pending" && d.status !== "rejected") throw new BackendError("forbidden");
        if (!d.documents.id || !d.documents.license || !d.documents.portrait) throw new BackendError("documents_missing");
        vehicleFree(decision.vehicleId);
        next = { ...d, status: "active", vehicleId: decision.vehicleId, reviewedAt: now };
        break;
      case "reject":
        if (d.status !== "pending") throw new BackendError("forbidden");
        next = { ...d, status: "rejected", reviewedAt: now };
        break;
      case "suspend":
        if (d.status !== "active") throw new BackendError("forbidden");
        if (busy && !["assigned", "accepted"].includes(busy.status)) throw new BackendError("driver_busy");
        if (busy) jobs = jobs.map((j) => (j.id === busy.id ? { ...j, status: "open" as const, driverId: null, assignedAt: null, acceptedAt: null } : j));
        queue = queue.filter((q) => q.driverId !== userId);
        next = { ...d, status: "suspended", reviewedAt: now };
        break;
      case "reactivate":
        if (d.status !== "suspended") throw new BackendError("forbidden");
        next = { ...d, status: "active", reviewedAt: now };
        break;
      case "vehicle":
        if (busy) throw new BackendError("driver_busy");
        if (decision.vehicleId) vehicleFree(decision.vehicleId);
        else queue = queue.filter((q) => q.driverId !== userId);
        next = { ...d, vehicleId: decision.vehicleId };
        break;
    }
    this.save(
      withAudit(
        { ...state, drivers: (state.drivers ?? []).map((x) => (x.userId === userId ? next : x)), driverQueue: queue, jobs, fleet },
        { table: "drivers", action: "update", rowId: userId, userId, changes: diff(d, next) },
      ),
    );
  }

  async saveFleetVehicle(id: string | null, input: FleetVehicleInput) {
    const state = this.load();
    this.requireAdmin(state);
    if (!FLEET_VEHICLE_TYPES.includes(input.type)) throw new BackendError("unknown", "type");
    const plate = (input.plate ?? "").trim().toUpperCase().replace(/\s+/g, " ");
    if (plate.length < 2 || plate.length > 20) throw new BackendError("unknown", "plate");
    const fleet = state.fleet ?? seedFleet();
    if (fleet.some((v) => v.plate === plate && v.id !== id)) throw new BackendError("vehicle_unavailable");
    const before = id ? fleet.find((v) => v.id === id) : undefined;
    if (id && !before) throw new BackendError("unknown", "vehicle");
    const saved: FleetVehicle = { id: id ?? `veh-${Date.now().toString(36)}`, type: input.type, plate, isActive: input.isActive };
    const users = new Set((state.drivers ?? []).filter((d) => d.vehicleId === saved.id).map((d) => d.userId));
    this.save(
      withAudit(
        {
          ...state,
          fleet: before ? fleet.map((v) => (v.id === id ? saved : v)) : [...fleet, saved],
          driverQueue: saved.isActive ? state.driverQueue : (state.driverQueue ?? []).filter((q) => !users.has(q.driverId)),
        },
        { table: "fleet_vehicles", action: before ? "update" : "insert", rowId: saved.id, changes: before ? diff(before, saved) : { type: saved.type, plate } },
      ),
    );
  }

  async saveDriverSettings(settings: DriverSettings) {
    const state = this.load();
    this.requireAdmin(state);
    if (!validSettings(settings)) throw new BackendError("unknown", "settings");
    this.save(
      withAudit(
        { ...state, driverSettings: settings },
        { table: "driver_settings", action: "update", rowId: "settings", changes: diff(this.settingsOf(state), settings) },
      ),
    );
  }

  async assignJob(jobId: string, driverId: string) {
    const state = this.load();
    this.requireAdmin(state);
    const job = (state.jobs ?? []).find((j) => j.id === jobId);
    if (!job) throw new BackendError("job_not_found");
    if (!["open", "assigned", "accepted"].includes(job.status)) throw new BackendError("job_wrong_status");
    this.handJob(state, job, driverId, "admin");
  }

  /** Same rules as handJob() in worker/drivers.ts. */
  private handJob(state: DemoState, job: DemoJob, driverId: string, by: "admin" | "fleet") {
    const d = (state.drivers ?? []).find((x) => x.userId === driverId);
    const vehicle = (state.fleet ?? seedFleet()).find((v) => v.id === d?.vehicleId);
    if (!d || d.status !== "active" || !vehicle?.isActive) throw new BackendError("driver_not_found");
    if (this.busyJob(state, driverId)) throw new BackendError("driver_busy");
    const weight = job.weightKg ?? (state.parcelSizes ?? DEFAULT_PARCEL_SIZES).find((t) => t.size === job.size)?.maxWeightKg ?? 50;
    if (!vehicleFits(vehicle.type, job.size, weight, this.settingsOf(state))) throw new BackendError("vehicle_too_small");
    const queued = (state.driverQueue ?? []).find((q) => q.driverId === driverId);
    this.saveJobs(
      state,
      (state.jobs ?? []).map((j) =>
        j.id === job.id
          ? { ...j, status: "assigned" as const, driverId, driverStationId: queued?.stationId ?? null, assignedAt: new Date().toISOString(), acceptedAt: null }
          : j,
      ),
      { table: "delivery_jobs", action: "update", rowId: job.id, userId: driverId, changes: { status: [job.status, "assigned"], by } },
      { driverQueue: (state.driverQueue ?? []).filter((q) => q.driverId !== driverId) },
    );
  }

  async setDriverManager(driverId: string, contact: string | null) {
    const state = this.load();
    this.requireAdmin(state);
    if (!(state.drivers ?? []).some((d) => d.userId === driverId)) throw new BackendError("driver_not_found");
    const links = state.fleetLinks ?? [];
    const before = links.find((l) => l.driverId === driverId);
    const rest = links.filter((l) => l.driverId !== driverId);
    let users = state.users ?? demoUsers(new Date());
    let next: DemoState = state;
    if (before) {
      // A manager left without drivers goes back to customer.
      const idle = !rest.some((l) => l.managerId === before.managerId);
      users = users.map((u) => (u.id === before.managerId && u.role === "fleet_manager" && idle ? { ...u, role: "customer" as const } : u));
      next = withAudit(
        { ...next, fleetLinks: rest, users },
        { table: "fleet_manager_drivers", action: "delete", rowId: driverId, userId: driverId, changes: { manager_id: before.managerId } },
      );
    }
    if (contact?.trim()) {
      const account = this.accountByContact(state, contact);
      if (account.id === driverId) throw new BackendError("forbidden");
      if (!["customer", "fleet_manager", "admin"].includes(account.role)) throw new BackendError("has_other_role");
      if (before?.managerId === account.id) return;
      users = users.map((u) => (u.id === account.id && u.role === "customer" ? { ...u, role: "fleet_manager" as const } : u));
      next = withAudit(
        { ...next, fleetLinks: [...rest, { driverId, managerId: account.id }], users },
        { table: "fleet_manager_drivers", action: "insert", rowId: driverId, userId: driverId, changes: { manager_id: account.id } },
      );
    }
    if (next !== state) this.save(next);
  }

  private managedDrivers(state: DemoState): DemoDriver[] {
    const profile = this.requireProfile(state);
    if (!managesFleet(profile)) throw new BackendError("forbidden");
    const drivers = state.drivers ?? [];
    if (profile.role === "admin") return drivers.filter((d) => d.status === "active" || d.status === "suspended");
    const mine = new Set((state.fleetLinks ?? []).filter((l) => l.managerId === profile.id).map((l) => l.driverId));
    return drivers.filter((d) => mine.has(d.userId));
  }

  async fleetView(): Promise<FleetView> {
    this.dispatch();
    const state = this.load();
    const drivers = this.managedDrivers(state).sort((a, b) => a.fullName.localeCompare(b.fullName));
    return {
      drivers: drivers.map((d) => {
        const view = this.viewDriver(state, d, false);
        const job = this.busyJob(state, d.userId);
        return {
          userId: d.userId,
          fullName: d.fullName,
          phone: d.phone,
          status: d.status,
          vehicle: view.vehicle,
          balanceFcfa: view.balanceFcfa,
          queue: view.queue,
          job: job ? jobForManager(this.viewJob(state, job)) : null,
        };
      }),
      openJobs: (state.jobs ?? [])
        .filter((j) => j.status === "open")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, 100)
        .map((j) => jobForManager(this.viewJob(state, j))),
      settings: this.settingsOf(state),
    };
  }

  async fleetStats(from: string, to: string): Promise<FleetStats> {
    const state = this.load();
    const drivers = this.managedDrivers(state);
    const range = fleetRange(from, to);
    if (!range) throw new BackendError("unknown", "period");
    const inRange = (at: string | null) => !!at && at >= range.start && at < range.end;
    return {
      from,
      to,
      drivers: drivers.map((d) => {
        const jobs = (state.jobs ?? []).filter((j) => j.driverId === d.userId && inRange(j.doneAt));
        const done = jobs.filter((j) => j.status === "done");
        const ledger = (state.ledger ?? []).filter((e) => e.driverId === d.userId && inRange(e.at));
        const sum = (kind: LedgerEntry["kind"]) => ledger.filter((e) => e.kind === kind).reduce((n, e) => n + e.amountFcfa, 0);
        const visits = state.reservations.filter((r) => r.userId === d.userId && r.status === "completed" && inRange(r.createdAt));
        return {
          userId: d.userId,
          tripsDone: done.length,
          tripsFailed: jobs.filter((j) => j.status === "failed").length,
          fareFcfa: done.reduce((n, j) => n + j.fareFcfa, 0),
          earningFcfa: sum("earning"),
          collectedFcfa: sum("collected"),
          settledFcfa: sum("settlement"),
          batterySwaps: visits.filter((r) => r.type === "battery").length,
          chargingSlots: visits.filter((r) => r.type === "slot").length,
          // The demo has no app payments.
          chargingPaidFcfa: 0,
        };
      }),
    };
  }

  async fleetAssign(jobId: string, driverId: string) {
    this.dispatch();
    const state = this.load();
    if (!this.managedDrivers(state).some((d) => d.userId === driverId)) throw new BackendError("driver_not_found");
    const job = (state.jobs ?? []).find((j) => j.id === jobId);
    if (!job) throw new BackendError("job_not_found");
    if (job.status !== "open") throw new BackendError("job_wrong_status");
    this.handJob(state, job, driverId, "fleet");
  }

  async driverFileUrl(key: string): Promise<string> {
    const state = this.load();
    this.requireAdmin(state);
    const url = state.driverFiles?.[key];
    if (!url) throw new BackendError("unknown", "file");
    return url;
  }

  private updatePartner(state: DemoState, id: string, change: (p: Partner) => Partner) {
    const partners = this.partnersOf(state);
    if (!partners.some((p) => p.id === id)) throw new BackendError("unknown", "partner not found");
    return { ...state, partners: partners.map((p) => (p.id === id ? change(p) : p)) };
  }

  async createPartnerKey(partnerId: string, label: string): Promise<PartnerKey & { key: string }> {
    const state = this.load();
    this.requireAdmin(state);
    const key = newApiKey();
    const row: PartnerKey = { id: crypto.randomUUID(), label: label.trim().slice(0, 60), prefix: keyPrefix(key), createdAt: new Date().toISOString(), lastUsedAt: null, revokedAt: null };
    this.save(
      withAudit(
        this.updatePartner(state, partnerId, (p) => ({ ...p, keys: [row, ...p.keys] })),
        { table: "partner_api_keys", action: "insert", rowId: row.id, changes: { partner_id: partnerId, label: row.label, prefix: row.prefix } },
      ),
    );
    return { ...row, key };
  }

  async revokePartnerKey(partnerId: string, keyId: string) {
    const state = this.load();
    this.requireAdmin(state);
    const at = new Date().toISOString();
    this.save(this.updatePartner(state, partnerId, (p) => ({ ...p, keys: p.keys.map((k) => (k.id === keyId ? { ...k, revokedAt: at } : k)) })));
  }

  async rotatePartnerSecret(partnerId: string) {
    const state = this.load();
    this.requireAdmin(state);
    const secret = newWebhookSecret();
    this.save(this.updatePartner(state, partnerId, (p) => ({ ...p, webhookSecret: secret })));
    return secret;
  }

  async retryPartnerEvent() {
    // The demo sends no webhooks.
  }

  async currentPromotion(): Promise<Promotion | null> {
    return pickPromotion(this.load().promotions ?? [], new Date());
  }

  async listPromotions(): Promise<Promotion[]> {
    const state = this.load();
    this.requireAdmin(state);
    return [...(state.promotions ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async savePromotion(id: string | null, input: PromotionInput) {
    const state = this.load();
    this.requireAdmin(state);
    const list = state.promotions ?? [];
    const at = new Date().toISOString();
    const before = id ? list.find((p) => p.id === id) : undefined;
    if (id && !before) throw new BackendError("unknown", "promotion not found");
    const saved: Promotion = before
      ? { ...before, ...input, updatedAt: at }
      : { id: `promo-${Date.now().toString(36)}`, ...input, createdAt: at, updatedAt: at };
    // Inline demo images would fill browser storage; the log only notes that the image changed.
    const short = (v: unknown) => (typeof v === "string" && v.startsWith("data:") ? "(image)" : v);
    const changes = diff(before ?? EMPTY_PROMOTION, saved);
    if (Array.isArray(changes.image_url)) changes.image_url = changes.image_url.map(short);
    delete changes.created_at;
    // Insert: the new row, as the audit trigger records it.
    if (!before) for (const [key, value] of Object.entries(changes)) changes[key] = (value as unknown[])[1];
    this.save(
      withAudit(
        { ...state, promotions: before ? list.map((p) => (p.id === id ? saved : p)) : [saved, ...list] },
        {
          table: "promotions",
          action: before ? "update" : "insert",
          rowId: saved.id,
          changes,
        },
      ),
    );
  }

  async deletePromotion(id: string) {
    const state = this.load();
    this.requireAdmin(state);
    const before = (state.promotions ?? []).find((p) => p.id === id);
    if (!before) return;
    this.save(
      withAudit(
        { ...state, promotions: (state.promotions ?? []).filter((p) => p.id !== id) },
        { table: "promotions", action: "delete", rowId: id, changes: { title: before.title } },
      ),
    );
  }

  // Reviews and photos -------------------------------------------------------------

  private reviews(state: DemoState): DemoReview[] {
    return state.reviews ?? demoReviews(new Date());
  }

  async stationReviews(stationId: string): Promise<StationReview[]> {
    const state = this.load();
    const me = state.profile?.id;
    return this.reviews(state)
      .filter((r) => r.stationId === stationId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({
        id: r.id,
        stationId: r.stationId,
        authorName: r.authorName,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt,
        isMine: !!me && r.userId === me,
      }));
  }

  async saveReview(stationId: string, input: ReviewInput) {
    const state = this.load();
    const profile = this.requireProfile(state);
    const review = cleanReview(input);
    if (!review) throw new BackendError("invalid_review");
    if (!this.activeStations(state).some((s) => s.id === stationId)) throw new BackendError("station_not_found");
    const others = this.reviews(state).filter((r) => !(r.stationId === stationId && r.userId === profile.id));
    this.save({
      ...state,
      reviews: [
        {
          id: crypto.randomUUID(),
          stationId,
          userId: profile.id,
          authorName: shortName(profile.fullName),
          ...review,
          createdAt: new Date().toISOString(),
        },
        ...others,
      ],
    });
  }

  async deleteReview(id: string) {
    const state = this.load();
    const profile = this.requireProfile(state);
    const review = this.reviews(state).find((r) => r.id === id);
    if (!review) return;
    if (review.userId !== profile.id && profile.role !== "admin") throw new BackendError("forbidden");
    const next = { ...state, reviews: this.reviews(state).filter((r) => r.id !== id) };
    this.save(
      review.userId === profile.id
        ? next
        : withAudit(next, {
            table: "stations",
            action: "update",
            rowId: review.stationId,
            stationId: review.stationId,
            changes: { review_removed: { rating: review.rating, comment: review.comment } },
          }),
    );
  }

  async uploadStationPhoto(file: File): Promise<string> {
    this.requireAdmin(this.load());
    if (file.size > MAX_PROMO_IMAGE_BYTES / 4) throw new BackendError("image_too_large");
    return readAsDataUrl(file);
  }

  /** The demo keeps images inline in browser storage, so they stay small. */
  async uploadPromotionImage(file: File): Promise<string> {
    this.requireAdmin(this.load());
    if (file.size > MAX_PROMO_IMAGE_BYTES / 4) throw new BackendError("image_too_large");
    return readAsDataUrl(file);
  }

  // Wallet ------------------------------------------------------------------------

  private wallet(state: DemoState): DemoWallet {
    return state.wallet ?? freshWallet();
  }

  private balance(w: DemoWallet, userId: string): number {
    return w.balances[userId] ?? DEMO_WALLET_START;
  }

  private walletAccess(state: DemoState): Profile {
    const profile = this.requireProfile(state);
    if (!this.wallet(state).enabled && profile.role !== "admin") throw new BackendError("wallet_disabled");
    return profile;
  }

  private findWalletUser(state: DemoState, contact: string): AdminUser {
    const parsed = parseContact(contact);
    if (!parsed) throw new BackendError(contact.includes("@") ? "invalid_contact" : "phone_not_allowed");
    const user = (state.users ?? demoUsers(new Date())).find((u) => (parsed.kind === "phone" ? u.phone : u.email) === parsed.value);
    if (!user) throw new BackendError("recipient_not_found");
    return user;
  }

  async myWallet(): Promise<WalletView> {
    const state = this.load();
    const profile = this.walletAccess(state);
    const w = this.wallet(state);
    const transfer = w.settings.find((s) => s.product === "transfer") ?? DEFAULT_FEE_SETTINGS[0];
    const mine = w.transactions.filter((t) => t.userId === profile.id);
    const { day, month } = periodStarts();
    const sent = mine.filter((t) => t.type === "transfer" && t.attribute === "send" && t.status === "success");
    const contact = profile.phone ?? profile.email;
    return {
      enabled: w.enabled,
      testMode: !w.enabled,
      balanceXof: this.balance(w, profile.id),
      frozen: w.frozen.includes(profile.id),
      transfer,
      usage: {
        todayXof: sent.filter((t) => t.createdAt >= day).reduce((n, t) => n + t.amountXof, 0),
        monthXof: sent.filter((t) => t.createdAt >= month).reduce((n, t) => n + t.amountXof, 0),
      },
      receiveCode: contact ? receivePayload(contact) : null,
      topupAvailable: true,
      cardTopupAvailable: true,
      transactions: mine.slice(0, 50),
    };
  }

  async findWalletRecipient(contact: string): Promise<WalletRecipient> {
    const state = this.load();
    const profile = this.walletAccess(state);
    const user = this.findWalletUser(state, contact);
    if (user.id === profile.id) throw new BackendError("self_transfer");
    return { label: personLabel(user) };
  }

  async sendMoney(input: SendMoneyInput): Promise<WalletTransaction> {
    const state = this.load();
    const profile = this.walletAccess(state);
    const w = this.wallet(state);
    const done = w.transactions.find((t) => t.userId === profile.id && t.key === input.idempotencyKey);
    if (done) return done;
    const amount = parseAmount(input.amountXof);
    if (amount === null) throw new BackendError("invalid_amount");
    const recipient = this.findWalletUser(state, input.contact);
    if (recipient.id === profile.id) throw new BackendError("self_transfer");
    const pinOf = state.pins?.[profile.phone ?? profile.email ?? ""];
    if (!validPinFormat(input.pin) || (pinOf !== undefined && pinOf !== input.pin)) throw new BackendError("invalid_pin");
    const view = await this.myWallet();
    if (!view.transfer.isActive) throw new BackendError("wallet_disabled");
    const problem = checkLimits(amount, view.transfer, view.usage);
    if (problem) throw new BackendError(problem);
    if (view.frozen) throw new BackendError("wallet_frozen");
    if (w.frozen.includes(recipient.id)) throw new BackendError("recipient_not_found");
    const fee = quoteFee(amount, view.transfer);
    const before = this.balance(w, profile.id);
    if (before < fee.payableXof) throw new BackendError("insufficient_balance");
    const after = before - fee.payableXof;
    const received = this.balance(w, recipient.id) + amount;
    const now = new Date().toISOString();
    const trxId = newTrxId("transfer");
    const remark = input.remark?.trim().slice(0, WALLET_REMARK_MAX) || null;
    const me = (state.users ?? []).find((u) => u.id === profile.id) ?? { ...profile };
    const send: DemoWallet["transactions"][number] = {
      id: crypto.randomUUID(),
      trxId,
      type: "transfer",
      attribute: "send",
      status: "success",
      amountXof: amount,
      feeXof: fee.feeXof,
      totalXof: fee.payableXof,
      balanceAfterXof: after,
      counterparty: personLabel(recipient),
      remark,
      createdAt: now,
      userId: profile.id,
      userLabel: [profile.fullName, profile.phone ?? profile.email].filter(Boolean).join(" · "),
      adminId: null,
      key: input.idempotencyKey,
    };
    const receive: DemoWallet["transactions"][number] = {
      ...send,
      id: crypto.randomUUID(),
      attribute: "received",
      feeXof: 0,
      totalXof: amount,
      balanceAfterXof: received,
      counterparty: personLabel(me),
      userId: recipient.id,
      userLabel: [recipient.fullName, recipient.phone ?? recipient.email].filter(Boolean).join(" · "),
      key: undefined,
    };
    this.save({
      ...state,
      wallet: {
        ...w,
        balances: { ...w.balances, [profile.id]: after, [recipient.id]: received },
        transactions: [send, receive, ...w.transactions].slice(0, 500),
      },
    });
    return send;
  }

  async adminWallet(filter: { type?: string; userId?: string } = {}): Promise<AdminWallet> {
    const state = this.load();
    this.requireAdmin(state);
    const w = this.wallet(state);
    const users = state.users ?? demoUsers(new Date());
    const ids = new Set([...users.map((u) => u.id), ...Object.keys(w.balances)]);
    return {
      enabled: w.enabled,
      settings: w.settings,
      totals: {
        balancesXof: [...ids].reduce((n, id) => n + this.balance(w, id), 0),
        wallets: ids.size,
        feesXof: w.transactions.filter((t) => t.status === "success").reduce((n, t) => n + t.feeXof, 0),
        transactions: new Set(w.transactions.map((t) => t.trxId)).size,
      },
      transactions: w.transactions
        .filter((t) => (!filter.type || t.type === filter.type) && (!filter.userId || t.userId === filter.userId))
        .map((t) => {
          const copy = { ...t };
          delete copy.key;
          return copy;
        }),
    };
  }

  async features(): Promise<Features> {
    return { parcels: this.load().parcelsEnabled !== false };
  }

  async setParcelsEnabled(enabled: boolean) {
    const state = this.load();
    this.requireAdmin(state);
    this.save(withAudit({ ...state, parcelsEnabled: enabled }, { table: "parcels", action: "update", rowId: "parcels_enabled", changes: { enabled } }));
  }

  async setWalletEnabled(enabled: boolean) {
    const state = this.load();
    this.requireAdmin(state);
    this.save(
      withAudit({ ...state, wallet: { ...this.wallet(state), enabled } }, { table: "wallets", action: "update", rowId: "wallet_enabled", changes: { enabled } }),
    );
  }

  async saveWalletFees(setting: WalletFeeSetting) {
    const state = this.load();
    this.requireAdmin(state);
    const s = validFeeSetting(setting);
    if (!s) throw new BackendError("unknown", "bad_request");
    const w = this.wallet(state);
    this.save(
      withAudit(
        { ...state, wallet: { ...w, settings: w.settings.map((x) => (x.product === s.product ? s : x)) } },
        { table: "wallets", action: "update", rowId: `fees:${s.product}`, changes: { ...s } },
      ),
    );
  }

  async startTopup(input: TopupInput): Promise<WalletTopup> {
    const state = this.load();
    const profile = this.walletAccess(state);
    const amount = parseAmount(input.amountXof);
    if (amount === null) throw new BackendError("invalid_amount");
    if (amount < TOPUP_MIN_XOF) throw new BackendError("amount_too_small");
    if (amount > TOPUP_MAX_XOF) throw new BackendError("amount_too_large");
    if (input.network !== "card" && !normalizeTogoPhone(input.phone ?? "")) throw new BackendError("phone_not_allowed");
    const topup: WalletTopup & { userId: string } = {
      id: crypto.randomUUID(),
      amountXof: amount,
      network: input.network,
      status: "pending",
      failureReason: null,
      createdAt: new Date().toISOString(),
      paidAt: null,
      userId: profile.id,
    };
    const w = this.wallet(state);
    this.save({ ...state, wallet: { ...w, topups: [topup, ...(w.topups ?? [])].slice(0, 100) } });
    // A card is paid on the provider's page; in the demo that "page" sends straight back.
    const checkoutUrl = input.network === "card" ? `${window.location.origin}/portefeuille?topup=${topup.id}` : null;
    return { ...demoTopupView(topup), checkoutUrl };
  }

  async refreshTopup(id: string): Promise<WalletTopup> {
    const state = this.load();
    const profile = this.walletAccess(state);
    const w = this.wallet(state);
    const topup = (w.topups ?? []).find((t) => t.id === id && t.userId === profile.id);
    if (!topup) throw new BackendError("unknown", "not_found");
    let done = topup;
    if (topup.status === "pending") {
      const now = new Date().toISOString();
      done = { ...topup, status: "succeeded", paidAt: now };
      const after = this.balance(w, profile.id) + topup.amountXof;
      const tx: AdminWalletTransaction = {
        id: crypto.randomUUID(),
        trxId: newTrxId("topup"),
        type: "topup",
        attribute: "received",
        status: "success",
        amountXof: topup.amountXof,
        feeXof: 0,
        totalXof: topup.amountXof,
        balanceAfterXof: after,
        counterparty: TOPUP_NETWORK_LABEL[topup.network],
        remark: null,
        createdAt: now,
        userId: profile.id,
        userLabel: [profile.fullName, profile.phone ?? profile.email].filter(Boolean).join(" · "),
        adminId: null,
      };
      this.save({
        ...state,
        wallet: {
          ...w,
          balances: { ...w.balances, [profile.id]: after },
          transactions: [tx, ...w.transactions].slice(0, 500),
          topups: (w.topups ?? []).map((t) => (t.id === id ? done : t)),
        },
      });
    }
    return demoTopupView(done);
  }

  async adjustWallet(input: WalletAdjustInput): Promise<WalletTransaction> {
    const state = this.load();
    this.requireAdmin(state);
    const amount = parseAmount(input.amountXof);
    if (amount === null) throw new BackendError("invalid_amount");
    const remark = input.remark.trim().slice(0, WALLET_REMARK_MAX);
    if (!remark) throw new BackendError("unknown", "bad_request");
    const user = this.findWalletUser(state, input.contact);
    const w = this.wallet(state);
    const after = this.balance(w, user.id) + (input.direction === "add" ? amount : -amount);
    if (after < 0) throw new BackendError("insufficient_balance");
    const tx: AdminWalletTransaction = {
      id: crypto.randomUUID(),
      trxId: newTrxId("admin_adjust"),
      type: "admin_adjust",
      attribute: input.direction === "add" ? "received" : "send",
      status: "success",
      amountXof: amount,
      feeXof: 0,
      totalXof: amount,
      balanceAfterXof: after,
      counterparty: null,
      remark,
      createdAt: new Date().toISOString(),
      userId: user.id,
      userLabel: [user.fullName, user.phone ?? user.email].filter(Boolean).join(" · "),
      adminId: state.profile?.id ?? null,
    };
    this.save(
      withAudit(
        { ...state, wallet: { ...w, balances: { ...w.balances, [user.id]: after }, transactions: [tx, ...w.transactions].slice(0, 500) } },
        { table: "wallets", action: "insert", rowId: tx.id, userId: user.id, changes: { direction: input.direction, amount_xof: amount, remark } },
      ),
    );
    return tx;
  }

  async setWalletFrozen(contact: string, frozen: boolean) {
    const state = this.load();
    this.requireAdmin(state);
    const user = this.findWalletUser(state, contact);
    const w = this.wallet(state);
    const list = w.frozen.filter((id) => id !== user.id);
    this.save(
      withAudit(
        { ...state, wallet: { ...w, frozen: frozen ? [...list, user.id] : list } },
        { table: "wallets", action: "update", rowId: user.id, userId: user.id, changes: { status: frozen ? "frozen" : "active" } },
      ),
    );
  }

  // greenpoint (demo) ----------------------------------------------------------

  private gp(state: DemoState): DemoGreenpoint {
    const g = state.greenpoint ?? freshGreenpoint();
    // Demo states saved before driver trips counted lack the km factors.
    return { ...g, factors: validFactors(g.factors) ?? DEFAULT_FACTORS };
  }

  /** The driver's CO2 and greenpoints for a finished trip (as tripStatement in the Worker). */
  private tripGreenpoint(state: DemoState, driverId: string, job: DemoJob, stationId: string | null): DemoGreenpoint {
    const g = this.gp(state);
    const driver = (state.drivers ?? []).find((d) => d.userId === driverId);
    const vehicle = (state.fleet ?? seedFleet()).find((v) => v.id === driver?.vehicleId);
    if (!vehicle || g.ledger.some((l) => l.jobId === job.id)) return g;
    const grams = tripGrams(job.distanceM, vehicle.type, g.factors);
    const entry = {
      id: crypto.randomUUID(),
      userId: driverId,
      reservationId: null,
      jobId: job.id,
      kind: "delivery" as const,
      co2Grams: grams,
      points: pointsFor(grams),
      vehicle: null,
      stationName: state.stations.find((s) => s.id === stationId)?.name ?? null,
      rewardTitle: null,
      createdAt: new Date().toISOString(),
    };
    return { ...g, ledger: [entry, ...g.ledger].slice(0, 500) };
  }

  /** Adds a swap or charge to the ledger, unless the daily limit is reached (as earnStatement in the Worker). */
  private earn(
    state: DemoState,
    input: { userId: string; type: ReservationType; stationId: string; reservationId: string | null; vehicle?: VehicleType },
  ): DemoState {
    const g = this.gp(state);
    const today = dayStart();
    const earnedToday = g.ledger.filter((l) => l.userId === input.userId && l.points > 0 && l.kind !== "admin_adjust" && l.createdAt >= today).length;
    if (earnedToday >= MAX_EARNINGS_PER_DAY) return state;
    // Drivers on one of our vehicles earn per km instead.
    if ((state.drivers ?? []).some((d) => d.userId === input.userId && d.status === "active" && d.vehicleId)) return state;
    if (input.reservationId && g.ledger.some((l) => l.reservationId === input.reservationId)) return state;
    const vehicle = input.vehicle ?? g.vehicles[input.userId] ?? "scooter";
    const grams = g.factors.batteryGrams[vehicle];
    const entry = {
      id: crypto.randomUUID(),
      userId: input.userId,
      reservationId: input.reservationId,
      kind: input.reservationId ? (input.type === "battery" ? ("swap" as const) : ("charge" as const)) : ("visit" as const),
      co2Grams: grams,
      points: pointsFor(grams),
      vehicle,
      stationName: state.stations.find((s) => s.id === input.stationId)?.name ?? null,
      rewardTitle: null,
      createdAt: new Date().toISOString(),
    };
    return { ...state, greenpoint: { ...g, ledger: [entry, ...g.ledger].slice(0, 500) } };
  }

  private gpTotals(g: DemoGreenpoint, userId: string) {
    const mine = g.ledger.filter((l) => l.userId === userId);
    return { grams: mine.reduce((n, l) => n + l.co2Grams, 0), points: mine.reduce((n, l) => n + l.points, 0) };
  }

  private openCode(g: DemoGreenpoint, userId: string) {
    const now = new Date().toISOString();
    return g.redemptions.find((r) => r.userId === userId && r.status === "open" && r.expiresAt > now) ?? null;
  }

  async myGreenpoint(): Promise<GreenpointView> {
    const state = this.load();
    const profile = this.requireProfile(state);
    const g = this.gp(state);
    const { grams, points } = this.gpTotals(g, profile.id);
    const open = this.openCode(g, profile.id);
    return {
      co2Grams: grams,
      points,
      level: levelFor(grams),
      next: nextLevel(grams),
      trees: treesFor(grams),
      vehicle: g.vehicles[profile.id] ?? "scooter",
      redemption: open ? { id: open.id, code: open.code, rewardTitle: open.rewardTitle, costPoints: open.costPoints, expiresAt: open.expiresAt } : null,
      rewards: g.rewards.filter((r) => rewardAvailable(r)).sort((a, b) => a.costPoints - b.costPoints),
      history: g.ledger.filter((l) => l.userId === profile.id).slice(0, 50),
    };
  }

  async setGreenpointVehicle(vehicle: VehicleType) {
    const state = this.load();
    const profile = this.requireProfile(state);
    const g = this.gp(state);
    this.save({ ...state, greenpoint: { ...g, vehicles: { ...g.vehicles, [profile.id]: vehicle } } });
  }

  async startRedemption(rewardId: string): Promise<GreenpointRedemption> {
    const state = this.load();
    const profile = this.requireProfile(state);
    const g = this.gp(state);
    const reward = g.rewards.find((r) => r.id === rewardId);
    if (!reward || !rewardAvailable(reward)) throw new BackendError("reward_unavailable");
    if (this.openCode(g, profile.id)) throw new BackendError("redemption_open");
    if (this.gpTotals(g, profile.id).points < reward.costPoints) throw new BackendError("not_enough_points");
    const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    const redemption = {
      id: crypto.randomUUID(),
      code,
      rewardTitle: reward.title,
      costPoints: reward.costPoints,
      expiresAt: new Date(Date.now() + REDEEM_CODE_MINUTES * 60_000).toISOString(),
      userId: profile.id,
      rewardId,
      status: "open" as const,
    };
    // Expired codes of this person are closed, so only one is ever open.
    const others = g.redemptions.map((r) => (r.userId === profile.id && r.status === "open" ? { ...r, status: "cancelled" as const } : r));
    this.save({ ...state, greenpoint: { ...g, redemptions: [redemption, ...others].slice(0, 200) } });
    return { id: redemption.id, code, rewardTitle: reward.title, costPoints: reward.costPoints, expiresAt: redemption.expiresAt };
  }

  async cancelRedemption(id: string) {
    const state = this.load();
    const profile = this.requireProfile(state);
    const g = this.gp(state);
    this.save({
      ...state,
      greenpoint: {
        ...g,
        redemptions: g.redemptions.map((r) => (r.id === id && r.userId === profile.id && r.status === "open" ? { ...r, status: "cancelled" as const } : r)),
      },
    });
  }

  async recordGreenpointVisit(stationId: string, input: { contact: string; service: "swap" | "charge"; vehicle?: VehicleType }): Promise<GreenpointReceipt> {
    const state = this.load();
    const profile = this.requireStaff(state);
    const station = state.stations.find((s) => s.id === stationId);
    if (!station) throw new BackendError("station_not_found");
    const offered = input.service === "swap" ? offersSwap(station.kind) : offersCharging(station.kind);
    if (!offered) throw new BackendError("service_not_offered");
    const rider = this.findWalletUser(state, input.contact);
    if (rider.id === profile.id) throw new BackendError("own_reservation");
    const next = this.earn(state, {
      userId: rider.id,
      type: input.service === "swap" ? "battery" : "slot",
      stationId,
      reservationId: null,
      vehicle: input.vehicle,
    });
    if (next === state) throw new BackendError("greenpoint_daily_limit");
    this.save(next);
    const entry = this.gp(next).ledger[0];
    return { person: personLabel(rider), co2Grams: entry.co2Grams, points: entry.points, rewardTitle: null };
  }

  async confirmRedemption(stationId: string, code: string): Promise<GreenpointReceipt> {
    const state = this.load();
    const profile = this.requireStaff(state);
    const g = this.gp(state);
    const now = new Date().toISOString();
    const r = g.redemptions.find((x) => x.code === code.trim() && x.status === "open" && x.expiresAt > now);
    if (!r) throw new BackendError("invalid_code");
    if (r.userId === profile.id) throw new BackendError("own_reservation");
    if (this.gpTotals(g, r.userId).points < r.costPoints) throw new BackendError("not_enough_points");
    const entry = {
      id: crypto.randomUUID(),
      userId: r.userId,
      reservationId: null,
      kind: "redeem" as const,
      co2Grams: 0,
      points: -r.costPoints,
      vehicle: null,
      stationName: state.stations.find((s) => s.id === stationId)?.name ?? null,
      rewardTitle: r.rewardTitle,
      createdAt: now,
    };
    this.save({
      ...state,
      greenpoint: {
        ...g,
        ledger: [entry, ...g.ledger].slice(0, 500),
        redemptions: g.redemptions.map((x) => (x.id === r.id ? { ...x, status: "used" as const } : x)),
        rewards: g.rewards.map((w) => (w.id === r.rewardId && w.stock !== null ? { ...w, stock: Math.max(0, w.stock - 1) } : w)),
      },
    });
    const rider = (state.users ?? []).find((u) => u.id === r.userId);
    return { person: rider ? personLabel(rider) : "?", co2Grams: 0, points: -r.costPoints, rewardTitle: r.rewardTitle };
  }

  async adminGreenpoint(): Promise<AdminGreenpoint> {
    const state = this.load();
    this.requireAdmin(state);
    const g = this.gp(state);
    const users = state.users ?? [];
    return {
      factors: g.factors,
      rewards: g.rewards,
      totals: {
        co2Grams: g.ledger.reduce((n, l) => n + l.co2Grams, 0),
        pointsEarned: g.ledger.reduce((n, l) => n + Math.max(0, l.points), 0),
        pointsRedeemed: g.ledger.filter((l) => l.kind === "redeem").reduce((n, l) => n - l.points, 0),
        members: new Set(g.ledger.map((l) => l.userId)).size,
      },
      recent: g.ledger.slice(0, 100).map((l) => {
        const u = users.find((x) => x.id === l.userId) ?? (state.profile?.id === l.userId ? state.profile : null);
        return { ...l, person: u ? personLabel(u) : "?" };
      }),
    };
  }

  async saveGreenpointFactors(factors: GreenpointFactors) {
    const state = this.load();
    this.requireAdmin(state);
    const valid = validFactors(factors);
    if (!valid) throw new BackendError("unknown", "bad_request");
    this.save({ ...state, greenpoint: { ...this.gp(state), factors: valid } });
  }

  async saveGreenpointReward(id: string | null, input: GreenpointRewardInput) {
    const state = this.load();
    this.requireAdmin(state);
    const valid = validRewardInput(input);
    if (!valid) throw new BackendError("unknown", "bad_request");
    const g = this.gp(state);
    const rewards = id ? g.rewards.map((r) => (r.id === id ? { ...valid, id } : r)) : [...g.rewards, { ...valid, id: crypto.randomUUID() }];
    this.save({ ...state, greenpoint: { ...g, rewards } });
  }
}

/** Full batteries per type at a station; until staff count them, the total spread evenly over its types. */
function typeCounts(state: DemoState, stationId: string, total: number): Record<string, number> {
  const stored = state.typeBatteries?.[stationId];
  if (stored) return stored;
  const swapped = (state.stationBatteryTypes ?? DEMO_STATION_BATTERY_TYPES)[stationId] ?? [];
  const share = Math.floor(total / Math.max(1, swapped.length));
  return Object.fromEntries(swapped.map((id, i) => [id, share + (i === 0 ? total - share * swapped.length : 0)]));
}
