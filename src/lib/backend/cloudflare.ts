import type {
  AdminShare,
  ShareDocument,
  ShareMe,
  ShareOverview,
  ShareRide,
  ShareStationInput,
  ShareTariffInput,
  ShareTrackPoint,
  ShareVehicleInput,
  ShareVehicleKind,
  ShareVehicleStatus,
  StationShare,
} from "../share";
import type { BatteryDetail, BatteryFilter, BatteryList, BatteryLookup, BatteryStatusInput, RegisterBatteriesInput, RegisterBatteriesResult } from "../batteries";
import type { BatteryType, BatteryTypeInput } from "../battery-types";
import type { AdminCharging, ChargeOutletInfo, ChargeSession, ChargeTariffInput, StationCharging } from "../charging";
import type { ChargeCard, ChargeCardInput, CounterCard } from "../charge-cards";
import type { AdminReservationPage, AdminReservationQuery, AdminSnapshot, AuditEntry, AuditFilter } from "../admin/types";
import type { OwnerLive, OwnerReport, ReportPeriod } from "../owner-backoffice";
import type { EvCharger, EvChargerInput } from "../ev-chargers";
import type { RepairCenter, RepairCenterInput } from "../repair-centers";
import type { Features } from "../features";
import type { Device, DeviceInput } from "../iot/devices";
import type { AdminParcels, Parcel, ParcelDepotInput, ParcelInfo, ParcelInput, ParcelMeasures, ParcelRun, ParcelSizeTier } from "../parcels";
import type { AdminPartners, PartnerInput, PartnerKey, StationBooking } from "../partners";
import type { AdminOperator, OperatorInput, OwnerStationInput, OwnerView } from "../operators";
import type { AdminPointPartner, PointPartnerDashboard, PointPartnerInput } from "../point-partners";
import type { Promotion, PromotionInput } from "../promo";
import type {
  AdminGreenpoint,
  GreenpointFactors,
  GreenpointReceipt,
  GreenpointRedemption,
  GreenpointRewardInput,
  GreenpointView,
} from "../greenpoint";
import type { AdminWallet, CounterCredit, CreditCode, CreditTopupInput, CreditTopupResult, WalletAdjustInput, WalletTransaction, WalletView } from "../wallet";
import type {
  AbandonReason,
  AdminDrivers,
  DeliveryJob,
  DriverApplication,
  DriverAtStation,
  DriverDecision,
  DriverDocument,
  DriverHome,
  DriverPass,
  FormerAccount,
  DriverSettings,
  FleetVehicleInput,
  HomePoint,
  PickupBooking,
  RideBooking,
  CourierBooking,
  StationDrivers,
  TripPayment,
  PayoutNetwork,
  DriverPayout,
  AdminDriverPayout,
} from "../drivers";
import type { ReviewInput, StationReview } from "../station-extras";
import type {
  AdminFleet,
  FleetDecision,
  FleetInvite,
  FleetRemoval,
  FleetStatement,
  FleetStats,
  FleetTier,
  FleetView,
  MyFleetInvite,
} from "../fleet";
import type {
  AdminMerchant,
  DriverShops,
  MerchantActivity,
  MerchantAddress,
  MerchantAddressInput,
  MerchantAssignmentRequest,
  MerchantBookingsQuery,
  MerchantDecision,
  MerchantDriver,
  MerchantDriverInput,
  MerchantInvite,
  MerchantJob,
  MerchantPayMode,
  MerchantShopInput,
  MerchantStats,
  MerchantStatsQuery,
  MerchantTier,
  MerchantView,
  MyMerchantInvite,
} from "../merchants";
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
import { getActiveStation } from "../active-station";
import { ACTIVE_STATION_HEADER, type BatteryEventInput, type BatteryEventView, type StationCounter, type SwapEntry, type SwapFilter, type SwapInput } from "../station-work";
import type { CashHandover, HandoverInput, StationCash, StationCashSettings } from "../station-cash";
import { BackendError, type Backend, type BackendErrorCode, type CodeChannel, type StartChargeInput, type StatusPatch } from "./backend";
import { kindFrom, type ReservationKind } from "../reservations";
import { storedPushToken, storePushToken } from "../push";

const TOKEN_KEY = "poinderecharge-session";
/** How often open pages reload station data (other customers' holds, staff updates). */
const POLL_MS = 15_000;

