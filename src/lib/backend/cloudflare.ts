import type { BatteryType, BatteryTypeInput } from "../battery-types";
import type { AdminCharging, ChargeSession, ChargeTariffInput, StationCharging } from "../charging";
import type { AdminSnapshot, AuditEntry, AuditFilter } from "../admin/types";
import type { EvCharger, EvChargerInput } from "../ev-chargers";
import type { Features } from "../features";
import type { Device, DeviceInput } from "../iot/devices";
import type { AdminParcels, Parcel, ParcelDepotInput, ParcelInfo, ParcelInput, ParcelMeasures, ParcelSizeTier } from "../parcels";
import type { AdminPartners, PartnerInput, PartnerKey, StationBooking } from "../partners";
import type { AdminOperator, OperatorInput, OwnerStationInput, OwnerView } from "../operators";
import type { Promotion, PromotionInput } from "../promo";
import type {
  AdminGreenpoint,
  GreenpointFactors,
  GreenpointReceipt,
  GreenpointRedemption,
  GreenpointRewardInput,
  GreenpointView,
} from "../greenpoint";
import type { AdminWallet, SendMoneyInput, TopupInput, WalletAdjustInput, WalletFeeSetting, WalletRecipient, WalletTopup, WalletTransaction, WalletView } from "../wallet";
import type {
  AbandonReason,
  AdminDrivers,
  DeliveryJob,
  DriverApplication,
  DriverAtStation,
  DriverDecision,
  DriverDocument,
  DriverHome,
  DriverSettings,
  FleetVehicleInput,
  HomePoint,
  PickupBooking,
  RideBooking,
  CourierBooking,
  StationDrivers,
} from "../drivers";
import type { ReviewInput, StationReview } from "../station-extras";
import type { FleetStats, FleetView } from "../fleet";
import type { LatLng } from "../geo";
import type {
  Operator,
  VehicleType,
  Profile,
  Reservation,
  ReservationType,
  StationInput,
  StationView,
  UserRole,
} from "../types";
import type { StationService, StationServiceInfo } from "../station-services";
import { BackendError, type Backend, type BackendErrorCode, type CodeChannel, type StatusPatch } from "./backend";

