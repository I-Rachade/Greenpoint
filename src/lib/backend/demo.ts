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
import { BackendError, type Backend, type StatusPatch } from "./backend";
import { DEMO_OPERATORS, DEMO_STATIONS, initialDemoStatus } from "./demo-data";

const STORAGE_KEY = "poinderecharge-demo-v3";
/** Every demo login accepts this code. */
export const DEMO_CODE = "123456";
/**
 * True when this build was made by Cloudflare (see next.config.ts) and still has
 * no Supabase keys. Visitors then see a clear notice and can only try the rider view.
 */
export const HOSTED_DEMO = process.env.NEXT_PUBLIC_HOSTED_BUILD === "1";

function pickupCode(): string {
  return String(Math.floor(Math.random() * 10_000)).padStart(4, "0");
}

interface DemoState {
  operators: Operator[];
  stations: Station[];
  statuses: StationStatus[];
  reservations: Reservation[];
  profile: Profile | null;
}

function freshState(): DemoState {
  return {
    operators: DEMO_OPERATORS,
    stations: DEMO_STATIONS,
    statuses: initialDemoStatus(new Date().toISOString()),
    reservations: [],
    profile: null,
  };
}

/**
 * Runs the whole app inside the browser with example data, so it can be tried
 * before Supabase is set up. Changes sync live between tabs of the same browser
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
    return this.views(state, state.stations);
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

  async verifyCode(phone: string, code: string, demoRole: UserRole = "rider") {
    if (code.trim() !== DEMO_CODE) throw new BackendError("invalid_code");
    if (HOSTED_DEMO && demoRole !== "rider") throw new BackendError("forbidden");
    const state = this.load();
    const profile: Profile = { id: `demo-${demoRole}`, phone, fullName: null, role: demoRole };
    this.save({ ...state, profile });
    return profile;
  }

  async signOut() {
    this.save({ ...this.load(), profile: null });
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
    this.save({ ...state, reservations: [...state.reservations, reservation] });
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
    const stations = profile.role === "admin" ? state.stations : state.stations.filter((s) => s.isOwn);
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
    this.save({ ...state, statuses, reservations });
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
      this.save({ ...state, stations: state.stations.map((s) => (s.id === id ? station : s)) });
    } else {
      const status: StationStatus = {
        stationId: station.id,
        isOpen: true,
        freeSlots: station.chargingSlots,
        fullBatteries: station.batteryCapacity,
        updatedAt: new Date().toISOString(),
      };
      this.save({ ...state, stations: [...state.stations, station], statuses: [...state.statuses, status] });
    }
  }

  /** Restores the example data (used by the "reset demo" button). */
  reset() {
    const profile = this.load().profile;
    this.save({ ...freshState(), profile });
  }

  private setReservationStatus(id: string, status: Reservation["status"]) {
    const state = this.load();
    this.save({
      ...state,
      reservations: state.reservations.map((r) => (r.id === id ? { ...r, status } : r)),
    });
  }
}