const KNOWN_CODES: BackendErrorCode[] = [
  "not_authenticated",
  "already_reserved",
  "station_not_found",
  "station_closed",
  "station_unattended",
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
  "nothing_owed",
  "payout_pending",
  "payout_not_open",
  "recipient_not_found",
  "self_transfer",
  "invalid_amount",
  "amount_too_small",
  "amount_too_large",
  "daily_limit_exceeded",
  "monthly_limit_exceeded",
  "wallet_not_empty",
  "topup_unavailable",
  "credit_code_invalid",
  "credit_not_accepted",
  "credit_limit_reached",
  "card_needs_account",
  "provider_unavailable",
  "reward_unavailable",
  "redemption_open",
  "not_enough_points",
  "charge_busy",
  "charge_wrong_status",
  "charge_unpaid",
  "charge_qr_disabled",
  "card_invalid",
  "card_unknown",
  "card_blocked",
  "card_has_balance",
  "point_reserved",
  "service_already_unlocked",
  "service_request_pending",
  "no_pending_request",
  "invalid_review",
  "active_station_required",
  "no_full_battery",
  "counter_full",
  "swap_price_missing",
  "same_battery",
  "battery_number_required",
  "battery_wrong_brand",
  "battery_type_required",
  "cash_only",
  "wrong_fleet",
  "not_a_customer",
  "request_conflict",
  "reason_required",
  "battery_type_unavailable",
  "battery_type_mismatch",
  "battery_reserved",
  "outlet_busy",
  "outlet_required",
  "swap_required",
  "driver_pass_invalid",
  "driver_pass_expired",
  "role_change_blocked",
  "fleet_not_approved",
  "fleet_locked",
  "fleet_limit",
  "invite_number_taken",
  "invite_account_not_empty",
  "invite_pending",
  "invite_not_found",
  "already_in_fleet",
  "account_exists",
  "parcel_not_in_run",
  "run_not_found",
  "run_wrong_status",
  "run_unscanned",
  "recipient_not_customer",
  "sender_not_customer",
  "no_origin_depot",
  "staff_other_station",
  "opening_hours_invalid",
  "proof_required",
  "merchant_not_approved",
  "merchant_limit",
  "already_in_merchant",
  "checked_in_at_shop",
  "driver_checked_in",
  "not_assigned",
  "assignment_not_found",
  "merchant_driver_exists",
  "driver_checked_in_here",
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
    // Station actions carry the station the person works at now (src/lib/station-work.ts).
    const active = typeof window === "undefined" ? null : getActiveStation();
    if (active) headers[ACTIVE_STATION_HEADER] = active;
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

  listRepairCenters() {
    return this.call<RepairCenter[]>("GET", "/api/repair-centers");
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
    // This phone gets no more notices for the account that leaves.
    const token = storedPushToken();
    if (token) {
      await this.removePushToken(token).catch(() => undefined);
      storePushToken(null);
    }
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

  async reserve(stationId: string, kind: ReservationKind | ReservationType, target?: string | null) {
    const r = await this.call<Reservation>("POST", "/api/reservations", { stationId, kind: kindFrom(kind), target: target ?? null });
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
    const result = await this.call<{ cancelled: number } | null>("PATCH", `/api/stations/${encodeURIComponent(stationId)}/status`, patch);
    this.changed();
    return { cancelled: result?.cancelled ?? 0 };
  }

  stationReservations(stationId: string) {
    return this.call<Reservation[]>("GET", `/api/stations/${encodeURIComponent(stationId)}/reservations`);
  }

  async completeReservation(id: string, pickupCode: string) {
    await this.call("POST", `/api/reservations/${encodeURIComponent(id)}/complete`, { pickupCode });
    this.changed();
  }

  // Station work ---------------------------------------------------------------------

  stationCounter(stationId: string) {
    return this.call<StationCounter>("GET", `/api/stations/${encodeURIComponent(stationId)}/counter`);
  }

  async batteryEvent(stationId: string, input: BatteryEventInput) {
    const event = await this.call<BatteryEventView>("POST", `/api/stations/${encodeURIComponent(stationId)}/battery-events`, input);
    this.changed();
    return event;
  }

  async recordSwap(stationId: string, input: SwapInput) {
    const swap = await this.call<SwapEntry>("POST", `/api/stations/${encodeURIComponent(stationId)}/swaps`, input);
    this.changed();
    return swap;
  }

  stationSwaps(stationId: string, filter: SwapFilter = {}) {
    const q = new URLSearchParams();
    if (filter.customerType) q.set("customerType", filter.customerType);
    if (filter.days) q.set("days", String(filter.days));
    const qs = q.toString();
    return this.call<SwapEntry[]>("GET", `/api/stations/${encodeURIComponent(stationId)}/swaps${qs ? `?${qs}` : ""}`);
  }

  stationBatteryEvents(stationId: string, days: ReportPeriod) {
    return this.call<BatteryEventView[]>("GET", `/api/stations/${encodeURIComponent(stationId)}/battery-events?days=${days}`);
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

  async ownerMoveStaff(userId: string, stationId: string) {
    await this.call("POST", "/api/owner/staff/move", { userId, stationId });
    this.changed();
  }

  async resolveReassignment(id: string) {
    await this.call("POST", `/api/owner/reassignments/${encodeURIComponent(id)}/resolve`);
    this.changed();
  }

  ownerLive(stationId: string | null) {
    return this.call<OwnerLive>("GET", `/api/owner/live${stationId ? `?stationId=${encodeURIComponent(stationId)}` : ""}`);
  }

  ownerReport(stationId: string | null, days: ReportPeriod) {
    const q = new URLSearchParams({ days: String(days) });
    if (stationId) q.set("stationId", stationId);
    return this.call<OwnerReport>("GET", `/api/owner/report?${q}`);
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

  listBatteries(filter: BatteryFilter = {}) {
    const q = new URLSearchParams();
    if (filter.brand !== undefined && filter.brand !== null) q.set("brand", filter.brand);
    if (filter.q) q.set("q", filter.q);
    if (filter.status) q.set("status", filter.status);
    if (filter.stationId) q.set("stationId", filter.stationId);
    const qs = q.toString();
    return this.call<BatteryList>("GET", `/api/batteries${qs ? `?${qs}` : ""}`);
  }

  batteryDetail(id: string) {
    return this.call<BatteryDetail>("GET", `/api/batteries/${encodeURIComponent(id)}`);
  }

  async registerBatteries(input: RegisterBatteriesInput) {
    const result = await this.call<RegisterBatteriesResult>("POST", "/api/admin/batteries", input);
    this.changed();
    return result;
  }

  async setBatteryStatus(id: string, input: BatteryStatusInput) {
    await this.call("PATCH", `/api/admin/batteries/${encodeURIComponent(id)}`, input);
    this.changed();
  }

  lookupBattery(stationId: string, serial: string, batteryTypeId: string | null) {
    const q = new URLSearchParams({ serial });
    if (batteryTypeId) q.set("batteryTypeId", batteryTypeId);
    return this.call<BatteryLookup>("GET", `/api/stations/${encodeURIComponent(stationId)}/batteries/lookup?${q}`);
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

  adminRepairCenters() {
    return this.call<RepairCenter[]>("GET", "/api/admin/repair-centers");
  }

  async saveRepairCenter(id: string | null, input: RepairCenterInput) {
    await this.call("POST", "/api/admin/repair-centers", { id, input });
    this.changed();
  }

  async deleteRepairCenter(id: string) {
    await this.call("DELETE", `/api/admin/repair-centers/${encodeURIComponent(id)}`);
    this.changed();
  }

  async saveStation(id: string | null, input: StationInput) {
    await this.call("POST", "/api/admin/stations", { id, input });
    this.changed();
  }

  adminSnapshot() {
    return this.call<AdminSnapshot>("GET", "/api/admin/snapshot");
  }

  adminReservations(query: AdminReservationQuery) {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== "") q.set(key, String(value));
    return this.call<AdminReservationPage>("GET", `/api/admin/reservations?${q}`);
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

  async setQrStart(pointId: string, enabled: boolean) {
    await this.call("POST", `/api/admin/charging-points/${encodeURIComponent(pointId)}/qr`, { enabled });
    this.changed();
  }

  async setDevicePartner(externalId: string, partnerId: string | null) {
    await this.call("POST", `/api/admin/devices/${encodeURIComponent(externalId)}/partner`, { partnerId });
    this.changed();
  }

  // Station cash ------------------------------------------------------------------------

  ownerCash(stationId: string | null) {
    return this.call<StationCash[]>("GET", `/api/owner/cash${stationId ? `?stationId=${encodeURIComponent(stationId)}` : ""}`);
  }

  async closeCashDay(input: HandoverInput) {
    const handover = await this.call<CashHandover>("POST", "/api/owner/cash/handovers", input);
    this.changed();
    return handover;
  }

  async decideHandover(id: string, confirm: boolean, reason?: string) {
    const handover = await this.call<CashHandover>("POST", `/api/admin/cash/handovers/${encodeURIComponent(id)}/decide`, { confirm, reason });
    this.changed();
    return handover;
  }

  async saveStationCashSettings(stationId: string, settings: StationCashSettings) {
    await this.call("POST", `/api/admin/cash/stations/${encodeURIComponent(stationId)}`, settings);
    this.changed();
  }

  // Point partners -------------------------------------------------------------------

  adminPointPartners() {
    return this.call<AdminPointPartner[]>("GET", "/api/admin/point-partners");
  }

  async savePointPartner(id: string | null, input: PointPartnerInput) {
    await this.call("POST", "/api/admin/point-partners", { id, input });
    this.changed();
  }

  async setPointPartnerActive(id: string, active: boolean) {
    await this.call("POST", `/api/admin/point-partners/${encodeURIComponent(id)}/status`, { active });
    this.changed();
  }

  async addPointPartnerAccount(partnerId: string, contact: string) {
    await this.call("POST", `/api/admin/point-partners/${encodeURIComponent(partnerId)}/accounts`, { contact });
    this.changed();
  }

  async removePointPartnerAccount(partnerId: string, userId: string) {
    await this.call("DELETE", `/api/admin/point-partners/${encodeURIComponent(partnerId)}/accounts/${encodeURIComponent(userId)}`);
    this.changed();
  }

  pointPartnerDashboard(days: ReportPeriod) {
    return this.call<PointPartnerDashboard>("GET", `/api/point-partner?days=${days}`);
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

  async markParcelLabel(stationId: string, parcelId: string) {
    const parcel = await this.call<Parcel>("POST", `/api/stations/${encodeURIComponent(stationId)}/parcels/${encodeURIComponent(parcelId)}/label`);
    this.changed();
    return parcel;
  }

  stationRuns(stationId: string) {
    return this.call<ParcelRun[]>("GET", `/api/stations/${encodeURIComponent(stationId)}/runs`);
  }

  private async runCall(stationId: string, path: string, body?: unknown): Promise<ParcelRun> {
    const run = await this.call<ParcelRun>("POST", `/api/stations/${encodeURIComponent(stationId)}/runs${path}`, body);
    this.changed();
    return run;
  }

  startRun(stationId: string, badge: string, parcelIds: string[]) {
    return this.runCall(stationId, "", { badge, parcelIds });
  }

  scanRunParcel(stationId: string, runId: string, code: string) {
    return this.runCall(stationId, `/${encodeURIComponent(runId)}/scan`, { code });
  }

  removeRunParcel(stationId: string, runId: string, parcelId: string) {
    return this.runCall(stationId, `/${encodeURIComponent(runId)}/remove`, { parcelId });
  }

  departRun(stationId: string, runId: string) {
    return this.runCall(stationId, `/${encodeURIComponent(runId)}/depart`);
  }

  async cancelRun(stationId: string, runId: string) {
    await this.runCall(stationId, `/${encodeURIComponent(runId)}/cancel`);
  }

  async receiveParcel(stationId: string, code: string) {
    const parcel = await this.call<Parcel>("POST", `/api/stations/${encodeURIComponent(stationId)}/parcels/receive`, { code });
    this.changed();
    return parcel;
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

  driverPass() {
    return this.call<DriverPass>("GET", "/api/driver/pass");
  }

  async sendFormerAccountCode(contact: string) {
    await this.call("POST", "/api/driver/former-account/code", { contact });
  }

  async claimFormerAccount(contact: string, code: string, pin: string) {
    const account = await this.call<FormerAccount>("POST", "/api/driver/former-account/claim", { contact, code, pin });
    this.changed();
    return account;
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

  // No change notice: other screens of the driver do not depend on it.
  async registerPushToken(token: string, platform: "android" | "ios" | "web") {
    await this.call("POST", "/api/push/token", { token, platform });
  }

  async removePushToken(token: string) {
    await this.call("POST", "/api/push/token/remove", { token });
  }

  webPushKey() {
    return this.call<{ publicKey: string }>("GET", "/api/push/web-key");
  }

  reportDriverPosition(position: { lat: number; lng: number; accuracyM?: number | null }) {
    return this.call<{ kept: boolean }>("POST", "/api/driver/position", position);
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

  finishRide(id: string, code?: string) {
    return this.job(id, "finish", { code: code ?? "" });
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

  async bookDelivery(parcelId: string, home: HomePoint, payWith?: TripPayment) {
    const job = await this.call<DeliveryJob>("POST", `/api/parcels/${encodeURIComponent(parcelId)}/delivery`, { home, payWith });
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

  handToDriver(stationId: string, badge: string, jobId: string, parcelCode: string) {
    return this.act("POST", `/api/stations/${encodeURIComponent(stationId)}/drivers/handover`, { badge, jobId, parcel: parcelCode });
  }

  receiveFromDriver(stationId: string, badge: string, jobId: string, parcelCode: string) {
    return this.act("POST", `/api/stations/${encodeURIComponent(stationId)}/drivers/receive`, { badge, jobId, parcel: parcelCode });
  }

  settleDriver(stationId: string, badge: string, amountFcfa: number) {
    return this.act("POST", `/api/stations/${encodeURIComponent(stationId)}/drivers/settle`, { badge, amount: amountFcfa });
  }

  async requestDriverPayout(network: PayoutNetwork, phone: string) {
    const payout = await this.call<DriverPayout>("POST", "/api/driver/payouts", { network, phone });
    this.changed();
    return payout;
  }

  adminDriverPayouts() {
    return this.call<AdminDriverPayout[]>("GET", "/api/admin/driver-payouts");
  }

  decideDriverPayout(id: string, status: "paid" | "rejected", reference?: string) {
    return this.act("POST", `/api/admin/driver-payouts/${encodeURIComponent(id)}`, { status, reference });
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

  registerFleetManager(contact: string, code: string, pin: string, fleetName: string) {
    return this.startSession("/api/auth/register-fleet", { contact, code: code.trim(), pin, fleetName });
  }

  fleetStatement(from: string, to: string) {
    return this.call<FleetStatement>("GET", `/api/fleet/statement?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  }

  async inviteFleetDriver(phone: string) {
    const invite = await this.call<FleetInvite>("POST", "/api/fleet/invites", { phone });
    this.changed();
    return invite;
  }

  revokeFleetInvite(inviteId: string) {
    return this.act("POST", `/api/fleet/invites/${encodeURIComponent(inviteId)}/revoke`);
  }

  async removeFleetDriver(driverId: string) {
    const result = await this.call<FleetRemoval>("POST", `/api/fleet/drivers/${encodeURIComponent(driverId)}/remove`);
    this.changed();
    return result;
  }

  myFleetInvites() {
    return this.call<MyFleetInvite[]>("GET", "/api/fleet-invites");
  }

  async acceptFleetInvite(token: string, application?: DriverApplication) {
    await this.act("POST", `/api/fleet-invites/${encodeURIComponent(token)}/accept`, { application });
    // The account is a driver account now: the menu follows the role.
    const profile = await this.getProfile();
    this.authListeners.forEach((fn) => fn(profile));
  }

  declineFleetInvite(token: string) {
    return this.act("POST", `/api/fleet-invites/${encodeURIComponent(token)}/decline`);
  }

  adminFleets() {
    return this.call<AdminFleet[]>("GET", "/api/admin/fleets");
  }

  reviewFleet(managerId: string, action: FleetDecision) {
    return this.act("POST", `/api/admin/fleets/${encodeURIComponent(managerId)}/review`, { action });
  }

  setFleetTier(managerId: string, tier: FleetTier) {
    return this.act("POST", `/api/admin/fleets/${encodeURIComponent(managerId)}/tier`, { tier });
  }

  // Merchants ------------------------------------------------------------------------

  registerMerchant(contact: string, code: string, pin: string, shop: MerchantShopInput) {
    return this.startSession("/api/auth/register-merchant", { contact, code: code.trim(), pin, shop });
  }

  merchantView() {
    return this.call<MerchantView>("GET", "/api/merchant");
  }

  merchantBookings(query: MerchantBookingsQuery) {
    return this.call<MerchantJob[]>("POST", "/api/merchant/bookings", query);
  }

  merchantActivity() {
    return this.call<MerchantActivity[]>("GET", "/api/merchant/activity");
  }

  merchantStats(query: MerchantStatsQuery) {
    return this.call<MerchantStats>("POST", "/api/merchant/stats", query);
  }

  async addMerchantAddress(input: MerchantAddressInput) {
    const address = await this.call<MerchantAddress>("POST", "/api/merchant/addresses", input);
    this.changed();
    return address;
  }

  removeMerchantAddress(addressId: string) {
    return this.act("DELETE", `/api/merchant/addresses/${encodeURIComponent(addressId)}`);
  }

  confirmShopReturn(jobId: string) {
    return this.act("POST", `/api/merchant/jobs/${encodeURIComponent(jobId)}/returned`);
  }

  async updateMerchantShop(input: MerchantShopInput) {
    await this.act("POST", "/api/merchant/shop", input);
    // The shop's name is in the profile.
    const profile = await this.getProfile();
    this.authListeners.forEach((fn) => fn(profile));
  }

  async inviteMerchantEmployee(phone: string) {
    const invite = await this.call<MerchantInvite>("POST", "/api/merchant/invites", { phone });
    this.changed();
    return invite;
  }

  revokeMerchantInvite(inviteId: string) {
    return this.act("POST", `/api/merchant/invites/${encodeURIComponent(inviteId)}/revoke`);
  }

  removeMerchantEmployee(userId: string) {
    return this.act("POST", `/api/merchant/members/${encodeURIComponent(userId)}/remove`);
  }

  async addMerchantDriver(input: MerchantDriverInput) {
    const driver = await this.call<MerchantDriver>("POST", "/api/merchant/drivers", input);
    this.changed();
    return driver;
  }

  changeMerchantPay(assignmentId: string, payMode: MerchantPayMode, ratePerHourFcfa: number | null) {
    return this.act("POST", `/api/merchant/drivers/${encodeURIComponent(assignmentId)}/pay`, { payMode, ratePerHourFcfa });
  }

  endMerchantDriver(assignmentId: string) {
    return this.act("POST", `/api/merchant/drivers/${encodeURIComponent(assignmentId)}/end`);
  }

  merchantCheckout(driverId: string) {
    return this.act("POST", `/api/merchant/drivers/${encodeURIComponent(driverId)}/checkout`);
  }

  myMerchantInvites() {
    return this.call<MyMerchantInvite[]>("GET", "/api/merchant-invites");
  }

  async acceptMerchantInvite(token: string) {
    await this.act("POST", `/api/merchant-invites/${encodeURIComponent(token)}/accept`);
    // The account is a merchant account now: the menu follows the role.
    const profile = await this.getProfile();
    this.authListeners.forEach((fn) => fn(profile));
  }

  declineMerchantInvite(token: string) {
    return this.act("POST", `/api/merchant-invites/${encodeURIComponent(token)}/decline`);
  }

  merchantAssignmentRequests() {
    return this.call<MerchantAssignmentRequest[]>("GET", "/api/merchant-assignments");
  }

  decideMerchantAssignment(assignmentId: string, approve: boolean) {
    return this.act("POST", `/api/merchant-assignments/${encodeURIComponent(assignmentId)}/${approve ? "approve" : "decline"}`);
  }

  driverShops() {
    return this.call<DriverShops>("GET", "/api/driver/shops");
  }

  checkInAtShop(merchantId: string, position: LatLng) {
    return this.act("POST", `/api/driver/shops/${encodeURIComponent(merchantId)}/checkin`, { position });
  }

  checkOutOfShop() {
    return this.act("POST", "/api/driver/shops/checkout");
  }

  confirmShopHoursReceived(checkinId: string) {
    return this.act("POST", `/api/driver/shops/hours/${encodeURIComponent(checkinId)}/received`);
  }

  adminMerchants() {
    return this.call<AdminMerchant[]>("GET", "/api/admin/merchants");
  }

  reviewMerchant(merchantId: string, action: MerchantDecision) {
    return this.act("POST", `/api/admin/merchants/${encodeURIComponent(merchantId)}/review`, { action });
  }

  setMerchantTier(merchantId: string, tier: MerchantTier) {
    return this.act("POST", `/api/admin/merchants/${encodeURIComponent(merchantId)}/tier`, { tier });
  }

  setMerchantOwner(merchantId: string, userId: string) {
    return this.act("POST", `/api/admin/merchants/${encodeURIComponent(merchantId)}/owner`, { userId });
  }

  adminRemoveMerchantEmployee(merchantId: string, userId: string) {
    return this.act("POST", `/api/admin/merchants/${encodeURIComponent(merchantId)}/members/${encodeURIComponent(userId)}/remove`);
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
    return { wallet: true, evChargers: true, share: false, lite: false, ...(await this.call<Partial<Features>>("GET", "/api/features")) } as Features;
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

  createCreditCode(pin: string) {
    return this.call<CreditCode>("POST", "/api/wallet/code", { pin });
  }

  checkCreditCode(stationId: string, code: string) {
    return this.call<CounterCredit>("POST", `/api/stations/${encodeURIComponent(stationId)}/green-credit/check`, { code });
  }

  async topUpCredit(stationId: string, input: CreditTopupInput) {
    const result = await this.call<CreditTopupResult>("POST", `/api/stations/${encodeURIComponent(stationId)}/green-credit/topup`, input);
    this.changed();
    return result;
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

  async setCreditMax(maxXof: number) {
    await this.call("POST", "/api/admin/wallet/max", { maxXof });
    this.changed();
  }

  async setStationGreenCredit(stationId: string, enabled: boolean) {
    await this.call("POST", `/api/admin/stations/${encodeURIComponent(stationId)}/green-credit`, { enabled });
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

  startCharge(stationId: string, input: StartChargeInput) {
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

  chargeOutlet(token: string) {
    return this.call<ChargeOutletInfo>("GET", `/api/charging/outlets/${encodeURIComponent(token)}`);
  }

  async startOutletCharge(token: string, pointId: string, pin: string) {
    const s = await this.call<ChargeSession>("POST", `/api/charging/outlets/${encodeURIComponent(token)}/start`, { pointId, pin });
    this.changed();
    return s;
  }

  async renewBoxQr(externalId: string) {
    const { qrCode } = await this.call<{ qrCode: string }>("POST", `/api/admin/devices/${encodeURIComponent(externalId)}/qr`, {});
    return qrCode;
  }

  async stopSelfCharge(id: string) {
    const s = await this.call<ChargeSession>("POST", `/api/charging/${encodeURIComponent(id)}/stop`, {});
    this.changed();
    return s;
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

  adminChargeCards() {
    return this.call<ChargeCard[]>("GET", "/api/admin/charge-cards");
  }

  async saveChargeCard(input: ChargeCardInput) {
    await this.call("POST", "/api/admin/charge-cards", input);
  }

  async setChargeCardBlocked(idTag: string, blocked: boolean) {
    await this.call("POST", `/api/admin/charge-cards/${encodeURIComponent(idTag)}/block`, { blocked });
  }

  async adjustChargeCard(idTag: string, amountXof: number, reason: string) {
    await this.call("POST", `/api/admin/charge-cards/${encodeURIComponent(idTag)}/balance`, { amountXof, reason });
  }

  async deleteChargeCard(idTag: string) {
    await this.call("DELETE", `/api/admin/charge-cards/${encodeURIComponent(idTag)}`);
  }

  counterCard(stationId: string, idTag: string) {
    return this.call<CounterCard>("GET", `/api/stations/${encodeURIComponent(stationId)}/charge-cards/${encodeURIComponent(idTag)}`);
  }

  // Share --------------------------------------------------------------------------

  shareOverview() {
    return this.call<ShareOverview>("GET", "/api/share");
  }

  shareMe() {
    return this.call<ShareMe>("GET", "/api/share/me");
  }

  myShareRides() {
    return this.call<ShareRide[]>("GET", "/api/share/rides/mine");
  }

  uploadShareDocument(kind: ShareDocument, image: Blob) {
    return this.act("POST", `/api/share/documents/${kind}`, image);
  }

  private async shareRide(path: string, body?: unknown) {
    const ride = await this.call<ShareRide>("POST", `/api/share/rides${path}`, body ?? {});
    this.changed();
    return ride;
  }

  reserveShare(input: { vehicleId?: string; qrToken?: string; toStationId: string | null; helmet: boolean; start?: boolean }) {
    return this.shareRide("", input);
  }

  shareRideAction(id: string, action: "start" | "cancel" | "pause" | "resume") {
    return this.shareRide(`/${encodeURIComponent(id)}/${action}`);
  }

  endShareRide(id: string, position: LatLng | null) {
    return this.shareRide(`/${encodeURIComponent(id)}/end`, position ?? {});
  }

  async reportSharePosition(id: string, position: LatLng) {
    await this.call("POST", `/api/share/rides/${encodeURIComponent(id)}/position`, position);
  }

  reportShareProblem(id: string, note: string) {
    return this.shareRide(`/${encodeURIComponent(id)}/problem`, { note });
  }

  payShareWallet(id: string, input: { pin: string; idempotencyKey: string }) {
    return this.shareRide(`/${encodeURIComponent(id)}/pay/wallet`, input);
  }

  async payShareMobile(id: string, input: { network: "flooz" | "tmoney"; phone: string }) {
    const p = await this.call<{ id: string }>("POST", `/api/share/rides/${encodeURIComponent(id)}/pay/mobile`, input);
    this.changed();
    return p.id;
  }

  stationShare(stationId: string) {
    return this.call<StationShare>("GET", `/api/stations/${encodeURIComponent(stationId)}/share`);
  }

  setStationShareVehicle(stationId: string, vehicleId: string, status: ShareVehicleStatus) {
    return this.act("POST", `/api/stations/${encodeURIComponent(stationId)}/share/vehicles/${encodeURIComponent(vehicleId)}/status`, { status });
  }

  async payShareCash(stationId: string, rideId: string) {
    const ride = await this.call<ShareRide>("POST", `/api/stations/${encodeURIComponent(stationId)}/share/rides/${encodeURIComponent(rideId)}/cash`, {});
    this.changed();
    return ride;
  }

  adminShare() {
    return this.call<AdminShare>("GET", "/api/admin/share");
  }

  setShareEnabled(enabled: boolean) {
    return this.act("POST", "/api/admin/features/share", { enabled });
  }

  saveShareVehicle(id: string | null, input: ShareVehicleInput) {
    return this.act("POST", "/api/admin/share/vehicles", { id, input });
  }

  deleteShareVehicle(id: string) {
    return this.act("DELETE", `/api/admin/share/vehicles/${encodeURIComponent(id)}`);
  }

  setShareVehicleState(id: string, status: ShareVehicleStatus, stationId: string | null) {
    return this.act("POST", `/api/admin/share/vehicles/${encodeURIComponent(id)}/state`, { status, stationId });
  }

  shareVehicleCommand(id: string, action: "unlock" | "lock" | "locate") {
    return this.act("POST", `/api/admin/share/vehicles/${encodeURIComponent(id)}/command`, { action });
  }

  saveShareStation(stationId: string, input: ShareStationInput) {
    return this.act("POST", `/api/admin/share/stations/${encodeURIComponent(stationId)}`, input);
  }

  saveShareTariff(kind: ShareVehicleKind, input: ShareTariffInput) {
    return this.act("POST", `/api/admin/share/tariffs/${kind}`, input);
  }

  decideShareVerification(userId: string, approve: boolean, reason: string) {
    return this.act("POST", `/api/admin/share/verifications/${encodeURIComponent(userId)}`, { approve, reason });
  }

  adminEndShareRide(id: string, stationId: string | null, wrongDrop: boolean) {
    return this.act("POST", `/api/admin/share/rides/${encodeURIComponent(id)}/end`, { stationId, wrongDrop });
  }

  waiveShareRide(id: string) {
    return this.act("POST", `/api/admin/share/rides/${encodeURIComponent(id)}/waive`);
  }

  shareRideTrack(id: string) {
    return this.call<ShareTrackPoint[]>("GET", `/api/admin/share/rides/${encodeURIComponent(id)}/track`);
  }

  resolveShareIncident(id: string, resolution: string) {
    return this.act("POST", `/api/admin/share/incidents/${encodeURIComponent(id)}/resolve`, { resolution });
  }

  /** Private photos need the session, like the drivers' (driverFileUrl). */
  async shareFileUrl(key: string) {
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(`${this.apiBase}/api/admin/share-files/${key}`, { headers }).catch(() => null);
    if (!res?.ok) throw new BackendError("forbidden");
    return URL.createObjectURL(await res.blob());
  }
}
