import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  Operator,
  Profile,
  Reservation,
  ReservationType,
  StationInput,
  StationView,
  UserRole,
  VehicleType,
  StationKind,
} from "../types";
import { BackendError, type Backend, type BackendErrorCode, type StatusPatch } from "./backend";

// Row shapes as returned by Supabase (snake_case).
interface StationRow {
  id: string;
  operator_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  kind: StationKind;
  vehicle_types: VehicleType[];
  charging_slots: number;
  battery_capacity: number;
  opening_hours: string;
  phone: string | null;
  operators: { name: string; is_own: boolean } | null;
  station_status: { is_open: boolean; free_slots: number; full_batteries: number; updated_at: string } | null;
}

interface ReservationRow {
  id: string;
  user_id: string;
  station_id: string;
  type: ReservationType;
  status: Reservation["status"];
  created_at: string;
  expires_at: string;
}

interface HoldRow {
  station_id: string;
  reserved_slots: number;
  reserved_batteries: number;
}

const STATION_SELECT =
  "id, operator_id, name, address, lat, lng, kind, vehicle_types, charging_slots, battery_capacity, opening_hours, phone, operators(name, is_own), station_status(is_open, free_slots, full_batteries, updated_at)";

const KNOWN_CODES: BackendErrorCode[] = [
  "not_authenticated",
  "already_reserved",
  "station_not_found",
  "station_closed",
  "service_not_offered",
  "none_available",
];

function fail(error: { message: string; code?: string } | null): never {
  const message = error?.message ?? "unknown";
  const code = KNOWN_CODES.find((c) => message.includes(c));
  if (code) throw new BackendError(code, message);
  if (error?.code === "42501") throw new BackendError("forbidden", message);
  if (/token|otp|expired/i.test(message)) throw new BackendError("invalid_code", message);
  throw new BackendError("unknown", message);
}

function toReservation(r: ReservationRow): Reservation {
  return {
    id: r.id,
    userId: r.user_id,
    stationId: r.station_id,
    type: r.type,
    status: r.status,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  };
}

function toStationView(row: StationRow, holds: Map<string, HoldRow>): StationView {
  const hold = holds.get(row.id);
  const st = row.station_status;
  return {
    id: row.id,
    operatorId: row.operator_id,
    operatorName: row.operators?.name ?? "",
    isOwn: row.operators?.is_own ?? false,
    name: row.name,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    kind: row.kind,
    vehicleTypes: row.vehicle_types,
    chargingSlots: row.charging_slots,
    batteryCapacity: row.battery_capacity,
    openingHours: row.opening_hours,
    phone: row.phone,
    status: {
      stationId: row.id,
      isOpen: st?.is_open ?? false,
      freeSlots: st?.free_slots ?? 0,
      fullBatteries: st?.full_batteries ?? 0,
      updatedAt: st?.updated_at ?? new Date(0).toISOString(),
    },
    reservedSlots: hold?.reserved_slots ?? 0,
    reservedBatteries: hold?.reserved_batteries ?? 0,
  };
}

/** Production backend: Supabase Postgres + Auth (phone OTP) + Realtime. */
export class SupabaseBackend implements Backend {
  readonly mode = "supabase" as const;
  private client: SupabaseClient;

  constructor(url: string, anonKey: string) {
    this.client = createClient(url, anonKey);
  }

  private async holds(): Promise<Map<string, HoldRow>> {
    const { data, error } = await this.client.from("station_holds").select("*");
    if (error) fail(error);
    return new Map((data as HoldRow[]).map((h) => [h.station_id, h]));
  }

  private async stationsWhere(ids?: string[]): Promise<StationView[]> {
    let query = this.client.from("stations").select(STATION_SELECT).eq("is_active", true).order("name");
    if (ids) query = query.in("id", ids);
    const [{ data, error }, holds] = await Promise.all([query, this.holds()]);
    if (error) fail(error);
    return (data as unknown as StationRow[]).map((row) => toStationView(row, holds));
  }

  private async userId(): Promise<string> {
    const { data } = await this.client.auth.getUser();
    if (!data.user) throw new BackendError("not_authenticated");
    return data.user.id;
  }

  listStations() {
    return this.stationsWhere();
  }

