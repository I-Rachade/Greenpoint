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
} from "../types";
import { BackendError, type Backend, type CodeChannel, type StatusPatch } from "./backend";
import { DEMO_CHARGING_POINTS, DEMO_OPERATORS, DEMO_STATIONS, initialDemoStatus } from "./demo-data";
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
import { MAX_PROMO_IMAGE_BYTES, pickPromotion, type Promotion, type PromotionInput } from "../promo";
import {
  DEFAULT_PARCEL_SIZES,
  newTrackingNo,
  PARCEL_CODE_LOCK_MINUTES,
  PARCEL_MAX_CODE_FAILURES,
  PARCEL_PICKUP_DAYS,
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
import { parseContact } from "../contact";
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
import { canSwitch, normalizeDeviceId, outletLabel, validDeviceInput, type Device, type DeviceInput } from "../iot/devices";

const STORAGE_KEY = "poinderecharge-demo-v3";
/** Every demo registration accepts this SMS code. */
export const DEMO_CODE = "123456";
/**
 * True when this build was made by Cloudflare (see next.config.ts) but set to the
 * demo backend. Visitors then see a clear notice and can only try the rider view.
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
  parcelSizes?: ParcelSizeTier[];
  parcelCodeFailures?: { stationId: string; at: string }[];
  /** Partner API: partners and bookings waiting for drop-off (demo only, no API calls). */
  partners?: Partner[];
  bookings?: (StationBooking & { partnerId: string; fromStationId: string })[];
  /** Wallet (demo only: switched on, everyone starts with DEMO_WALLET_START francs). */
  wallet?: DemoWallet;
  /** Demo PINs by phone number or e-mail address (stored in clear: demo only). */
  pins?: Record<string, string>;
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
  ];
}

