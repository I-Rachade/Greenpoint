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
import { DEMO_OPERATORS, DEMO_STATIONS, initialDemoStatus } from "./demo-data";
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
  /** Demo PINs by phone number or e-mail address (stored in clear: demo only). */
  pins?: Record<string, string>;
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
    return stations.map((s) => {
      let status = state.statuses.find((st) => st.stationId === s.id)!;
      // Pretend staff report regularly, so an old demo session does not turn grey.
      if (Date.now() - new Date(status.updatedAt).getTime() > STALE_STATUS_HOURS * 3_600_000) {
        status = { ...status, updatedAt: new Date().toISOString() };
      }
      const held = countHolding(state.reservations, s.id);
      return { ...s, status, reservedSlots: held.slots, reservedBatteries: held.batteries };
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
}