const TOKEN_KEY = "poinderecharge-session";
/** How often open pages reload station data (other customers' holds, staff updates). */
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
  "invalid_device",
  "device_exists",
  "device_offline",
  "device_not_charging",
  "device_command_failed",
  "device_not_configured",
  "depot_inactive",
  "same_station",
  "parcel_too_large",
  "parcel_not_found",
  "parcel_wrong_status",
  "code_locked",
  "parcel_with_driver",
  "parcel_not_arrived",
  "not_a_driver",
  "phone_required",
  "driver_busy",
  "driver_not_found",
  "too_far",
  "cash_limit",
  "outside_area",
  "job_not_found",
  "job_wrong_status",
  "wait_longer",
  "photo_missing",
  "vehicle_unavailable",
  "vehicle_too_small",
  "has_other_role",
  "no_vehicle",
  "documents_missing",
  "balance_changed",
  "invalid_webhook",
  "invalid_contact",
  "contact_taken",
  "rate_limited",
  "forbidden",
  "wallet_disabled",
  "wallet_frozen",
  "insufficient_balance",
  "recipient_not_found",
  "self_transfer",
  "invalid_amount",
  "amount_too_small",
  "amount_too_large",
  "daily_limit_exceeded",
  "monthly_limit_exceeded",
  "wallet_not_empty",
  "topup_unavailable",
  "provider_unavailable",
  "reward_unavailable",
  "redemption_open",
  "not_enough_points",
  "greenpoint_daily_limit",
  "greenpoint_fleet_driver",
  "greenpoint_station_staff",
  "greenpoint_not_solar",
  "charge_busy",
  "charge_wrong_status",
  "service_already_unlocked",
  "service_request_pending",
  "no_pending_request",
  "invalid_review",
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

  async sendCode(contact: string) {
    await this.call("POST", "/api/auth/send", { contact });
  }

  register(contact: string, code: string, pin: string) {
    return this.startSession("/api/auth/register", { contact, code: code.trim(), pin });
  }

  signIn(contact: string, pin: string) {
    return this.startSession("/api/auth/login", { contact, pin });
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

  async sendContactCode(contact: string) {
    await this.call("POST", "/api/auth/contact/send", { contact });
  }

  async addContact(contact: string, code: string) {
    const profile = await this.call<Profile>("POST", "/api/auth/contact", { contact, code: code.trim() });
    this.authListeners.forEach((fn) => fn(profile));
    return profile;
  }

  async sendDeleteCode(channel: CodeChannel) {
    await this.call("POST", "/api/auth/delete-account/send", { channel });
  }

  async deleteAccount(channel: CodeChannel, code: string) {
    await this.call("POST", "/api/auth/delete-account", { channel, code: code.trim() });
    this.dropSession();
    this.changed();
  }

  // Customer -----------------------------------------------------------------------

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

  // Operator accounts ---------------------------------------------------------------

  ownerView() {
    return this.call<OwnerView>("GET", "/api/owner");
  }

  async ownerAddStaff(stationId: string, contact: string) {
    await this.call("POST", "/api/owner/staff", { stationId, contact });
  }

  async ownerRemoveStaff(stationId: string, userId: string) {
    await this.call("DELETE", "/api/owner/staff", { stationId, userId });
  }

  async ownerSaveStation(stationId: string, input: OwnerStationInput) {
    await this.call("POST", `/api/owner/stations/${encodeURIComponent(stationId)}`, input);
    this.changed();
  }

  stationServices() {
    return this.call<StationServiceInfo[]>("GET", "/api/station-services");
  }

  async requestStationService(stationId: string, service: StationService) {
    await this.call("POST", "/api/station-services/request", { stationId, service });
    this.changed();
  }

  async decideStationService(stationId: string, service: StationService, approve: boolean) {
    await this.call("POST", "/api/admin/station-services/decide", { stationId, service, approve });
    this.changed();
  }

  async setStationService(stationId: string, service: StationService, unlocked: boolean) {
    await this.call("POST", "/api/admin/station-services/set", { stationId, service, unlocked });
    this.changed();
  }

  // Admin -------------------------------------------------------------------------

  listOperators() {
    return this.call<Operator[]>("GET", "/api/operators");
  }

  listBatteryTypes() {
    return this.call<BatteryType[]>("GET", "/api/admin/battery-types");
  }

  async saveBatteryType(id: string | null, input: BatteryTypeInput) {
    await this.call("POST", "/api/admin/battery-types", { id, input });
    this.changed();
  }

  listEvChargers() {
    return this.call<EvCharger[]>("GET", "/api/admin/ev-chargers");
  }

  async saveEvCharger(id: string | null, input: EvChargerInput) {
    await this.call("POST", "/api/admin/ev-chargers", { id, input });
    this.changed();
  }

  async deleteEvCharger(id: string) {
    await this.call("DELETE", `/api/admin/ev-chargers/${encodeURIComponent(id)}`);
    this.changed();
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

  adminOperators() {
    return this.call<AdminOperator[]>("GET", "/api/admin/operators");
  }

  async saveOperator(id: string | null, input: OperatorInput) {
    await this.call("POST", "/api/admin/operators", { id, input });
    this.changed();
  }

  async addOperatorOwner(operatorId: string, contact: string) {
    await this.call("POST", `/api/admin/operators/${encodeURIComponent(operatorId)}/owners`, { contact });
  }

  async removeOperatorOwner(operatorId: string, userId: string) {
    await this.call("DELETE", `/api/admin/operators/${encodeURIComponent(operatorId)}/owners/${encodeURIComponent(userId)}`);
  }

  // Connected sockets ---------------------------------------------------------------

  listDevices() {
    return this.call<Device[]>("GET", "/api/admin/devices");
  }

  async createDevice(input: DeviceInput) {
    const { ocppKey } = await this.call<{ ocppKey?: string }>("POST", "/api/admin/devices", input);
    this.changed();
    return { ocppKey };
  }

  async deleteDevice(externalId: string) {
    await this.call("DELETE", `/api/admin/devices/${encodeURIComponent(externalId)}`);
    this.changed();
  }

  async switchOutlet(externalId: string, outlet: number, on: boolean) {
    await this.call("POST", `/api/admin/devices/${encodeURIComponent(externalId)}/outlets/${outlet}/${on ? "start" : "stop"}`, {});
    this.changed();
  }

  // Parcel depot ---------------------------------------------------------------------

  parcelInfo() {
    return this.call<ParcelInfo>("GET", "/api/parcels/info");
  }

  async myParcels() {
    if (!this.token) return [];
    return this.call<Parcel[]>("GET", "/api/parcels/mine");
  }

  stationParcels(stationId: string) {
    return this.call<Parcel[]>("GET", `/api/stations/${encodeURIComponent(stationId)}/parcels`);
  }

  async createParcel(stationId: string, input: ParcelInput) {
    const parcel = await this.call<Parcel>("POST", `/api/stations/${encodeURIComponent(stationId)}/parcels`, input);
    this.changed();
    return parcel;
  }

  async markParcelsInTransit(stationId: string, ids: string[]) {
    await this.call("POST", `/api/stations/${encodeURIComponent(stationId)}/parcels/transit`, { ids });
    this.changed();
  }

  async markParcelsArrived(stationId: string, ids: string[]) {
    await this.call("POST", `/api/stations/${encodeURIComponent(stationId)}/parcels/arrived`, { ids });
    this.changed();
  }

  async pickUpParcel(stationId: string, codeOrQr: string) {
    const parcel = await this.call<Parcel>("POST", `/api/stations/${encodeURIComponent(stationId)}/parcels/pickup`, { code: codeOrQr });
    this.changed();
    return parcel;
  }

  async cancelParcel(id: string) {
    await this.call("POST", `/api/parcels/${encodeURIComponent(id)}/cancel`);
    this.changed();
  }

  async resendPickupCode(id: string) {
    await this.call("POST", `/api/parcels/${encodeURIComponent(id)}/resend`);
  }

  adminParcels() {
    return this.call<AdminParcels>("GET", "/api/admin/parcels");
  }

  async saveParcelDepot(stationId: string, input: ParcelDepotInput) {
    await this.call("POST", "/api/admin/parcel-depots", { stationId, input });
    this.changed();
  }

  async saveParcelSizes(sizes: ParcelSizeTier[]) {
    await this.call("POST", "/api/admin/parcel-sizes", { sizes });
    this.changed();
  }

  async closeStoredParcel(id: string, outcome: "released" | "auctioned") {
    await this.call("POST", `/api/admin/parcels/${encodeURIComponent(id)}/${outcome}`);
    this.changed();
  }

  // Drivers ----------------------------------------------------------------------------

  driverHome() {
    return this.call<DriverHome>("GET", "/api/driver");
  }

  private async act(method: string, path: string, body?: unknown) {
    await this.call(method, path, body);
    this.changed();
  }

  applyDriver(input: DriverApplication) {
    return this.act("POST", "/api/driver/apply", input);
  }

  uploadDriverDocument(kind: DriverDocument, image: Blob) {
    return this.act("POST", `/api/driver/documents/${kind}`, image);
  }

  joinDriverQueue(stationId: string, position: LatLng | null) {
    return this.act("POST", "/api/driver/queue", { stationId, position });
  }

  leaveDriverQueue() {
    return this.act("DELETE", "/api/driver/queue");
  }

  private job(id: string, action: string, body?: unknown) {
    return this.act("POST", `/api/driver/jobs/${encodeURIComponent(id)}/${action}`, body);
  }

  acceptJob(id: string) {
    return this.job(id, "accept");
  }

  declineJob(id: string) {
    return this.job(id, "decline");
  }

  abandonJob(id: string, reason: AbandonReason) {
    return this.job(id, "abandon", { reason });
  }

  async collectPickup(id: string, measures: ParcelMeasures) {
    const job = await this.call<DeliveryJob>("POST", `/api/driver/jobs/${encodeURIComponent(id)}/collect`, { measures });
    this.changed();
    return job;
  }

  arriveAtDoor(id: string) {
    return this.job(id, "door");
  }

  uploadDeliveryPhoto(id: string, image: Blob) {
    return this.job(id, "photo", image);
  }

  deliverJob(id: string, code: string) {
    return this.job(id, "deliver", { code });
  }

  failDelivery(id: string) {
    return this.job(id, "absent");
  }

  boardRide(id: string) {
    return this.job(id, "board");
  }

  finishRide(id: string) {
    return this.job(id, "finish");
  }

  async myJobs() {
    if (!this.token) return [];
    return this.call<DeliveryJob[]>("GET", "/api/jobs/mine");
  }

  async bookPickup(input: PickupBooking) {
    const job = await this.call<DeliveryJob>("POST", "/api/jobs/pickup", input);
    this.changed();
    return job;
  }

  async bookRide(input: RideBooking) {
    const job = await this.call<DeliveryJob>("POST", "/api/jobs/ride", input);
    this.changed();
    return job;
  }

  async bookCourier(input: CourierBooking) {
    const job = await this.call<DeliveryJob>("POST", "/api/jobs/courier", input);
    this.changed();
    return job;
  }

  async bookDelivery(parcelId: string, home: HomePoint) {
    const job = await this.call<DeliveryJob>("POST", `/api/parcels/${encodeURIComponent(parcelId)}/delivery`, { home });
    this.changed();
    return job;
  }

  cancelJob(id: string) {
    return this.act("POST", `/api/jobs/${encodeURIComponent(id)}/cancel`);
  }

  stationDrivers(stationId: string) {
    return this.call<StationDrivers>("GET", `/api/stations/${encodeURIComponent(stationId)}/drivers`);
  }

  driverAtStation(stationId: string, badge: string) {
    return this.call<DriverAtStation>("POST", `/api/stations/${encodeURIComponent(stationId)}/drivers/scan`, { badge });
  }

  handToDriver(stationId: string, badge: string, jobId: string) {
    return this.act("POST", `/api/stations/${encodeURIComponent(stationId)}/drivers/handover`, { badge, jobId });
  }

  receiveFromDriver(stationId: string, badge: string, jobId: string) {
    return this.act("POST", `/api/stations/${encodeURIComponent(stationId)}/drivers/receive`, { badge, jobId });
  }

  settleDriver(stationId: string, badge: string, amountFcfa: number) {
    return this.act("POST", `/api/stations/${encodeURIComponent(stationId)}/drivers/settle`, { badge, amount: amountFcfa });
  }

  adminDrivers() {
    return this.call<AdminDrivers>("GET", "/api/admin/drivers");
  }

  reviewDriver(userId: string, decision: DriverDecision) {
    return this.act("POST", `/api/admin/drivers/${encodeURIComponent(userId)}/review`, decision);
  }

  saveFleetVehicle(id: string | null, input: FleetVehicleInput) {
    return this.act("POST", "/api/admin/fleet", { id, input });
  }

  saveDriverSettings(settings: DriverSettings) {
    return this.act("POST", "/api/admin/driver-settings", { settings });
  }

  assignJob(jobId: string, driverId: string) {
    return this.act("POST", `/api/admin/jobs/${encodeURIComponent(jobId)}/assign`, { driverId });
  }

  setDriverManager(driverId: string, contact: string | null) {
    return this.act("POST", `/api/admin/drivers/${encodeURIComponent(driverId)}/manager`, { contact });
  }

  fleetView() {
    return this.call<FleetView>("GET", "/api/fleet");
  }

  fleetStats(from: string, to: string) {
    return this.call<FleetStats>("GET", `/api/fleet/stats?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  }

  fleetAssign(jobId: string, driverId: string) {
    return this.act("POST", `/api/fleet/jobs/${encodeURIComponent(jobId)}/assign`, { driverId });
  }

  /** Private photos need the session, so they are fetched and shown from memory. */
  async driverFileUrl(key: string) {
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(`${this.apiBase}/api/admin/driver-files/${key}`, { headers }).catch(() => null);
    if (!res?.ok) throw new BackendError("forbidden");
    return URL.createObjectURL(await res.blob());
  }

  // Partner API --------------------------------------------------------------------

  stationBookings(stationId: string) {
    return this.call<StationBooking[]>("GET", `/api/stations/${encodeURIComponent(stationId)}/bookings`);
  }

  async acceptBooking(stationId: string, bookingId: string, measures: ParcelMeasures) {
    const parcel = await this.call<Parcel>(
      "POST",
      `/api/stations/${encodeURIComponent(stationId)}/bookings/${encodeURIComponent(bookingId)}/accept`,
      { measures },
    );
    this.changed();
    return parcel;
  }

  adminPartners() {
    return this.call<AdminPartners>("GET", "/api/admin/partners");
  }

  async savePartner(id: string | null, input: PartnerInput) {
    await this.call("POST", "/api/admin/partners", { id, input });
  }

  createPartnerKey(partnerId: string, label: string) {
    return this.call<PartnerKey & { key: string }>("POST", `/api/admin/partners/${encodeURIComponent(partnerId)}/keys`, { label });
  }

  async revokePartnerKey(partnerId: string, keyId: string) {
    await this.call("POST", `/api/admin/partners/${encodeURIComponent(partnerId)}/keys/${encodeURIComponent(keyId)}/revoke`);
  }

  async rotatePartnerSecret(partnerId: string) {
    return (await this.call<{ secret: string }>("POST", `/api/admin/partners/${encodeURIComponent(partnerId)}/secret`)).secret;
  }

  async retryPartnerEvent(eventId: string) {
    await this.call("POST", `/api/admin/partner-events/${encodeURIComponent(eventId)}/retry`);
  }

  // Advertising popup ---------------------------------------------------------------

  async features(): Promise<Features> {
    // A server from before the Lite switch only names parcels and drivers; the rest was on.
    return { wallet: true, evChargers: true, lite: false, ...(await this.call<Partial<Features>>("GET", "/api/features")) } as Features;
  }

  async setParcelsEnabled(enabled: boolean) {
    await this.call("POST", "/api/admin/features/parcels", { enabled });
    this.changed();
  }

  async setDriversEnabled(enabled: boolean) {
    await this.call("POST", "/api/admin/features/drivers", { enabled });
    this.changed();
  }

  async setLiteEnabled(enabled: boolean) {
    await this.call("POST", "/api/admin/features/lite", { enabled });
    this.changed();
  }

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

  stationReviews(stationId: string) {
    return this.call<StationReview[]>("GET", `/api/stations/${encodeURIComponent(stationId)}/reviews`);
  }

  async saveReview(stationId: string, input: ReviewInput) {
    await this.call("POST", `/api/stations/${encodeURIComponent(stationId)}/reviews`, input);
    this.changed();
  }

  async deleteReview(id: string) {
    await this.call("DELETE", `/api/reviews/${encodeURIComponent(id)}`);
    this.changed();
  }

  async uploadStationPhoto(file: File) {
    const { url } = await this.call<{ url: string }>("POST", "/api/admin/media?folder=stations", file);
    return url;
  }

  async uploadPromotionImage(file: File) {
    const { url } = await this.call<{ url: string }>("POST", "/api/admin/media", file);
    return url;
  }

  // Wallet ------------------------------------------------------------------------

  myWallet() {
    return this.call<WalletView>("GET", "/api/wallet");
  }

  findWalletRecipient(contact: string) {
    return this.call<WalletRecipient>("GET", `/api/wallet/recipient?contact=${encodeURIComponent(contact)}`);
  }

  async sendMoney(input: SendMoneyInput) {
    const tx = await this.call<WalletTransaction>("POST", "/api/wallet/send", input);
    this.changed();
    return tx;
  }

  startTopup(input: TopupInput) {
    return this.call<WalletTopup>("POST", "/api/wallet/topups", input);
  }

  async refreshTopup(id: string) {
    const topup = await this.call<WalletTopup>("POST", `/api/wallet/topups/${encodeURIComponent(id)}/refresh`);
    if (topup.status === "succeeded") this.changed();
    return topup;
  }

  adminWallet(filter: { type?: string; userId?: string } = {}) {
    const query = new URLSearchParams();
    if (filter.type) query.set("type", filter.type);
    if (filter.userId) query.set("user", filter.userId);
    const qs = query.toString();
    return this.call<AdminWallet>("GET", `/api/admin/wallet${qs ? `?${qs}` : ""}`);
  }

  async setWalletEnabled(enabled: boolean) {
    await this.call("POST", "/api/admin/wallet/enabled", { enabled });
    this.changed();
  }

  async saveWalletFees(setting: WalletFeeSetting) {
    await this.call("POST", "/api/admin/wallet/fees", setting);
    this.changed();
  }

  async adjustWallet(input: WalletAdjustInput) {
    const tx = await this.call<WalletTransaction>("POST", "/api/admin/wallet/adjust", input);
    this.changed();
    return tx;
  }

  async setWalletFrozen(contact: string, frozen: boolean) {
    await this.call("POST", "/api/admin/wallet/freeze", { contact, frozen });
    this.changed();
  }

  // greenpoint -------------------------------------------------------------------

  myGreenpoint() {
    return this.call<GreenpointView>("GET", "/api/greenpoint");
  }

  async setGreenpointVehicle(vehicle: VehicleType) {
    await this.call("POST", "/api/greenpoint/vehicle", { vehicle });
  }

  startRedemption(rewardId: string) {
    return this.call<GreenpointRedemption>("POST", "/api/greenpoint/redemptions", { rewardId });
  }

  async cancelRedemption(id: string) {
    await this.call("POST", `/api/greenpoint/redemptions/${encodeURIComponent(id)}/cancel`);
  }

  recordGreenpointVisit(stationId: string, input: { contact: string; service: "swap" | "charge"; vehicle?: VehicleType }) {
    return this.call<GreenpointReceipt>("POST", `/api/stations/${encodeURIComponent(stationId)}/greenpoint/visits`, input);
  }

  confirmRedemption(stationId: string, code: string) {
    return this.call<GreenpointReceipt>("POST", `/api/stations/${encodeURIComponent(stationId)}/greenpoint/redeem`, { code });
  }

  adminGreenpoint() {
    return this.call<AdminGreenpoint>("GET", "/api/admin/greenpoint");
  }

  async saveGreenpointFactors(factors: GreenpointFactors) {
    await this.call("POST", "/api/admin/greenpoint/factors", factors);
  }

  async saveGreenpointReward(id: string | null, input: GreenpointRewardInput) {
    await this.call("POST", "/api/admin/greenpoint/rewards", { id, input });
  }

  // Charging at a socket --------------------------------------------------------------

  stationCharging(stationId: string) {
    return this.call<StationCharging>("GET", `/api/stations/${encodeURIComponent(stationId)}/charging`);
  }

  private async chargeAction(stationId: string, path: string, body?: unknown) {
    const s = await this.call<ChargeSession>("POST", `/api/stations/${encodeURIComponent(stationId)}/charging${path}`, body);
    this.changed();
    return s;
  }

  startCharge(stationId: string, input: { pointId: string; contact?: string }) {
    return this.chargeAction(stationId, "", input);
  }

  stopCharge(stationId: string, id: string) {
    return this.chargeAction(stationId, `/${encodeURIComponent(id)}/stop`);
  }

  cancelCharge(stationId: string, id: string) {
    return this.chargeAction(stationId, `/${encodeURIComponent(id)}/cancel`);
  }

  payChargeCash(stationId: string, id: string) {
    return this.chargeAction(stationId, `/${encodeURIComponent(id)}/pay`);
  }

  myCharges() {
    return this.call<ChargeSession[]>("GET", "/api/charging/mine");
  }

  async payChargeWallet(id: string, input: { pin: string; idempotencyKey: string }) {
    const s = await this.call<ChargeSession>("POST", `/api/charging/${encodeURIComponent(id)}/pay/wallet`, input);
    this.changed();
    return s;
  }

  async payChargeMobile(id: string, input: { network: "flooz" | "tmoney"; phone: string }) {
    await this.call("POST", `/api/charging/${encodeURIComponent(id)}/pay/mobile`, input);
    this.changed();
  }

  async refreshChargePayment(paymentId: string) {
    await this.call("POST", `/api/payments/${encodeURIComponent(paymentId)}/refresh`);
  }

  adminCharging() {
    return this.call<AdminCharging>("GET", "/api/admin/charging");
  }

  async saveChargeTariff(input: ChargeTariffInput) {
    await this.call("POST", "/api/admin/charging/tariff", input);
  }
}