/** Depots at four own stations, so parcels can be tried right away. */
function seedDepots(): ParcelDepot[] {
  return ["st-grand-marche", "st-tokoin", "st-universite", "st-be"].map((stationId) => ({
    stationId,
    isActive: true,
    note: "au comptoir",
    lockers: 0,
  }));
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
      return { ...s, status, reservedSlots: held.slots, reservedBatteries: held.batteries, chargingPoints };
    });
  }

  private requireProfile(state: DemoState): Profile {
    if (!state.profile) throw new BackendError("not_authenticated");
    return state.profile;
  }

  async listStations() {
    const state = this.load();
    return this.views(state, this.activeStations(state));
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

  async getProfile() {
    return this.load().profile;
  }

  onAuthChange(callback: (profile: Profile | null) => void) {
    return this.subscribe(() => callback(this.load().profile));
  }

  async sendCode() {
    // Nothing is sent in demo mode; the code is always DEMO_CODE.
  }

  async register(contact: string, code: string, pin: string, demoRole: UserRole = "rider") {
    if (!validPinFormat(pin)) throw new BackendError("bad_pin");
    if (weakPin(pin)) throw new BackendError("weak_pin");
    if (code.trim() !== DEMO_CODE) throw new BackendError("invalid_code");
    const state = this.load();
    this.save({ ...state, pins: { ...state.pins, [contact]: pin } });
    return this.signInAs(contact, demoRole);
  }

  async signIn(contact: string, pin: string, demoRole: UserRole = "rider") {
    if (!validPinFormat(pin) || this.load().pins?.[contact] !== pin) throw new BackendError("invalid_pin");
    return this.signInAs(contact, demoRole);
  }

  private signInAs(contact: string, demoRole: UserRole) {
    if (HOSTED_DEMO && demoRole !== "rider") throw new BackendError("forbidden");
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
    if (profile.role !== "operator" && profile.role !== "admin") throw new BackendError("forbidden");
    // Demo staff run every own station; admins see all.
    const active = this.activeStations(state);
    const stations = profile.role === "admin" ? active : active.filter((s) => s.isOwn);
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
    const statuses = state.statuses.map((s) =>
      s.stationId === stationId
        ? {
            ...s,
            ...patch,
            freeSlots: Math.max(0, patch.freeSlots ?? s.freeSlots),
            fullBatteries: Math.max(0, patch.fullBatteries ?? s.fullBatteries),
            updatedAt: new Date().toISOString(),
          }
        : s,
    );
    const before = state.statuses.find((s) => s.stationId === stationId);
    const after = statuses.find((s) => s.stationId === stationId);
    const changes = before && after ? diff(before, after) : {};
    this.save(
      Object.keys(changes).length
        ? withAudit({ ...state, statuses, reservations }, { table: "station_status", action: "update", rowId: stationId, stationId, changes })
        : { ...state, statuses, reservations },
    );
  }

  async stationReservations(stationId: string) {
    // Staff never see the pickup code; the rider shows it.
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
      ...state,
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
    const station: Station = {
      ...input,
      id: id ?? crypto.randomUUID(),
      operatorName: operator.name,
      isOwn: operator.isOwn,
    };
    if (id) {
      const before = state.stations.find((s) => s.id === id);
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
        freeSlots: station.chargingSlots,
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
    this.save(
      withAudit(
        { ...state, users: users.map((u) => (u.id === userId ? { ...u, role } : u)) },
        { table: "profiles", action: "update", rowId: userId, userId, changes: { role: [before.role, role] } },
      ),
    );
  }

  async assignStaff(stationId: string, userId: string) {
    const state = this.load();
    this.requireAdmin(state);
    const staff = state.staff ?? DEMO_STAFF;
    if (staff.some((a) => a.stationId === stationId && a.userId === userId)) return;
    this.save(
      withAudit(
        {
          ...state,
          staff: [...staff, { stationId, userId }],
          // The role follows the assignment, like sync_staff_role() in SQL.
          users: (state.users ?? demoUsers(new Date())).map((u) =>
            u.id === userId && u.role === "rider" ? { ...u, role: "operator" as const } : u,
          ),
        },
        { table: "station_staff", action: "insert", rowId: `${stationId}:${userId}`, stationId, userId, changes: {} },
      ),
    );
  }

  async unassignStaff(stationId: string, userId: string) {
    const state = this.load();
    this.requireAdmin(state);
    const staff = (state.staff ?? DEMO_STAFF).filter((a) => !(a.stationId === stationId && a.userId === userId));
    const stillStaff = staff.some((a) => a.userId === userId);
    const users = (state.users ?? demoUsers(new Date())).map((u) =>
      u.id === userId && u.role === "operator" && !stillStaff ? { ...u, role: "rider" as const } : u,
    );
    this.save(
      withAudit(
        { ...state, staff, users },
        { table: "station_staff", action: "delete", rowId: `${stationId}:${userId}`, stationId, userId, changes: {} },
      ),
    );
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
    this.save(
      withAudit(
        { ...state, devices: [device, ...devices] },
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
    if (!canSwitch(externalId)) throw new BackendError("forbidden");
    const devices = (state.devices ?? seedDevices()).map((d) =>
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
      role: "rider",
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
    };
    this.saveParcels(state, [parcel, ...this.parcelsOf(state)], {
      table: "parcels",
      action: "insert",
      rowId: parcel.id,
      stationId,
      userId: sender.userId,
      changes: { tracking_no: parcel.trackingNo, to_station_id: parcel.toStationId, size: tier.size, price_fcfa: tier.priceFcfa, created_by: staff.id },
    });
    return parcel;
  }

  async markParcelsInTransit(stationId: string, ids: string[]) {
    const state = this.load();
    this.requireStaff(state);
    const parcels = this.parcelsOf(state);
    const chosen = parcels.filter((p) => ids.includes(p.id));
    if (chosen.length !== ids.length || chosen.some((p) => p.fromStationId !== stationId || p.status !== "deposited")) {
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
    if (chosen.length !== ids.length || chosen.some((p) => p.toStationId !== stationId || p.status !== "in_transit")) {
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
    const input = parsePickupInput(codeOrQr);
    const parcels = this.parcelsOf(state);
    const parcel = input
      ? parcels.find(
          (p) =>
            p.toStationId === stationId &&
            p.status === "arrived" &&
            p.pickupCode === input.code &&
            (!input.trackingNo || p.trackingNo === input.trackingNo),
        )
      : undefined;
    if (!parcel) {
      this.save({ ...state, parcelCodeFailures: [...failures, { stationId, at: new Date().toISOString() }] });
      throw new BackendError("wrong_pickup_code");
    }
    const done: Parcel = { ...parcel, status: "picked_up", pickedUpAt: new Date().toISOString(), pickupCode: undefined };
    this.saveParcels(
      state,
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
    if (!state.stations.some((s) => s.id === stationId)) throw new BackendError("station_not_found");
    const depots = state.parcelDepots ?? seedDepots();
    const before = depots.find((d) => d.stationId === stationId);
    const depot: ParcelDepot = { stationId, isActive: input.isActive, note: input.note.trim().slice(0, 200), lockers: Math.max(0, Math.floor(input.lockers)) };
    this.save(
      withAudit(
        { ...state, parcelDepots: [...depots.filter((d) => d.stationId !== stationId), depot] },
        {
          table: "parcel_depots",
          action: before ? "update" : "insert",
          rowId: stationId,
          stationId,
          changes: before ? diff(before, depot) : { is_active: depot.isActive, note: depot.note, lockers: depot.lockers },
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
}