  subscribe(onChange: () => void) {
    const channel = this.client
      .channel(`pointderecharge-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "station_status" }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "reservations" }, onChange)
      .subscribe();
    // Riders only receive their own reservation events (row level security),
    // so poll as well to pick up other riders' holds and expiries.
    const timer = window.setInterval(onChange, 30_000);
    return () => {
      window.clearInterval(timer);
      void this.client.removeChannel(channel);
    };
  }

  async getProfile(): Promise<Profile | null> {
    const { data: auth } = await this.client.auth.getUser();
    if (!auth.user) return null;
    const { data, error } = await this.client
      .from("profiles")
      .select("id, phone, full_name, role")
      .eq("id", auth.user.id)
      .single();
    if (error) fail(error);
    return { id: data.id, phone: data.phone, fullName: data.full_name, role: data.role as UserRole };
  }

  onAuthChange(callback: (profile: Profile | null) => void) {
    const { data } = this.client.auth.onAuthStateChange(() => {
      // Defer: calling Supabase inside the auth callback can deadlock.
      setTimeout(() => {
        this.getProfile().then(callback, () => callback(null));
      }, 0);
    });
    return () => data.subscription.unsubscribe();
  }

  async sendCode(phone: string) {
    const { error } = await this.client.auth.signInWithOtp({ phone });
    if (error) fail(error);
  }

  async verifyCode(phone: string, code: string) {
    const { error } = await this.client.auth.verifyOtp({ phone, token: code.trim(), type: "sms" });
    if (error) fail(error);
    const profile = await this.getProfile();
    if (!profile) throw new BackendError("not_authenticated");
    return profile;
  }

  async signOut() {
    await this.client.auth.signOut();
  }

  async myReservations() {
    const { data: auth } = await this.client.auth.getUser();
    if (!auth.user) return [];
    const { data, error } = await this.client
      .from("reservations")
      .select("*")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) fail(error);
    return (data as ReservationRow[]).map(toReservation);
  }

  async reserve(stationId: string, type: ReservationType) {
    const { data, error } = await this.client.rpc("reserve", { p_station: stationId, p_type: type });
    if (error) fail(error);
    return toReservation(data as ReservationRow);
  }

  async cancelReservation(id: string) {
    const { error } = await this.client.from("reservations").update({ status: "cancelled" }).eq("id", id);
    if (error) fail(error);
  }

  async staffStations() {
    const uid = await this.userId();
    const profile = await this.getProfile();
    if (profile?.role === "admin") return this.stationsWhere();
    const { data, error } = await this.client.from("station_staff").select("station_id").eq("user_id", uid);
    if (error) fail(error);
    const ids = (data as { station_id: string }[]).map((r) => r.station_id);
    return ids.length ? this.stationsWhere(ids) : [];
  }

  async updateStatus(stationId: string, patch: StatusPatch) {
    const row: Record<string, unknown> = {};
    if (patch.isOpen !== undefined) row.is_open = patch.isOpen;
    if (patch.freeSlots !== undefined) row.free_slots = Math.max(0, patch.freeSlots);
    if (patch.fullBatteries !== undefined) row.full_batteries = Math.max(0, patch.fullBatteries);
    const { data, error } = await this.client
      .from("station_status")
      .update(row)
      .eq("station_id", stationId)
      .select("station_id");
    if (error) fail(error);
    if (!data?.length) throw new BackendError("forbidden");
  }

  async stationReservations(stationId: string) {
    const { data, error } = await this.client
      .from("reservations")
      .select("*")
      .eq("station_id", stationId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) fail(error);
    return (data as ReservationRow[]).map(toReservation);
  }

  async completeReservation(id: string) {
    const { error } = await this.client.from("reservations").update({ status: "completed" }).eq("id", id);
    if (error) fail(error);
  }

  async listOperators(): Promise<Operator[]> {
    const { data, error } = await this.client.from("operators").select("id, name, is_own").order("name");
    if (error) fail(error);
    return (data as { id: string; name: string; is_own: boolean }[]).map((o) => ({
      id: o.id,
      name: o.name,
      isOwn: o.is_own,
    }));
  }

  async saveStation(id: string | null, input: StationInput) {
    const row = {
      operator_id: input.operatorId,
      name: input.name,
      address: input.address,
      lat: input.lat,
      lng: input.lng,
      kind: input.kind,
      vehicle_types: input.vehicleTypes,
      charging_slots: input.chargingSlots,
      battery_capacity: input.batteryCapacity,
      opening_hours: input.openingHours,
      phone: input.phone,
    };
    const { error } = id
      ? await this.client.from("stations").update(row).eq("id", id)
      : await this.client.from("stations").insert(row);
    if (error) fail(error);
  }
}
