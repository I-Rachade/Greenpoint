import type { AdminSnapshot, AuditEntry, AuditFilter } from "../admin/types";
import type { Promotion, PromotionInput } from "../promo";
import type {
  Operator,
  Profile,
  Reservation,
  ReservationType,
  StationInput,
  StationView,
  UserRole,
} from "../types";
import { BackendError, type Backend, type BackendErrorCode, type StatusPatch } from "./backend";

const TOKEN_KEY = "poinderecharge-session";
/** How often open pages reload station data (other riders' holds, staff updates). */
const POLL_MS = 15_000;

const KNOWN_CODES: BackendErrorCode[] = [
  "not_authenticated",
  "already_reserved",
  "station_not_found",
  "station_closed",
  "service_not_offered",
  "none_available",
  "daily_limit",
  "cooldown",
  "wrong_pickup_code",
  "own_reservation",
  "reservation_not_active",
  "phone_not_allowed",
  "invalid_code",
  "invalid_pin",
  "pin_locked",
  "bad_pin",
  "weak_pin",
  "image_too_large",
  "rate_limited",
  "forbidden",
];

/**
 * Production backend: the API of the Cloudflare Worker (worker/), with its D1
 * database and R2 images. The web app calls it on its own domain; the mobile
 * app sets NEXT_PUBLIC_API_URL to https://app.poinderecharge.com.
 */
export class CloudflareBackend implements Backend {
  readonly mode = "cloudflare" as const;
  private listeners = new Set<() => void>();
  private authListeners = new Set<(profile: Profile | null) => void>();
  private memoryToken: string | null = null;

  constructor(private apiBase = "") {}

  private get token(): string | null {
    try {
      return window.localStorage.getItem(TOKEN_KEY) ?? this.memoryToken;
    } catch {
      return this.memoryToken;
    }
  }

  private set token(value: string | null) {
    this.memoryToken = value;
    try {
      if (value) window.localStorage.setItem(TOKEN_KEY, value);
      else window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Storage blocked: the session lasts as long as the page.
    }
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    const token = this.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload: BodyInit | undefined;
    if (body instanceof Blob) {
      headers["Content-Type"] = body.type;
      payload = body;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    let res: Response;
    try {
      res = await fetch(`${this.apiBase}${path}`, { method, headers, body: payload });
    } catch {
      throw new BackendError("unknown", "network");
    }
    const data = (await res.json().catch(() => null)) as T & { error?: string };
    if (!res.ok) {
      const code = KNOWN_CODES.find((c) => c === data?.error) ?? "unknown";
      if (code === "not_authenticated" && token) this.dropSession();
      throw new BackendError(code, data?.error);
    }
    return data;
  }

  /** Reloads every open view after a change made here. */
  private changed() {
    this.listeners.forEach((fn) => fn());
  }

  private dropSession() {
    this.token = null;
    this.authListeners.forEach((fn) => fn(null));
  }

  // Stations --------------------------------------------------------------------

  listStations() {
    return this.call<StationView[]>("GET", "/api/stations");
  }

  subscribe(onChange: () => void) {
    this.listeners.add(onChange);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") onChange();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && onChange();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      this.listeners.delete(onChange);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }

  // Auth ------------------------------------------------------------------------

  async getProfile(): Promise<Profile | null> {
    if (!this.token) return null;
    return this.call<Profile | null>("GET", "/api/me");
  }

  onAuthChange(callback: (profile: Profile | null) => void) {
    this.authListeners.add(callback);
    return () => {
      this.authListeners.delete(callback);
    };
  }

  async sendCode(phone: string) {
    await this.call("POST", "/api/auth/send", { phone });
  }

  register(phone: string, code: string, pin: string) {
    return this.startSession("/api/auth/register", { phone, code: code.trim(), pin });
  }

  signIn(phone: string, pin: string) {
    return this.startSession("/api/auth/login", { phone, pin });
  }

  private async startSession(path: string, body: unknown) {
    const { token, profile } = await this.call<{ token: string; profile: Profile }>("POST", path, body);
    this.token = token;
    this.authListeners.forEach((fn) => fn(profile));
    this.changed();
    return profile;
  }

  async signOut() {
    await this.call("POST", "/api/auth/logout").catch(() => undefined);
    this.dropSession();
    this.changed();
  }

  async deleteAccount(pin: string) {
    await this.call("POST", "/api/auth/delete-account", { pin });
    this.dropSession();
    this.changed();
  }

  // Rider -----------------------------------------------------------------------

  async myReservations() {
    if (!this.token) return [];
    return this.call<Reservation[]>("GET", "/api/reservations/mine");
  }

  async reserve(stationId: string, type: ReservationType) {
    const r = await this.call<Reservation>("POST", "/api/reservations", { stationId, type });
    this.changed();
    return r;
  }

  async cancelReservation(id: string) {
    await this.call("POST", `/api/reservations/${encodeURIComponent(id)}/cancel`);
    this.changed();
  }

  // Station staff -----------------------------------------------------------------

  staffStations() {
    return this.call<StationView[]>("GET", "/api/staff/stations");
  }

  async updateStatus(stationId: string, patch: StatusPatch) {
    await this.call("PATCH", `/api/stations/${encodeURIComponent(stationId)}/status`, patch);
    this.changed();
  }

  stationReservations(stationId: string) {
    return this.call<Reservation[]>("GET", `/api/stations/${encodeURIComponent(stationId)}/reservations`);
  }

  async completeReservation(id: string, pickupCode: string) {
    await this.call("POST", `/api/reservations/${encodeURIComponent(id)}/complete`, { pickupCode });
    this.changed();
  }

  // Admin -------------------------------------------------------------------------

  listOperators() {
    return this.call<Operator[]>("GET", "/api/operators");
  }

  async saveStation(id: string | null, input: StationInput) {
    await this.call("POST", "/api/admin/stations", { id, input });
    this.changed();
  }

  adminSnapshot() {
    return this.call<AdminSnapshot>("GET", "/api/admin/snapshot");
  }

  auditLog(filter: AuditFilter) {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(filter)) if (value !== undefined && value !== "") q.set(key, String(value));
    return this.call<AuditEntry[]>("GET", `/api/admin/audit?${q}`);
  }

  async setUserRole(userId: string, role: UserRole) {
    await this.call("POST", `/api/admin/users/${encodeURIComponent(userId)}/role`, { role });
    this.changed();
  }

  async assignStaff(stationId: string, userId: string) {
    await this.call("POST", "/api/admin/staff", { stationId, userId });
    this.changed();
  }

  async unassignStaff(stationId: string, userId: string) {
    await this.call("DELETE", "/api/admin/staff", { stationId, userId });
    this.changed();
  }

  async setStationActive(stationId: string, active: boolean) {
    await this.call("POST", `/api/admin/stations/${encodeURIComponent(stationId)}/active`, { active });
    this.changed();
  }

  // Advertising popup ---------------------------------------------------------------

  currentPromotion() {
    return this.call<Promotion | null>("GET", "/api/promotions/current");
  }

  listPromotions() {
    return this.call<Promotion[]>("GET", "/api/admin/promotions");
  }

  async savePromotion(id: string | null, input: PromotionInput) {
    await this.call("POST", "/api/admin/promotions", { id, input });
    this.changed();
  }

  async deletePromotion(id: string) {
    await this.call("DELETE", `/api/admin/promotions/${encodeURIComponent(id)}`);
    this.changed();
  }

  async uploadPromotionImage(file: File) {
    const { url } = await this.call<{ url: string }>("POST", "/api/admin/media", file);
    return url;
  }
}
