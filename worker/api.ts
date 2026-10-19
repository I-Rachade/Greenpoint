import { captchaSiteKey, checkCaptcha, countIpRequest } from "./ip-limits";
import { offersCharging, offersSwap, withinOpeningHours } from "../src/lib/availability";
import { depotPoints, hasAnyPoint } from "../src/lib/station-points";
import { cleanAmenities, cleanMainActivity, cleanPhotos, isUnattended, type ReviewInput } from "../src/lib/station-extras";
import { deleteReview, saveReview, stationReviews } from "./reviews";
import type { BatteryTypeInput } from "../src/lib/battery-types";
import type { EvChargerInput } from "../src/lib/ev-chargers";
import { deleteEvCharger, evChargersByStation, listEvChargers, saveEvCharger } from "./ev-chargers";
import type { RepairCenterInput } from "../src/lib/repair-centers";
import { deleteRepairCenter, listRepairCenters, saveRepairCenter } from "./repair-centers";
import { batteryTypesByStation, listBatteryTypes, saveBatteryType, stationBatteryTypeStatements } from "./battery-types";
import { batteryDetail, listBatteries, lookupBattery, registerBatteries, setBatteryStatus } from "./batteries";
import type { BatteryStatusInput, RegisterBatteriesInput } from "../src/lib/batteries";
import { capacityTrimStatements, postBatteryEvent, recordSwap, stationActor, stationBatteryEvents, stationCounter, stationSwaps, type StationActor } from "./station-work";
import type { StationRole } from "../src/lib/station-work";
import {
  checkPickupCode,
  evTargetSql,
  heldBatteriesSql,
  heldOfKindSql,
  holdRoomSql,
  holdStockSql,
  heldTargetsByStation,
  RESERVATION_SELECT,
  stillActive,
  toReservation,
  type ReservationRow,
} from "./reservations";
import { kindFrom, typeOfKind } from "../src/lib/reservations";
import type { BatteryEventInput, SwapFilter, SwapInput } from "../src/lib/station-work";
import {
  ADMIN_HISTORY_DAYS,
  ADMIN_PAGE_SIZE,
  SNAPSHOT_RESERVATION_DAYS,
  type AdminReservationPage,
  type AdminSnapshot,
  type AuditEntry,
  type AuditTable,
  type ChargingPointInfo,
} from "../src/lib/admin/types";
import type { CodeChannel } from "../src/lib/backend/backend";
import { parseContact } from "../src/lib/contact";
import {
  OPERATOR_NAME_MAX,
  STAFF_INVITE_DAYS,
  STAFF_INVITE_LIMIT,
  type AdminOperator,
  type MyStaffInvite,
  type OperatorInput,
  type OperatorPerson,
  type OwnerStationInput,
  type OwnerView,
  validPrice,
} from "../src/lib/operators";
import { cleanOpeningHours } from "../src/lib/opening-hours";
import { reportPeriod } from "../src/lib/owner-backoffice";
import { ownerLive, ownerReport } from "./owner";
import { closeCashDay, decideHandover, myStationCash, ownerCash, saveStationCashSettings } from "./station-cash";
import type { HandoverInput, StationCashSettings } from "../src/lib/station-cash";
import { normalizeTogoPhone } from "../src/lib/phone";
import { personLabel } from "../src/lib/wallet";
import { MAX_PROMO_IMAGE_BYTES, pickPromotion, safeImage, safeLink, type Promotion, type PromotionInput } from "../src/lib/promo";
import {
  MAX_UNUSED_RESERVATIONS_PER_DAY,
  RESERVATION_MINUTES,
  STATION_COOLDOWN_MINUTES,
  VEHICLE_TYPES,
  type Profile,
  type Reservation,
  type StationInput,
  type StationView,
  type UserRole,
} from "../src/lib/types";
import {
  addContact,
  currentUser,
  deleteAccount,
  register,
  registerFleetManager,
  registerMerchant,
  sendCode,
  sendContactCode,
  sendDeleteCode,
  signIn,
  signOut,
} from "./auth";
import {
  chargingPointsByStation,
  createDevice,
  deleteDevice,
  handleDeviceCommands,
  handleDeviceEvents,
  listDevices,
  liveFreePointsSql,
  notEvPointSql,
  onlineSince,
  startOutlet,
  stopOutlet,
} from "./devices";
import { normalizeDeviceId, type DeviceInput } from "../src/lib/iot/devices";
import type { PointPartnerInput } from "../src/lib/point-partners";
import {
  addPointPartnerAccount,
  adminPointPartners,
  pointPartnerDashboard,
  removePointPartnerAccount,
  savePointPartner,
  setDevicePartner,
  setPointPartnerStatus,
} from "./point-partners";
import { handleXingkeCallback } from "./xingke";
import type { ParcelDepotInput, ParcelInput, ParcelMeasures } from "../src/lib/parcels";
import {
  adminParcels,
  cancelParcel,
  createParcel,
  markLabelPrinted,
  closeStoredParcel,
  myParcels,
  parcelInfo,
  pickUpParcel,
  resendPickupCode,
  depotStatements,
  saveDepot,
  saveSizes,
  stationParcels,
} from "./parcels";
import { cancelRun, departRun, receiveParcel, removeRunParcel, scanRunParcel, startRun, stationRuns } from "./parcel-runs";
import {
  abandonJob,
  acceptJob,
  adminDrivers,
  approveProof,
  applyDriver,
  arriveAtDoor,
  assignJob,
  boardRide,
  reportPosition,
  askPayout,
  bookDelivery,
  bookPickup,
  bookRide,
  bookCourier,
  cancelJob,
  collectPickup,
  confirmCourierReceipt,
  customerThingsOpen,
  declineJob,
  deliverJob,
  driverAtStation,
  driverFile,
  driverHome,
  driverPass,
  failDelivery,
  finishRide,
  handToDriver,
  joinQueue,
  leaveQueue,
  myJobs,
  receiveFromDriver,
  reviewDriver,
  saveDriverSettings,
  saveFleetVehicle,
  settleDriver,
  stationDrivers,
  uploadDriverDocument,
  uploadProof,
} from "./drivers";
import type { DriverApplication, DriverDecision, FleetVehicleInput, PickupBooking, RideBooking, CourierBooking } from "../src/lib/drivers";
import {
  acceptInvite,
  adminFleets,
  approvedFleetFor,
  declineInvite,
  fleetAssign,
  fleetStatement,
  fleetStats,
  fleetView,
  inviteDriver,
  myFleetInvites,
  removeDriver,
  reviewFleet,
  revokeInvite,
  revokeOpenInvites,
  setDriverManager,
  setFleetTier,
} from "./fleet";
import type { FleetDecision, FleetInviteAnswer, FleetTier } from "../src/lib/fleet";
import {
  acceptMerchantInvite,
  addMerchantDriver,
  adminMerchants,
  adminRemoveEmployee,
  assignmentRequests,
  changeMerchantPay,
  checkIn,
  checkOut,
  confirmHoursReceived,
  declineMerchantInvite,
  decideAssignment,
  driverShops,
  endMerchantDriver,
  inviteEmployee,
  addMerchantAddress,
  confirmShopReturn,
  merchantActivity,
  merchantBookings,
  merchantStatistics,
  removeMerchantAddress,
  merchantCheckout,
  merchantView,
  myMerchantInvites,
  removeEmployee,
  reviewMerchant,
  revokeEmployeeInvite,
  setMerchantOwner,
  setMerchantTier,
  updateShop,
} from "./merchants";
import type {
  MerchantAddressInput,
  MerchantBookingsQuery,
  MerchantDecision,
  MerchantDriverInput,
  MerchantShopInput,
  MerchantStatsQuery,
  MerchantTier,
} from "../src/lib/merchants";
import type { PartnerInput } from "../src/lib/partners";
import { PARTNER_API_BASE } from "../src/lib/partners";
import {
  acceptBooking,
  adminPartners,
  createPartnerKey,
  handlePartnerApi,
  retryPartnerEvent,
  revokePartnerKey,
  rotatePartnerSecret,
  savePartner,
  stationBookings,
} from "./partners";
import type { Env } from "./env";
import { notifyUser } from "./notify";
import { getFeatures, PARCEL_ROUTE, parcelsEnabled, setDriversEnabled, setLiteEnabled, setParcelsEnabled } from "./features";
import { ApiError, json, nowIso, randomDigits, readJson, uuid } from "./http";
import { registerPushToken, removePushToken } from "./push";
import { adminPayouts, decidePayout } from "./trip-payments";
import { activeServices, decideService, listStationServices, requestService, requireService, setService } from "./services";
import { customerStation } from "../src/lib/station-services";
import { DB_CUSTOMER, refuseNonCustomer, roleFromDb, roleToDb } from "./roles";
import { claimFormerAccount, sendFormerAccountCode } from "./former-accounts";
import { myPayments, paymentCallback, refreshPayment, startPayment } from "./payments";
import {
  adjustBalance,
  adminWallet,
  counterCredit,
  createCreditCode,
  getWallet,
  setCreditMax,
  setStationGreenCredit,
  setWalletEnabled,
  setWalletFrozen,
  topUpCredit,
} from "./wallet";
import {
  adminGreenpoint,
  cancelRedemption,
  confirmRedemption,
  earnStatement,
  myGreenpoint,
  networkTotal,
  saveFactors,
  saveReward,
  setVehicle,
  startRedemption,
} from "./greenpoint";
import {
  adminCharging,
  cancelCharge,
  myCharges,
  payCash,
  payWithMobile,
  payWithWallet,
  saveChargeTariff,
  setQrStart,
  outletInfo,
  startOutletCharge,
  renewOutletQr,
  stopSelfCharge,
  startCharge,
  stationCharging,
  stopCharge,
} from "./charging";
import { adjustChargeCard, counterCardInfo, deleteChargeCard, listChargeCards, saveChargeCard, setChargeCardBlocked } from "./charge-cards";

// Rows as stored in D1 (snake_case, booleans as 0/1, JSON as text).

interface StationRow {
  id: string;
  operator_id: string;
  operator_name: string | null;
  is_own: number | null;
  name: string;
  address: string;
  lat: number;
  lng: number;
  kind: StationView["kind"];
  vehicle_types: string;
  charging_slots: number;
  battery_capacity: number;
  opening_hours: string;
  phone: string | null;
  is_active: number;
  is_open: number | null;
  free_slots: number | null;
  full_batteries: number | null;
  updated_at: string | null;
  reserved_slots: number;
  reserved_batteries: number;
  staff_count?: number;
  /** Missing before migration 0013. */
  has_battery?: number;
  /** Missing before migration 0019. */
  is_solar?: number;
  depot_active: number | null;
  depot_counter: number | null;
  depot_lockers: number | null;
  /** JSON arrays; missing before migration 0021. */
  photos?: string;
  amenities?: string;
  /** Missing before migration 0044. */
  main_activity?: string | null;
  rating_avg: number | null;
  rating_count: number;
}

interface PromotionRow {
  id: string;
  title: string;
  body: string;
  image_url: string | null;
  link_url: string | null;
  link_label: string | null;
  is_active: number;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}

const ROLES: UserRole[] = ["customer", "operator", "fleet_manager", "admin"];

function toStationView(r: StationRow): StationView & { isActive: boolean } {
  let vehicleTypes: StationView["vehicleTypes"] = [];
  try {
    vehicleTypes = JSON.parse(r.vehicle_types);
  } catch {}
  return {
    id: r.id,
    operatorId: r.operator_id,
    operatorName: r.operator_name ?? "",
    isOwn: !!r.is_own,
    name: r.name,
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    kind: r.has_battery === 0 ? "parcel" : r.kind,
    vehicleTypes,
    chargingSlots: r.charging_slots,
    batteryCapacity: r.battery_capacity,
    openingHours: r.opening_hours,
    phone: r.phone,
    isSolar: !!r.is_solar,
    isActive: !!r.is_active,
    status: {
      stationId: r.id,
      isOpen: !!r.is_open,
      freeSlots: r.free_slots ?? 0,
      fullBatteries: r.full_batteries ?? 0,
      updatedAt: r.updated_at ?? new Date(0).toISOString(),
    },
    reservedSlots: r.reserved_slots,
    reservedBatteries: r.reserved_batteries,
    parcelPoint: r.depot_active ? { counter: r.depot_counter !== 0, lockers: r.depot_lockers ?? 0 } : null,
    photos: cleanPhotos(parseJson(r.photos)),
    amenities: cleanAmenities(parseJson(r.amenities)),
    mainActivity: cleanMainActivity(r.main_activity),
    rating: { average: r.rating_avg ? Math.round(r.rating_avg * 10) / 10 : 0, count: r.rating_count ?? 0 },
    hasStaff: (r.staff_count ?? 1) > 0,
  };
}

function parseJson(text: string | undefined): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function toPromotion(r: PromotionRow): Promotion {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    imageUrl: r.image_url,
    linkUrl: r.link_url,
    linkLabel: r.link_label,
    isActive: !!r.is_active,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const STATION_SELECT = `
  select s.*, o.name as operator_name, o.is_own,
         st.is_open, st.free_slots, st.full_batteries, st.updated_at,
         pd.is_active as depot_active, pd.has_counter as depot_counter, pd.lockers as depot_lockers,
         (select count(*) from reservations r where r.station_id = s.id and r.status = 'active' and r.expires_at > ?1
            and r.kind = 'charging_point' and not ${evTargetSql("r")}) as reserved_slots,
         (select count(*) from reservations r where r.station_id = s.id and r.status = 'active' and r.expires_at > ?1 and r.kind = 'swap') as reserved_batteries,
         (select avg(rating) from station_reviews sr where sr.station_id = s.id) as rating_avg,
         (select count(*) from station_reviews sr where sr.station_id = s.id) as rating_count,
         (select count(*) from station_staff sf where sf.station_id = s.id)
           + (select count(*) from operator_owners oo where oo.operator_id = s.operator_id) as staff_count
  from stations s
  left join operators o on o.id = s.operator_id
  left join station_status st on st.station_id = s.id
  left join parcel_depots pd on pd.station_id = s.id`;

/** Everything a request handler needs. */
class Ctx {
  private userPromise: Promise<Profile | null> | null = null;
  /** Who acted at which station in this request (set by stationActor), logged once the action succeeded. */
  stationAction: { stationId: string; personId: string; role: StationRole } | null = null;
  constructor(
    readonly env: Env,
    readonly request: Request,
    readonly url: URL,
  ) {}

  get db() {
    return this.env.DB;
  }

  user(): Promise<Profile | null> {
    this.userPromise ??= currentUser(this.env, this.request);
    return this.userPromise;
  }

  async requireUser(): Promise<Profile> {
    const user = await this.user();
    if (!user) throw new ApiError("not_authenticated", 401);
    return user;
  }

  async requireAdmin(): Promise<Profile> {
    const user = await this.requireUser();
    if (user.role !== "admin") throw new ApiError("forbidden", 403);
    return user;
  }

  onStationActor(stationId: string, actor: StationActor) {
    this.stationAction = { stationId, personId: actor.user.id, role: actor.role };
  }

  /**
   * A station action (counter, charging, greenpoint visit, …) as a yes/no staff check for the
   * modules that take one: the active-station rule of stationActor (R7, 403 or 409), logged.
   */
  actAt = async (_user: Profile, stationId: string): Promise<boolean> => {
    await stationActor(this, stationId);
    return true;
  };

  /** Station staff, someone who runs the station's operator, or an admin. */
  async isStaffOf(user: Profile, stationId: string): Promise<boolean> {
    if (user.role === "admin") return true;
    // Station rights come with the role; assignments of anyone else count for nothing.
    if (user.role !== "operator") return false;
    const row = await this.db
      .prepare(
        `select 1 from stations s where s.id = ?1 and (
           exists (select 1 from station_staff where station_id = s.id and user_id = ?2)
           or exists (select 1 from operator_owners where operator_id = s.operator_id and user_id = ?2))`,
      )
      .bind(stationId, user.id)
      .first();
    return !!row;
  }

  /** Activity log entry (the Supabase version wrote these with a trigger). */
  audit(
    actor: string | null,
    table: AuditTable,
    action: AuditEntry["action"],
    rowId: string,
    changes: Record<string, unknown>,
    ids: { stationId?: string | null; userId?: string | null } = {},
  ) {
    return this.db
      .prepare(
        "insert into audit_log (at, actor, table_name, action, row_id, station_id, user_id, changes) values (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(nowIso(), actor, table, action, rowId, ids.stationId ?? null, ids.userId ?? null, JSON.stringify(changes));
  }

  async stations(where: string, ...params: unknown[]): Promise<(StationView & { isActive: boolean })[]> {
    const { results } = await this.db
      .prepare(`${STATION_SELECT} ${where} order by s.name`)
      .bind(nowIso(), ...params)
      .all<StationRow>();
    const [points, batteryTypes, evChargers, held] = await Promise.all([
      chargingPointsByStation(this.db),
      batteryTypesByStation(this.db),
      evChargersByStation(this.db),
      heldTargetsByStation(this.db),
    ]);
    return results.map((r) => {
      // What active reservations hold here: per battery type, outlet and car charger (src/lib/reservations.ts).
      const holds = held.get(r.id) ?? new Map<string, number>();
      const station = {
        ...toStationView(r),
        batteryTypes: (batteryTypes.get(r.id) ?? []).map((t) => ({ ...t, reserved: holds.get(`swap:${t.id}`) ?? 0 })),
        evChargers: (evChargers.get(r.id) ?? []).map((ev) => (holds.has(`charging_point:${ev.id}`) ? { ...ev, reserved: true } : ev)),
      };
      const chargingPoints = points.get(r.id)?.map((p) => (holds.has(`charging_point:${p.id}`) ? { ...p, reserved: true } : p));
      return chargingPoints ? { ...station, chargingPoints } : station;
    });
  }
}

/** `{column: [old, new]}` for the fields that changed. */
function diff(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) out[key] = [before[key] ?? null, after[key]];
  }
  return out;
}

function int(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100_000) throw new ApiError("bad_request");
  return Math.floor(n);
}

// Customers --------------------------------------------------------------------

/**
 * POST /api/reservations { stationId, kind, target } (or the older { stationId, type }).
 * Riders only. A swap reservation names a battery type the station has a free full
 * battery of; a charging reservation names a free connected outlet or car charger, or,
 * at a station without connected outlets, takes a free place of the staff's count.
 * Holding never changes the battery counter (src/lib/reservations.ts).
 */
async function reserve(c: Ctx, input: { stationId?: unknown; kind?: unknown; type?: unknown; target?: unknown }): Promise<Reservation> {
  const user = await c.requireUser();
  // Only riders reserve; staff, drivers' fleet managers and admins do not (role matrix).
  if (user.role !== "customer") throw new ApiError("forbidden", 403);
  // A confirmed phone number: e-mail accounts are free to make, so they alone cannot hold stock (point 8).
  if (!user.phone) throw new ApiError("phone_required");
  const stationId = String(input?.stationId ?? "");
  const kind = kindFrom(input?.kind ?? input?.type);
  if (!kind) throw new ApiError("bad_request");
  const wanted = input?.target === undefined || input?.target === null || input?.target === "" ? null : String(input.target);
  const now = nowIso();

  await c.db
    .prepare("update reservations set status = 'expired' where user_id = ? and status = 'active' and expires_at <= ?")
    .bind(user.id, now)
    .run();

  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const cooldownSince = new Date(Date.now() - STATION_COOLDOWN_MINUTES * 60_000).toISOString();
  const checks = await c.db
    .prepare(
      `select
         (select count(*) from reservations where user_id = ?1 and status = 'active') as active,
         (select count(*) from reservations where user_id = ?1 and status in ('cancelled', 'expired') and cancel_reason is null and created_at > ?2) as unused,
         (select count(*) from reservations where user_id = ?1 and station_id = ?3 and status in ('cancelled', 'expired') and cancel_reason is null and created_at > ?4) as recent_here`,
    )
    .bind(user.id, dayAgo, stationId, cooldownSince)
    .first<{ active: number; unused: number; recent_here: number }>();
  if (checks?.active) throw new ApiError("already_reserved");
  if ((checks?.unused ?? 0) >= MAX_UNUSED_RESERVATIONS_PER_DAY) throw new ApiError("daily_limit");
  if (checks?.recent_here) throw new ApiError("cooldown");

  const [station] = await c.stations("where s.id = ?2 and s.is_active = 1", stationId);
  if (!station) throw new ApiError("station_not_found", 404);
  if (!station.status.isOpen || !withinOpeningHours(station.openingHours)) throw new ApiError("station_closed");

  // What the reservation holds, and the condition for it to be free (checked in the insert itself).
  let target: string | null = null;
  let free: string;
  let refused: "none_available" | "battery_type_unavailable" | "outlet_busy" = "none_available";
  if (kind === "swap") {
    if (!offersSwap(station.kind)) throw new ApiError("service_not_offered");
    // The station must be unlocked for the service, and its global switch on (worker/services.ts).
    await requireService(c.db, stationId, "swap");
    const types = station.batteryTypes ?? [];
    if (types.length) {
      // A type: one the station swaps (active), named by the customer unless it is the only one.
      if (!wanted && types.length > 1) throw new ApiError("battery_type_required");
      const type = wanted ? types.find((t) => t.id === wanted) : types[0];
      if (!type || !type.isActive) throw new ApiError("battery_type_unavailable");
      target = type.id;
      refused = "battery_type_unavailable";
      free = `(select full_batteries from station_battery_types where station_id = ?3 and battery_type_id = ?9) - ${heldBatteriesSql("?3", "?9", "?5")} > 0`;
    } else {
      if (wanted) throw new ApiError("battery_type_unavailable");
      free = `(select full_batteries from station_status where station_id = ?3) - ${heldBatteriesSql("?3", "''", "?5")} > 0`;
    }
  } else if (wanted) {
    const point = (station.chargingPoints ?? []).find((p) => p.id === wanted && p.deviceId);
    const ev = point ? null : (station.evChargers ?? []).find((x) => x.id === wanted);
    if (!point && !ev) throw new ApiError("not_found", 404);
    const notHeld = `not exists (select 1 from reservations where station_id = ?3 and kind = 'charging_point' and target = ?9 and status = 'active' and expires_at > ?5)`;
    refused = "outlet_busy";
    if (point) {
      if (!offersCharging(station.kind)) throw new ApiError("service_not_offered");
      await requireService(c.db, stationId, "charging");
      // A connected outlet: reporting, free, held by nobody; older holds without an outlet still count.
      free = `exists (select 1 from charging_points where id = ?9 and station_id = ?3 and device_id is not null and status = 'free' and last_seen_at > ?8)
        and ${notHeld}
        and ${liveFreePointsSql("?3", "?8")} - (select count(*) from reservations r where r.station_id = ?3 and r.kind = 'charging_point' and r.status = 'active'
              and r.expires_at > ?5 and not ${evTargetSql("r")}) > 0`;
    } else {
      // A car charger: active at this station, held by nobody; a connected one (0048) also free and reporting.
      await requireService(c.db, stationId, "ev");
      free = `exists (select 1 from ev_chargers e where e.id = ?9 and e.station_id = ?3 and e.is_active = 1
                and (e.point_id is null or exists (select 1 from charging_points p where p.id = e.point_id and p.status = 'free' and p.last_seen_at > ?8)))
        and ${notHeld}`;
    }
    target = wanted;
  } else {
    if (!offersCharging(station.kind)) throw new ApiError("service_not_offered");
    await requireService(c.db, stationId, "charging");
    // With connected outlets the customer picks one; otherwise a free place of the staff's count.
    if ((station.chargingPoints ?? []).some((p) => p.deviceId)) throw new ApiError("outlet_required");
    free = `(select free_slots from station_status where station_id = ?3)
      - (select count(*) from reservations where station_id = ?3 and kind = 'charging_point' and target is null and status = 'active' and expires_at > ?5) > 0`;
  }
  // No phone and no staff: nobody answers for the hold, so the station is greyed out in the app.
  if (isUnattended(station)) throw new ApiError("station_unattended");
  // Reservations take at most half of the station's stock; the insert checks it again. When
  // everything is held already, the usual answer (none available) says it better.
  const hold = await c.db
    .prepare(`select ${heldOfKindSql(kind, "?1", "?2")} as held, ${holdStockSql(kind, "?1")} as stock`)
    .bind(stationId, now)
    .first<{ held: number; stock: number }>();
  if (hold && hold.held >= Math.max(1, Math.ceil(hold.stock / 2)) && hold.held < hold.stock) throw new ApiError("hold_limit");

  const id = uuid();
  const code = randomDigits(4);
  const expires = new Date(Date.now() + RESERVATION_MINUTES * 60_000).toISOString();
  const type = typeOfKind(kind);
  let inserted: D1Result;
  try {
    // The availability check and the insert are one statement, so two customers
    // cannot take the last battery of a type or the same outlet at once.
    inserted = await c.db
      .prepare(
        `insert into reservations (id, user_id, station_id, type, kind, target, charging_point_id, status, created_at, expires_at, pickup_code)
         select ?1, ?2, ?3, ?4, ?10, ?9, ?11, 'active', ?5, ?6, ?7
         where ${free} and ${holdRoomSql(kind, "?3", "?5")}`,
      )
      .bind(
        id,
        user.id,
        stationId,
        type,
        now,
        expires,
        code,
        onlineSince(),
        target,
        kind,
        kind === "charging_point" && target && (station.chargingPoints ?? []).some((p) => p.id === target) ? target : null,
      )
      .run();
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) throw new ApiError("already_reserved");
    throw err;
  }
  if (!inserted.meta.changes) throw new ApiError(refused);
  await c.audit(user.id, "reservations", "insert", id, { type, kind, target, status: "active", expires_at: expires }, {
    stationId,
    userId: user.id,
  }).run();
  const row = await c.db.prepare(`${RESERVATION_SELECT} where r.id = ?`).bind(id).first<ReservationRow>();
  return toReservation(row!, { withCode: true });
}

async function myReservations(c: Ctx): Promise<Reservation[]> {
  const user = await c.user();
  if (!user) return [];
  const { results } = await c.db
    .prepare(`${RESERVATION_SELECT} where r.user_id = ? order by r.created_at desc limit 50`)
    .bind(user.id)
    .all<ReservationRow>();
  return results.map((r) => toReservation(r, { withCode: true }));
}

async function cancelReservation(c: Ctx, id: string) {
  const user = await c.requireUser();
  const r = await c.db.prepare("select * from reservations where id = ?").bind(id).first<ReservationRow>();
  if (!r) throw new ApiError("forbidden", 403);
  const own = r.user_id === user.id;
  if (!own && user.role !== "admin") throw new ApiError("forbidden", 403);
  if (r.status !== "active") throw new ApiError("reservation_not_active");
  // Cancelled by the team: does not count against the customer's limits.
  const reason = own ? null : "admin";
  await c.db.batch([
    c.db
      .prepare("update reservations set status = 'cancelled', cancel_reason = ? where id = ? and status = 'active'")
      .bind(reason, id),
    c.audit(user.id, "reservations", "update", id, { status: ["active", "cancelled"], ...(reason ? { cancel_reason: [null, reason] } : {}) }, {
      stationId: r.station_id,
      userId: r.user_id,
    }),
  ]);
}

// Station staff -------------------------------------------------------------

/** The stations the person works at, each with its active services and the person's role there (station home tiles). */
/** The signed-in customer (or an admin, to test): payments, charges and greenpoint redemptions (R2, R11). */
async function customerUser(c: Ctx): Promise<Profile> {
  const user = await c.requireUser();
  refuseNonCustomer(user);
  return user;
}

async function staffStations(c: Ctx) {
  const user = await c.requireUser();
  // Station work is for staff, owners and admins (R2): everyone else 403.
  if (user.role !== "admin" && user.role !== "operator") throw new ApiError("forbidden", 403);
  const [stations, active, owned, creditIds] = await Promise.all([
    user.role === "admin"
      ? c.stations("where s.is_active = 1")
      : c.stations(
          `where s.is_active = 1 and (s.id in (select station_id from station_staff where user_id = ?2)
             or s.operator_id in (select operator_id from operator_owners where user_id = ?2))`,
          user.id,
        ),
    activeServices(c.db),
    c.db.prepare("select operator_id from operator_owners where user_id = ?").bind(user.id).all<{ operator_id: string }>(),
    c.db.prepare("select id from stations where green_credit = 1").all<{ id: string }>(),
  ]);
  const owner = new Set(owned.results.map((r) => r.operator_id));
  const credit = new Set(creditIds.results.map((r) => r.id));
  return stations.map((s) => ({
    ...s,
    activeServices: [...(active.get(s.id) ?? [])],
    greenCredit: credit.has(s.id),
    myRole: user.role === "admin" ? ("admin" as const) : owner.has(s.operatorId) ? ("owner" as const) : ("staff" as const),
  }));
}

/**
 * PATCH /api/stations/:id/status: open/close and free charging places, at the active station (R7).
 * Full batteries change only through counter events (worker/station-work.ts), never as a number.
 * R17: closing cancels the reservations still holding (the number the closing warning shows:
 * active and not past their expiry), tells each customer, and answers how many were cancelled.
 * Reservations already past their expiry become expired, as they would anyway.
 */
async function updateStatus(
  c: Ctx,
  stationId: string,
  patch: { isOpen?: boolean; freeSlots?: number; fullBatteries?: unknown; typeBatteries?: unknown },
): Promise<{ cancelled: number }> {
  const { user } = await stationActor(c, stationId);
  if (patch.fullBatteries !== undefined || patch.typeBatteries !== undefined) throw new ApiError("bad_request");
  // "false" as text would open the station.
  if (patch.isOpen !== undefined && typeof patch.isOpen !== "boolean") throw new ApiError("bad_request");
  const before = await c.db
    .prepare("select is_open, free_slots from station_status where station_id = ?")
    .bind(stationId)
    .first<{ is_open: number; free_slots: number }>();
  if (!before) throw new ApiError("station_not_found", 404);
  const after = {
    is_open: patch.isOpen === undefined ? before.is_open : patch.isOpen ? 1 : 0,
    free_slots: patch.freeSlots === undefined ? before.free_slots : int(patch.freeSlots),
  };
  const now = nowIso();
  const statements = [
    c.db
      .prepare("update station_status set is_open = ?, free_slots = ?, updated_at = ?, updated_by = ? where station_id = ?")
      .bind(after.is_open, after.free_slots, now, user.id, stationId),
  ];
  const changes: Record<string, unknown> = diff(before, after);
  if (Object.keys(changes).length) {
    statements.push(c.audit(user.id, "station_status", "update", stationId, changes, { stationId }));
  }
  // Closing a station cancels its active reservations, so customers do not ride there for nothing.
  let cancelled: { id: string; user_id: string }[] = [];
  if (before.is_open && !after.is_open) {
    cancelled = (
      await c.db
        .prepare("select id, user_id from reservations where station_id = ? and status = 'active' and expires_at > ?")
        .bind(stationId, now)
        .all<{ id: string; user_id: string }>()
    ).results;
    statements.push(c.db.prepare("update reservations set status = 'expired' where station_id = ? and status = 'active' and expires_at <= ?").bind(stationId, now));
    for (const r of cancelled) {
      statements.push(
        c.db
          .prepare("update reservations set status = 'cancelled', cancel_reason = 'station_closed' where id = ? and status = 'active'")
          .bind(r.id),
        c.audit(user.id, "reservations", "update", r.id, { status: ["active", "cancelled"], cancel_reason: [null, "station_closed"] }, {
          stationId,
          userId: r.user_id,
        }),
      );
    }
  }
  await c.db.batch(statements);
  if (cancelled.length) {
    const station = await c.db.prepare("select name from stations where id = ?").bind(stationId).first<{ name: string }>();
    await Promise.all(
      cancelled.map((r) =>
        notifyUser(c.env, r.user_id, {
          subject: "Réservation annulée : station fermée",
          text: `poinderecharge : la station ${station?.name ?? ""} vient de fermer. Votre réservation est annulée et ne compte pas dans vos limites.`,
        }),
      ),
    );
  }
  return { cancelled: cancelled.length };
}

async function stationReservations(c: Ctx, stationId: string) {
  const user = await c.requireUser();
  if (!(await c.isStaffOf(user, stationId))) throw new ApiError("forbidden", 403);
  const { results } = await c.db
    .prepare(`${RESERVATION_SELECT} where r.station_id = ? order by r.created_at desc limit 50`)
    .bind(stationId)
    .all<ReservationRow>();
  // Staff never see pickup codes: the customer tells them at the station. They see who reserved what.
  return results.map((r) => toReservation(r, { withCustomer: true }));
}

/**
 * POST /api/reservations/:id/complete { pickupCode }: a charging reservation is used.
 * A battery reservation is completed by its swap (the swap form, recordSwap with the
 * reservation), so it is refused here. A charge at a connected outlet is completed by
 * starting it (worker/charging.ts); this completes a car charger or a counted place,
 * and a connected outlet whose socket cannot be started.
 */
async function completeReservation(c: Ctx, id: string, pickupCode: unknown) {
  const user = await c.requireUser();
  const r = await c.db.prepare(`${RESERVATION_SELECT} where r.id = ?`).bind(id).first<ReservationRow>();
  if (!r || !(await c.isStaffOf(user, r.station_id))) throw new ApiError("forbidden", 403);
  // At the active station only (R7), logged with the person's role.
  await stationActor(c, r.station_id);
  if (r.user_id === user.id) throw new ApiError("own_reservation");
  if (r.kind === "swap") throw new ApiError("swap_required", 409);
  if (!stillActive(r)) throw new ApiError("reservation_not_active");
  await checkPickupCode(c.db, r, pickupCode);
  const done = await c.db
    .prepare("update reservations set status = 'completed' where id = ? and status = 'active'")
    .bind(id)
    .run();
  if (!done.meta.changes) throw new ApiError("reservation_not_active");
  // The rider's CO2 and greenpoints for this charge (worker/greenpoint.ts).
  const earned = await earnStatement(c.db, { userId: r.user_id, type: r.type, stationId: r.station_id, reservationId: id, createdBy: user.id });
  await c.db.batch([
    // A counted place comes off the staff's count, so the map does not show it as free again.
    // Connected outlets and car chargers have no such count.
    ...(r.target_kind === "place"
      ? [
          c.db
            .prepare("update station_status set free_slots = max(free_slots - 1, 0), updated_at = ?, updated_by = ? where station_id = ?")
            .bind(nowIso(), user.id, r.station_id),
        ]
      : []),
    c.audit(user.id, "reservations", "update", id, { status: ["active", "completed"] }, {
      stationId: r.station_id,
      userId: r.user_id,
    }),
    ...(earned ? [earned.statement] : []),
  ]);
}

// Admin ---------------------------------------------------------------------

async function listOperators(c: Ctx) {
  const { results } = await c.db
    .prepare("select id, name, is_own from operators order by name")
    .all<{ id: string; name: string; is_own: number }>();
  return results.map((o) => ({ id: o.id, name: o.name, isOwn: !!o.is_own }));
}

function stationRow(input: StationInput) {
  if (!input || typeof input.name !== "string" || !input.name.trim()) throw new ApiError("bad_request");
  if (!["charging", "swap", "both", "parcel"].includes(input.kind)) throw new ApiError("bad_request");
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) throw new ApiError("bad_request");
  return {
    operator_id: String(input.operatorId),
    name: input.name.trim(),
    address: String(input.address ?? ""),
    lat,
    lng,
    // The column only knows battery services; a parcel point keeps a valid value and has_battery = 0.
    kind: input.kind === "parcel" ? "charging" : input.kind,
    has_battery: input.kind === "parcel" ? 0 : 1,
    vehicle_types: JSON.stringify((input.vehicleTypes ?? []).filter((v) => VEHICLE_TYPES.includes(v))),
    battery_capacity: int(input.batteryCapacity),
    // Days and times, never empty (src/lib/opening-hours.ts).
    opening_hours: cleanOpeningHours(input.openingHours) ?? (() => {
      throw new ApiError("opening_hours_invalid");
    })(),
    phone: stationPhone(input.phone),
  };
}

/** A station's phone: empty, or a real Togolese number, so "has a phone" (isUnattended) means one can call. */
function stationPhone(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const phone = normalizeTogoPhone(text);
  if (!phone) throw new ApiError("phone_not_allowed");
  return phone;
}

/** Charging places of station ?{station}: its connected outlets. */
const CONNECTED_OUTLETS_SQL = (station: string) =>
  `(select count(*) from charging_points where station_id = ${station} and device_id is not null and ${notEvPointSql("charging_points")})`;

/**
 * Creates or updates a station, and its parcel depot when the input has one. A station must
 * offer at least one of swap, charging, parcel counter or parcel lockers (src/lib/station-points.ts).
 */
async function saveStation(c: Ctx, id: string | null, input: StationInput) {
  const admin = await c.requireAdmin();
  const row = stationRow(input);
  const depotInput = input.parcelDepot ?? null;
  const existingDepot = id
    ? await c.db.prepare("select is_active, has_counter, lockers from parcel_depots where station_id = ?").bind(id).first<{ is_active: number; has_counter: number | null; lockers: number }>()
    : null;
  const depot = depotPoints(
    depotInput ?? (existingDepot && { isActive: !!existingDepot.is_active, counter: existingDepot.has_counter !== 0, lockers: existingDepot.lockers }),
  );
  if (!hasAnyPoint({ swap: offersSwap(input.kind), charging: offersCharging(input.kind), ...depot })) {
    throw new ApiError("station_without_point");
  }
  const now = nowIso();
  const stationId = id ?? uuid();
  const types = input.batteryTypeIds
    ? await stationBatteryTypeStatements(c.db, stationId, input.batteryTypeIds, offersSwap(input.kind))
    : null;
  // Photos, amenities, main activity and the solar mark: left out of the input means unchanged (a new station is not solar).
  const extras = {
    // Data URLs are for the demo only; real photos live in R2.
    ...(input.photos ? { photos: JSON.stringify(cleanPhotos(input.photos).filter((u) => !u.startsWith("data:"))) } : {}),
    ...(input.amenities ? { amenities: JSON.stringify(cleanAmenities(input.amenities)) } : {}),
    ...(input.isSolar !== undefined ? { is_solar: input.isSolar ? 1 : 0 } : {}),
    ...(input.mainActivity !== undefined ? { main_activity: cleanMainActivity(input.mainActivity) } : {}),
  };
  const extraStatements = Object.entries(extras).map(([column, value]) =>
    c.db.prepare(`update stations set ${column} = ? where id = ?`).bind(value, stationId),
  );
  if (id) {
    const before = await c.db
      .prepare(
        "select operator_id, name, address, lat, lng, kind, has_battery, vehicle_types, battery_capacity, opening_hours, phone, photos, amenities, is_solar, main_activity from stations where id = ?",
      )
      .bind(id)
      .first<Record<string, unknown>>();
    if (!before) throw new ApiError("station_not_found", 404);
    // A lower capacity brings the full batteries down to it, as counter corrections (principle 4).
    const trims =
      row.battery_capacity < Number(before.battery_capacity)
        ? await capacityTrimStatements(c.db, id, row.battery_capacity, { user: admin, role: "admin" })
        : [];
    await c.db.batch([
      c.db
        .prepare(
          `update stations set operator_id = ?, name = ?, address = ?, lat = ?, lng = ?, kind = ?, has_battery = ?, vehicle_types = ?,
           battery_capacity = ?, opening_hours = ?, phone = ?, charging_slots = ${CONNECTED_OUTLETS_SQL("stations.id")} where id = ?`,
        )
        .bind(...Object.values(row), id),
      c.audit(admin.id, "stations", "update", id, { ...diff(before, { ...row, ...extras }), ...(types ? { battery_types: types.labels } : {}) }, { stationId: id }),
      ...(depotInput ? await depotStatements(c, admin.id, id, depotInput) : []),
      ...(types?.statements ?? []),
      ...extraStatements,
      ...trims,
    ]);
    return;
  }
  const newId = stationId;
  await c.db.batch([
    c.db
      .prepare(
        `insert into stations (id, operator_id, name, address, lat, lng, kind, has_battery, vehicle_types,
         battery_capacity, opening_hours, phone, charging_slots, is_active, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)`,
      )
      .bind(newId, ...Object.values(row), now),
    // A new station starts closed and empty: staff open it and mark batteries full as they come.
    c.db.prepare("insert into station_status (station_id, is_open, free_slots, full_batteries, updated_at) values (?, 0, 0, 0, ?)").bind(newId, now),
    c.audit(admin.id, "stations", "insert", newId, { ...row, ...extras, ...(types ? { battery_types: types.labels } : {}) }, { stationId: newId }),
    ...(depotInput ? await depotStatements(c, admin.id, newId, depotInput) : []),
    ...(types?.statements ?? []),
    ...extraStatements,
  ]);
}

/**
 * Active stations for the app, with the active battery types they swap, showing only
 * the services active there (global switch on AND station unlocked, worker/services.ts):
 * with the parcel module off, parcel points are left out; in the Lite version, car chargers too.
 */
async function publicStations(c: Ctx) {
  const [all, features, active] = await Promise.all([c.stations("where s.is_active = 1"), getFeatures(c.env), activeServices(c.db)]);
  const stations = all
    .filter((s) => features.parcels || s.kind !== "parcel")
    .map((s) => customerStation({ ...s, batteryTypes: (s.batteryTypes ?? []).filter((t) => t.isActive) }, active.get(s.id) ?? new Set()));
  return stations.filter((s) => s !== null);
}

async function adminSnapshot(c: Ctx): Promise<AdminSnapshot> {
  await c.requireAdmin();
  // The dashboard's figures look back two weeks at most; the reservations table pages on its own.
  const since = new Date(Date.now() - SNAPSHOT_RESERVATION_DAYS * 86_400_000).toISOString();
  const [stations, users, staff, reservations, points] = await Promise.all([
    c.stations(""),
    c.db
      .prepare("select id, phone, email, full_name, role, created_at, last_sign_in_at from users order by created_at desc")
      .all<{
        id: string;
        phone: string | null;
        email: string | null;
        full_name: string | null;
        role: string;
        created_at: string;
        last_sign_in_at: string | null;
      }>(),
    c.db.prepare("select station_id, user_id from station_staff").all<{ station_id: string; user_id: string }>(),
    c.db
      .prepare("select * from reservations where created_at >= ? order by created_at desc limit 2000")
      .bind(since)
      .all<ReservationRow>(),
    c.db
      .prepare("select id, station_id, label, status, device_id, last_seen_at from charging_points order by label")
      .all<{ id: string; station_id: string; label: string; status: ChargingPointInfo["status"]; device_id: string | null; last_seen_at: string | null }>(),
  ]);
  return {
    stations,
    users: users.results.map((u) => ({
      id: u.id,
      phone: u.phone,
      email: u.email,
      fullName: u.full_name,
      role: roleFromDb(u.role),
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at,
    })),
    staff: staff.results.map((s) => ({ stationId: s.station_id, userId: s.user_id })),
    reservations: reservations.results.map((r) => toReservation(r)),
    chargingPoints: points.results.map((p) => ({
      id: p.id,
      stationId: p.station_id,
      label: p.label,
      status: p.status,
      deviceId: p.device_id,
      lastSeenAt: p.last_seen_at,
    })),
  };
}

/**
 * GET /api/admin/reservations?status=&stationId=&search=&offset=&limit=: one page of the
 * reservations of the last ADMIN_HISTORY_DAYS days, newest first, with the total.
 */
async function adminReservations(c: Ctx): Promise<AdminReservationPage> {
  await c.requireAdmin();
  const q = c.url.searchParams;
  const now = nowIso();
  const since = new Date(Date.now() - ADMIN_HISTORY_DAYS * 86_400_000).toISOString();
  const where = ["r.created_at >= ?1"];
  const params: unknown[] = [since];
  const add = (clause: string, ...values: unknown[]) => {
    where.push(clause.replace(/\?(\d)/g, (_, n) => `?${params.length + Number(n)}`));
    params.push(...values);
  };
  const status = q.get("status");
  if (status === "active") add("r.status = 'active' and r.expires_at > ?1", now);
  else if (status === "expired") add("(r.status = 'expired' or (r.status = 'active' and r.expires_at <= ?1))", now);
  else if (status === "completed" || status === "cancelled") add("r.status = ?1", status);
  const stationId = q.get("stationId");
  if (stationId) add("r.station_id = ?1", stationId);
  const search = (q.get("search") ?? "").trim().toLowerCase().slice(0, 80);
  if (search) add("(lower(coalesce(u.full_name, '')) like ?1 or coalesce(u.phone, '') like ?1 or lower(coalesce(u.email, '')) like ?1)", `%${search}%`);
  const limit = Math.min(Math.max(Number(q.get("limit")) || ADMIN_PAGE_SIZE, 1), 200);
  const offset = Math.max(Number(q.get("offset")) || 0, 0);
  const clause = where.join(" and ");
  const [rows, total] = await Promise.all([
    c.db
      .prepare(`${RESERVATION_SELECT} where ${clause} order by r.created_at desc limit ${limit} offset ${offset}`)
      .bind(...params)
      .all<ReservationRow>(),
    c.db
      .prepare(`select count(*) as n from reservations r left join users u on u.id = r.user_id where ${clause}`)
      .bind(...params)
      .first<{ n: number }>(),
  ]);
  return { rows: rows.results.map((r) => toReservation(r, { withCustomer: true })), total: total?.n ?? 0 };
}

async function auditLog(c: Ctx): Promise<AuditEntry[]> {
  await c.requireAdmin();
  const q = c.url.searchParams;
  const where: string[] = [];
  const params: unknown[] = [];
  const filters: [string, string, (v: string) => unknown][] = [
    ["table", "table_name = ?", String],
    ["actorId", "actor = ?", String],
    ["stationId", "station_id = ?", String],
    ["beforeId", "id < ?", Number],
  ];
  for (const [key, clause, cast] of filters) {
    const value = q.get(key);
    if (!value) continue;
    where.push(clause);
    params.push(cast(value));
  }
  const limit = Math.min(Math.max(Number(q.get("limit")) || 100, 1), 1000);
  const { results } = await c.db
    .prepare(`select * from audit_log ${where.length ? `where ${where.join(" and ")}` : ""} order by id desc limit ${limit}`)
    .bind(...params)
    .all<{ id: number; at: string; actor: string | null; table_name: AuditTable; action: AuditEntry["action"]; row_id: string; station_id: string | null; user_id: string | null; changes: string }>();
  return results.map((r) => ({
    id: r.id,
    at: r.at,
    actorId: r.actor,
    table: r.table_name,
    action: r.action,
    rowId: r.row_id,
    stationId: r.station_id,
    userId: r.user_id,
    changes: JSON.parse(r.changes || "{}"),
  }));
}

async function setUserRole(c: Ctx, userId: string, role: UserRole) {
  const admin = await c.requireAdmin();
  if (!ROLES.includes(role)) throw new ApiError("bad_request");
  if (userId === admin.id) throw new ApiError("forbidden", 403);
  const row = await c.db.prepare("select role from users where id = ?").bind(userId).first<{ role: string }>();
  if (!row) throw new ApiError("forbidden", 403);
  const before = roleFromDb(row.role);
  if (before === role) return;
  // Driver accounts come and go through the driver backoffice only (approve, release; R15),
  // merchant accounts through their shop (register, invite, remove: worker/merchants.ts).
  if (before === "driver" || before === "merchant") throw new ApiError("has_other_role");
  // R15: staff become something else only once removed from their station (no silent removal).
  if (role !== "operator" && (await c.db.prepare("select 1 from station_staff where user_id = ?").bind(userId).first())) {
    throw new ApiError("role_change_blocked", 409);
  }
  // Menu and rights follow the role: leaving "operator" ends every station assignment and operator account.
  const [staff, owned] =
    role === "operator"
      ? [[], []]
      : await Promise.all([
          c.db.prepare("select station_id from station_staff where user_id = ?").bind(userId).all<{ station_id: string }>().then((r) => r.results),
          c.db.prepare("select operator_id from operator_owners where user_id = ?").bind(userId).all<{ operator_id: string }>().then((r) => r.results),
        ]);
  // Leaving "fleet_manager" ends the links to the drivers.
  const managed =
    role === "fleet_manager"
      ? []
      : (await c.db.prepare("select driver_id from fleet_manager_drivers where manager_id = ?").bind(userId).all<{ driver_id: string }>()).results;
  const name = role === "fleet_manager" ? (await c.db.prepare("select full_name from users where id = ?").bind(userId).first<{ full_name: string | null }>())?.full_name ?? null : null;
  await c.db.batch([
    c.db.prepare("update users set role = ? where id = ?").bind(roleToDb(role), userId),
    c.audit(admin.id, "profiles", "update", userId, { role: [before, role] }, { userId }),
    // A fleet manager made by an admin gets an approved fleet (worker/fleet.ts); leaving the role ends its open invites.
    ...(role === "fleet_manager" ? [approvedFleetFor(c.db, userId, name, admin.id)] : []),
    ...(before === "fleet_manager" ? [revokeOpenInvites(c.db, userId)] : []),
    ...(staff.length ? [c.db.prepare("delete from station_staff where user_id = ?").bind(userId)] : []),
    ...staff.map((s) => c.audit(admin.id, "station_staff", "delete", `${s.station_id}:${userId}`, {}, { stationId: s.station_id, userId })),
    ...(owned.length ? [c.db.prepare("delete from operator_owners where user_id = ?").bind(userId)] : []),
    ...owned.map((o) => c.audit(admin.id, "operator_owners", "delete", `${o.operator_id}:${userId}`, { operator_id: o.operator_id }, { userId })),
    ...managed.map((d) => c.db.prepare("delete from fleet_manager_drivers where driver_id = ?").bind(d.driver_id)),
    ...managed.map((d) => c.audit(admin.id, "fleet_manager_drivers", "delete", d.driver_id, { manager_id: userId }, { userId: d.driver_id })),
  ]);
}

/** Whoever gets station work becomes "operator" (customers only; admins stay admins), so the menu and rights match. */
const promoteToOperator = (c: Ctx, userId: string) =>
  c.db.prepare("update users set role = 'operator' where id = ? and role = ?").bind(userId, DB_CUSTOMER);

/** One role per person: a fleet manager would lose their drivers (worker/fleet.ts), a driver is a driver only. */
async function refuseOtherRole(c: Ctx, userId: string) {
  const row = await c.db.prepare("select role from users where id = ?").bind(userId).first<{ role: string }>();
  if (row?.role === "fleet_manager" || row?.role === "driver" || row?.role === "merchant") throw new ApiError("has_other_role");
}

/** Whoever has no station and runs no operator any more goes back to customer. */
const demoteIfIdle = (c: Ctx, userId: string) =>
  c.db
    .prepare(
      `update users set role = ?2 where id = ?1 and role = 'operator'
         and not exists (select 1 from station_staff where user_id = ?1)
         and not exists (select 1 from operator_owners where user_id = ?1)`,
    )
    .bind(userId, DB_CUSTOMER);

async function assignStaff(c: Ctx, stationId: string, userId: string) {
  const admin = await c.requireAdmin();
  await addStaff(c, admin.id, stationId, userId);
}

async function unassignStaff(c: Ctx, stationId: string, userId: string) {
  const admin = await c.requireAdmin();
  await removeStaff(c, admin.id, stationId, userId);
}

/**
 * The checks before an account becomes staff of a station (addStaff, and accepting a staff
 * invite): true when it already is staff there, an error when it may not become staff.
 */
async function checkStaffable(c: Ctx, stationId: string, userId: string): Promise<boolean> {
  await refuseOtherRole(c, userId);
  const row = await c.db
    .prepare(
      `select u.role, u.phone, (select station_id from station_staff where user_id = u.id) as station_id,
              exists (select 1 from operator_owners where user_id = u.id) as owner
       from users u where u.id = ?`,
    )
    .bind(userId)
    .first<{ role: string; phone: string | null; station_id: string | null; owner: number }>();
  if (!row) throw new ApiError("account_not_found", 404);
  if (row.station_id === stationId) return true;
  if (row.station_id) throw new ApiError("staff_other_station", 409);
  if (row.owner) throw new ApiError("has_other_role", 409);
  if (row.role === DB_CUSTOMER && (await customerThingsOpen(c.db, userId, row.phone))) throw new ApiError("role_change_blocked", 409);
  return false;
}

/**
 * Makes the account staff of one station (W2: exactly one; a second station is refused with
 * 409, the person is moved instead). Owners run their stations through operator_owners and
 * are never staff. A customer becomes staff only with nothing open (R15).
 */
async function addStaff(c: Ctx, actorId: string, stationId: string, userId: string) {
  if (await checkStaffable(c, stationId, userId)) return;
  try {
    await c.db.prepare("insert into station_staff (station_id, user_id) values (?, ?)").bind(stationId, userId).run();
  } catch (err) {
    // Assigned elsewhere in the meantime (unique index station_staff_one_station).
    if (/UNIQUE/i.test(String(err))) throw new ApiError("staff_other_station", 409);
    throw err;
  }
  // The role follows the assignment; the owner's list to re-staff loses this station for the person.
  await c.db.batch([
    c.audit(actorId, "station_staff", "insert", `${stationId}:${userId}`, {}, { stationId, userId }),
    promoteToOperator(c, userId),
    resolveReassignments(c, actorId, userId, stationId),
  ]);
}

/** Open entries of the re-staff list for this person at this station are done. */
const resolveReassignments = (c: Ctx, actorId: string, userId: string, stationId: string) =>
  c.db
    .prepare("update staff_reassignments set resolved_at = ?, resolved_by = ? where user_id = ? and station_id = ? and resolved_at is null")
    .bind(nowIso(), actorId, userId, stationId);

/** An owner of some operator, or an admin: checked before anything is looked up (R2). Staff 403. */
async function requireAnyOwner(c: Ctx): Promise<Profile> {
  const user = await c.requireUser();
  if (user.role === "admin") return user;
  const owner = user.role === "operator" && (await c.db.prepare("select 1 from operator_owners where user_id = ?").bind(user.id).first());
  if (!owner) throw new ApiError("forbidden", 403);
  return user;
}

/**
 * POST /api/owner/staff/move { userId, stationId }: the explicit "move" of a staff member to
 * another station. The owner must run both stations (an admin any).
 */
async function moveStaff(c: Ctx, userId: string, toStationId: string) {
  await requireAnyOwner(c);
  const current = await c.db.prepare("select station_id from station_staff where user_id = ?").bind(userId).first<{ station_id: string }>();
  if (!current) throw new ApiError("not_found", 404);
  const actor = await requireOwnerOf(c, current.station_id);
  await requireOwnerOf(c, toStationId);
  if (!(await c.db.prepare("select 1 from stations where id = ? and is_active = 1").bind(toStationId).first())) throw new ApiError("station_not_found", 404);
  if (current.station_id === toStationId) return;
  const moved = await c.db
    .prepare("update station_staff set station_id = ? where user_id = ? and station_id = ?")
    .bind(toStationId, userId, current.station_id)
    .run();
  if (!moved.meta.changes) throw new ApiError("staff_other_station", 409);
  await c.db.batch([
    c.audit(actor.id, "station_staff", "update", `${toStationId}:${userId}`, { station_id: [current.station_id, toStationId] }, { stationId: toStationId, userId }),
    resolveReassignments(c, actor.id, userId, toStationId),
  ]);
}

/** POST /api/owner/reassignments/:id/resolve: the owner dealt with an entry of the re-staff list. */
async function resolveReassignment(c: Ctx, id: string) {
  const user = await requireAnyOwner(c);
  const row = await c.db.prepare("select operator_id, resolved_at from staff_reassignments where id = ?").bind(id).first<{ operator_id: string; resolved_at: string | null }>();
  if (!row) throw new ApiError("not_found", 404);
  if (user.role !== "admin") {
    const owner = await c.db.prepare("select 1 from operator_owners where operator_id = ? and user_id = ?").bind(row.operator_id, user.id).first();
    if (user.role !== "operator" || !owner) throw new ApiError("forbidden", 403);
  }
  if (row.resolved_at) return;
  await c.db.prepare("update staff_reassignments set resolved_at = ?, resolved_by = ? where id = ? and resolved_at is null").bind(nowIso(), user.id, id).run();
}

async function removeStaff(c: Ctx, actorId: string, stationId: string, userId: string) {
  const deleted = await c.db
    .prepare("delete from station_staff where station_id = ? and user_id = ?")
    .bind(stationId, userId)
    .run();
  if (!deleted.meta.changes) return;
  await c.db.batch([
    c.audit(actorId, "station_staff", "delete", `${stationId}:${userId}`, {}, { stationId, userId }),
    demoteIfIdle(c, userId),
  ]);
}

// Operator accounts ---------------------------------------------------------

interface PersonRow {
  id: string;
  phone: string | null;
  email: string | null;
  full_name: string | null;
}

const person = (u: PersonRow): OperatorPerson => ({
  userId: u.id,
  label: personLabel({ fullName: u.full_name, phone: u.phone, email: u.email }),
});

/** The account with this phone number or e-mail address. */
async function findAccount(c: Ctx, rawContact: unknown): Promise<PersonRow> {
  const text = String(rawContact ?? "");
  const contact = parseContact(text);
  if (!contact) throw new ApiError(text.includes("@") ? "invalid_contact" : "phone_not_allowed");
  const row = await c.db
    .prepare(`select id, phone, email, full_name from users where ${contact.kind === "phone" ? "phone" : "email"} = ?`)
    .bind(contact.value)
    .first<PersonRow>();
  if (!row) throw new ApiError("account_not_found", 404);
  return row;
}

/** Someone who runs the operator of this station (or an admin). */
async function requireOwnerOf(c: Ctx, stationId: string): Promise<Profile> {
  const user = await c.requireUser();
  if (user.role === "admin") return user;
  if (user.role !== "operator") throw new ApiError("forbidden", 403);
  const row = await c.db
    .prepare("select 1 from stations s join operator_owners o on o.operator_id = s.operator_id where s.id = ? and o.user_id = ?")
    .bind(stationId, user.id)
    .first();
  if (!row) throw new ApiError("forbidden", 403);
  return user;
}

/**
 * GET /api/owner: the operators the account runs, their active stations, staff, the list to
 * re-staff (0033) and prices. An admin sees every operator (backoffice: admin all).
 */
async function ownerView(c: Ctx): Promise<OwnerView> {
  const user = await c.requireUser();
  if (user.role !== "operator" && user.role !== "admin") throw new ApiError("forbidden", 403);
  const admin = user.role === "admin";
  const mine = admin ? "(select id from operators)" : "(select operator_id from operator_owners where user_id = ?1)";
  await expireStaffInvites(c.db);
  const [operators, staff, reassignments, prices, invites] = await Promise.all([
    c.db
      .prepare(`select id, name, is_own from operators where id in ${mine} order by name`)
      .bind(...(admin ? [] : [user.id]))
      .all<{ id: string; name: string; is_own: number }>(),
    c.db
      .prepare(
        `select ss.station_id, u.id, u.phone, u.email, u.full_name from station_staff ss
         join users u on u.id = ss.user_id join stations s on s.id = ss.station_id
         where s.operator_id in ${mine} order by u.full_name, u.phone, u.email`,
      )
      .bind(...(admin ? [] : [user.id]))
      .all<PersonRow & { station_id: string }>(),
    c.db
      .prepare(
        `select r.id as r_id, r.station_id, r.created_at, u.id, u.phone, u.email, u.full_name,
                (select station_id from station_staff where user_id = u.id) as current_station_id
         from staff_reassignments r join users u on u.id = r.user_id
         where r.resolved_at is null and r.operator_id in ${mine} order by r.created_at`,
      )
      .bind(...(admin ? [] : [user.id]))
      .all<PersonRow & { r_id: string; station_id: string; created_at: string; current_station_id: string | null }>(),
    c.db
      .prepare(`select id, price_battery_xof, charge_kwh_xof, charge_min_xof from stations where is_active = 1 and operator_id in ${mine}`)
      .bind(...(admin ? [] : [user.id]))
      .all<{ id: string; price_battery_xof: number | null; charge_kwh_xof: number | null; charge_min_xof: number | null }>(),
    c.db
      .prepare(
        `select i.id, i.station_id, i.contact, i.created_at, i.expires_at from staff_invites i join stations s on s.id = i.station_id
         where i.status = 'pending' and s.is_active = 1 and s.operator_id in ${mine} order by i.created_at`,
      )
      .bind(...(admin ? [] : [user.id]))
      .all<{ id: string; station_id: string; contact: string; created_at: string; expires_at: string }>(),
  ]);
  if (!operators.results.length && !admin) throw new ApiError("forbidden", 403);
  return {
    operators: operators.results.map((o) => ({ id: o.id, name: o.name, isOwn: !!o.is_own })),
    stations: await c.stations(`where s.is_active = 1 and s.operator_id in ${mine.replace("?1", "?2")}`, ...(admin ? [] : [user.id])),
    staff: staff.results.map((r) => ({ stationId: r.station_id, ...person(r) })),
    reassignments: reassignments.results.map((r) => ({
      id: r.r_id,
      stationId: r.station_id,
      currentStationId: r.current_station_id,
      createdAt: r.created_at,
      ...person(r),
    })),
    // The contact as the owner typed it, masked; never the name of an account that has it.
    invites: invites.results.map((i) => ({
      id: i.id,
      stationId: i.station_id,
      label: personLabel({ fullName: null, phone: i.contact.includes("@") ? null : i.contact, email: i.contact.includes("@") ? i.contact : null }),
      createdAt: i.created_at,
      expiresAt: i.expires_at,
    })),
    prices: prices.results.map((p) => ({ stationId: p.id, swapXof: p.price_battery_xof, chargeKwhXof: p.charge_kwh_xof, chargeMinXof: p.charge_min_xof })),
  };
}

// Staff invites (0050) -------------------------------------------------------

interface StaffInviteRow {
  id: string;
  station_id: string;
  contact: string;
  invited_by: string;
  status: "pending" | "accepted" | "declined" | "revoked" | "expired";
  created_at: string;
  expires_at: string;
}

/** Open invites whose time ran out become 'expired' (on every read, like fleet and shop invites). */
function expireStaffInvites(db: D1Database) {
  return db.prepare("update staff_invites set status = 'expired', decided_at = ?1 where status = 'pending' and expires_at <= ?1").bind(nowIso()).run();
}

/**
 * POST /api/owner/staff { stationId, contact }: invites the person with this phone number or
 * e-mail address to work at the station; only accepting makes them staff. The owner gets the
 * same answer whether an account has the contact or not, so nobody can probe for accounts
 * here; the checks of addStaff run when the person accepts. Inviting the same contact again
 * gives the open invite a new expiry. An admin assigns staff directly (/api/admin/staff).
 */
async function ownerInviteStaff(c: Ctx, stationId: string, rawContact: unknown) {
  const owner = await requireOwnerOf(c, stationId);
  const text = String(rawContact ?? "");
  const contact = parseContact(text);
  if (!contact) throw new ApiError(text.includes("@") ? "invalid_contact" : "phone_not_allowed");
  const station = await c.db.prepare("select name from stations where id = ? and is_active = 1").bind(stationId).first<{ name: string }>();
  if (!station) throw new ApiError("station_not_found", 404);
  await expireStaffInvites(c.db);
  const now = nowIso();
  const expires = new Date(Date.now() + STAFF_INVITE_DAYS * 86_400_000).toISOString();
  const renewed = await c.db
    .prepare("update staff_invites set expires_at = ? where station_id = ? and contact = ? and status = 'pending'")
    .bind(expires, stationId, contact.value)
    .run();
  if (renewed.meta.changes) return;
  const id = uuid();
  let changes = 0;
  try {
    // The limit in the same statement as the insert, so two invites at once cannot pass it together.
    const res = await c.db
      .prepare(
        `insert into staff_invites (id, station_id, contact, invited_by, status, created_at, expires_at)
         select ?1, ?2, ?3, ?4, 'pending', ?5, ?6
         where (select count(*) from staff_invites where station_id = ?2 and status = 'pending') < ?7`,
      )
      .bind(id, stationId, contact.value, owner.id, now, expires, STAFF_INVITE_LIMIT)
      .run();
    changes = res.meta.changes;
  } catch (err) {
    // The same invite sent twice at once: it is there, which is what was asked.
    if (/UNIQUE/i.test(String(err))) return;
    throw err;
  }
  if (!changes) throw new ApiError("invite_limit", 409);
  await c.audit(owner.id, "staff_invites", "insert", id, { contact: contact.value }, { stationId }).run();
  // Only an existing account can be told; the owner's answer above does not depend on it.
  const account = await c.db
    .prepare(`select id from users where ${contact.kind === "phone" ? "phone" : "email"} = ?`)
    .bind(contact.value)
    .first<{ id: string }>();
  if (account) {
    await notifyUser(c.env, account.id, {
      subject: `Invitation : ${station.name}`,
      text: `poinderecharge : vous êtes invité(e) à travailler à la station ${station.name}. Acceptez ou refusez dans votre compte : https://app.poinderecharge.com/compte`,
    });
  }
}

/** POST /api/owner/staff-invites/:id/revoke: the owner takes back an invite nobody answered yet. */
async function ownerRevokeStaffInvite(c: Ctx, id: string) {
  await requireAnyOwner(c);
  await expireStaffInvites(c.db);
  const row = await c.db.prepare("select station_id, status from staff_invites where id = ?").bind(id).first<{ station_id: string; status: string }>();
  if (!row) throw new ApiError("invite_not_found", 404);
  const owner = await requireOwnerOf(c, row.station_id);
  if (row.status !== "pending") throw new ApiError("invite_not_found", 404);
  await c.db.batch([
    c.db.prepare("update staff_invites set status = 'revoked', decided_at = ? where id = ? and status = 'pending'").bind(nowIso(), id),
    c.audit(owner.id, "staff_invites", "update", id, { status: ["pending", "revoked"] }, { stationId: row.station_id }),
  ]);
}

/** SQL for invite i at station s: whoever invited still runs the station (an admin, or an owner of its operator). */
const INVITER_RUNS_STATION = `(exists (select 1 from users where id = i.invited_by and role = 'admin')
  or exists (select 1 from operator_owners where operator_id = s.operator_id and user_id = i.invited_by))`;

/** GET /api/staff-invites: open staff invites for the signed-in person's phone number or e-mail address. */
async function myStaffInvites(c: Ctx): Promise<MyStaffInvite[]> {
  const user = await c.user();
  if (!user || (!user.phone && !user.email)) return [];
  await expireStaffInvites(c.db);
  const { results } = await c.db
    .prepare(
      `select i.id, i.expires_at, s.name as station_name, o.name as operator_name
       from staff_invites i join stations s on s.id = i.station_id join operators o on o.id = s.operator_id
       where i.contact in (?1, ?2) and i.status = 'pending' and s.is_active = 1 and ${INVITER_RUNS_STATION}
       order by i.created_at`,
    )
    .bind(user.phone, user.email)
    .all<{ id: string; expires_at: string; station_name: string; operator_name: string }>();
  return results.map((r) => ({ id: r.id, stationName: r.station_name, operatorName: r.operator_name, expiresAt: r.expires_at }));
}

/**
 * The open invite with this id, made for the signed-in account's phone number or e-mail
 * address, at an active station its inviter still runs (404 otherwise, also for an invite
 * meant for someone else).
 */
async function staffInviteForMe(c: Ctx, user: Profile, id: string): Promise<StaffInviteRow> {
  await expireStaffInvites(c.db);
  const row = await c.db
    .prepare(
      `select i.* from staff_invites i join stations s on s.id = i.station_id
       where i.id = ?1 and i.status = 'pending' and s.is_active = 1 and ${INVITER_RUNS_STATION}`,
    )
    .bind(String(id ?? ""))
    .first<StaffInviteRow>();
  if (!row || (row.contact !== user.phone && row.contact !== user.email)) throw new ApiError("invite_not_found", 404);
  return row;
}

/**
 * POST /api/staff-invites/:id/accept: the invited person becomes staff of the station, with
 * every check of addStaff (one station, no owner, no other role, a customer with nothing open).
 * One batch: the staff row only while the invite is open and the account may still be staff,
 * the invite and the role only once the staff row is there.
 */
async function acceptStaffInvite(c: Ctx, id: string) {
  const user = await c.requireUser();
  const invite = await staffInviteForMe(c, user, id);
  const stationId = invite.station_id;
  const already = await checkStaffable(c, stationId, user.id);
  const now = nowIso();
  let res: D1Result[];
  try {
    res = await c.db.batch([
      ...(already
        ? []
        : [
            c.db
              .prepare(
                `insert into station_staff (station_id, user_id)
                 select ?1, ?2 where exists (select 1 from staff_invites where id = ?3 and status = 'pending' and expires_at > ?4)
                   and exists (select 1 from users where id = ?2 and role in (?5, 'operator', 'admin'))
                   and not exists (select 1 from operator_owners where user_id = ?2)`,
              )
              .bind(stationId, user.id, invite.id, now, DB_CUSTOMER),
          ]),
      c.db
        .prepare(
          `update staff_invites set status = 'accepted', decided_at = ?1, user_id = ?2
           where id = ?3 and status = 'pending' and exists (select 1 from station_staff where station_id = ?4 and user_id = ?2)`,
        )
        .bind(now, user.id, invite.id, stationId),
      // The role follows the assignment (as promoteToOperator), only with the staff row in place.
      c.db
        .prepare("update users set role = 'operator' where id = ?1 and role = ?2 and exists (select 1 from station_staff where station_id = ?3 and user_id = ?1)")
        .bind(user.id, DB_CUSTOMER, stationId),
      resolveReassignments(c, invite.invited_by, user.id, stationId),
      // Staff work at one station: the person's other open staff invites end here.
      c.db
        .prepare("update staff_invites set status = 'expired', decided_at = ?1 where contact in (?2, ?3) and status = 'pending' and id <> ?4")
        .bind(now, user.phone, user.email, invite.id),
      c.audit(user.id, "staff_invites", "update", invite.id, { status: ["pending", "accepted"] }, { stationId, userId: user.id }),
      ...(already ? [] : [c.audit(user.id, "station_staff", "insert", `${stationId}:${user.id}`, { invite: invite.id, invited_by: invite.invited_by }, { stationId, userId: user.id })]),
    ]);
  } catch (err) {
    // Assigned elsewhere in the meantime (unique index station_staff_one_station): nothing was written.
    if (/UNIQUE/i.test(String(err))) throw new ApiError("staff_other_station", 409);
    throw err;
  }
  if (!res[already ? 0 : 1].meta.changes) throw new ApiError("invite_not_found", 404);
}

/** POST /api/staff-invites/:id/decline: the invited person says no. */
async function declineStaffInvite(c: Ctx, id: string) {
  const user = await c.requireUser();
  const invite = await staffInviteForMe(c, user, id);
  await c.db.batch([
    c.db.prepare("update staff_invites set status = 'declined', decided_at = ?, user_id = ? where id = ? and status = 'pending'").bind(nowIso(), user.id, invite.id),
    c.audit(user.id, "staff_invites", "update", invite.id, { status: ["pending", "declined"] }, { stationId: invite.station_id, userId: user.id }),
  ]);
}

async function ownerRemoveStaff(c: Ctx, stationId: string, userId: string) {
  const owner = await requireOwnerOf(c, stationId);
  await removeStaff(c, owner.id, stationId, userId);
}

/**
 * Opening hours (days and times, never empty), phone and prices: what changes in daily
 * business. Prices left out of the input stay; a charging price of null is the network default.
 */
async function ownerSaveStation(c: Ctx, stationId: string, input: OwnerStationInput) {
  const owner = await requireOwnerOf(c, stationId);
  const before = await c.db
    .prepare("select opening_hours, phone, price_battery_xof, charge_kwh_xof, charge_min_xof from stations where id = ?")
    .bind(stationId)
    .first<{ opening_hours: string; phone: string | null; price_battery_xof: number | null; charge_kwh_xof: number | null; charge_min_xof: number | null }>();
  if (!before) throw new ApiError("station_not_found", 404);
  const hours = cleanOpeningHours(input?.openingHours);
  if (!hours) throw new ApiError("opening_hours_invalid");
  const price = (key: "swapXof" | "chargeKwhXof" | "chargeMinXof", old: number | null) => {
    if (input?.[key] === undefined) return old;
    if (!validPrice(input[key])) throw new ApiError("bad_request");
    return input[key] ?? null;
  };
  const after = {
    opening_hours: hours,
    phone: stationPhone(input?.phone),
    price_battery_xof: price("swapXof", before.price_battery_xof),
    charge_kwh_xof: price("chargeKwhXof", before.charge_kwh_xof),
    charge_min_xof: price("chargeMinXof", before.charge_min_xof),
  };
  // A price per kWh of 0 would give charges away (stations.charge_kwh_xof > 0).
  if (after.charge_kwh_xof === 0 || after.price_battery_xof === 0) throw new ApiError("bad_request");
  const changes = diff(before, after);
  if (!Object.keys(changes).length) return;
  await c.db.batch([
    c.db
      .prepare("update stations set opening_hours = ?, phone = ?, price_battery_xof = ?, charge_kwh_xof = ?, charge_min_xof = ? where id = ?")
      .bind(after.opening_hours, after.phone, after.price_battery_xof, after.charge_kwh_xof, after.charge_min_xof, stationId),
    c.audit(owner.id, "stations", "update", stationId, changes, { stationId }),
  ]);
}

async function adminOperators(c: Ctx): Promise<AdminOperator[]> {
  await c.requireAdmin();
  const [operators, owners] = await Promise.all([
    c.db
      .prepare(
        `select o.id, o.name, o.is_own, o.contact_phone, (select count(*) from stations s where s.operator_id = o.id) as station_count
         from operators o order by o.name`,
      )
      .all<{ id: string; name: string; is_own: number; contact_phone: string | null; station_count: number }>(),
    c.db
      .prepare(
        `select oo.operator_id, u.id, u.phone, u.email, u.full_name from operator_owners oo
         join users u on u.id = oo.user_id order by oo.created_at`,
      )
      .all<PersonRow & { operator_id: string }>(),
  ]);
  return operators.results.map((o) => ({
    id: o.id,
    name: o.name,
    isOwn: !!o.is_own,
    contactPhone: o.contact_phone,
    stationCount: o.station_count,
    owners: owners.results.filter((r) => r.operator_id === o.id).map(person),
  }));
}

/** Creates a partner operator (`id` null) or renames one; whether it is our own never changes here. */
async function saveOperator(c: Ctx, id: string | null, input: OperatorInput): Promise<{ id: string }> {
  const admin = await c.requireAdmin();
  const name = String(input?.name ?? "").trim().replace(/\s+/g, " ");
  if (!name || name.length > OPERATOR_NAME_MAX) throw new ApiError("bad_request");
  const rawPhone = String(input?.contactPhone ?? "").trim();
  const contactPhone = rawPhone ? normalizeTogoPhone(rawPhone) : null;
  if (rawPhone && !contactPhone) throw new ApiError("phone_not_allowed");
  if (!id) {
    const newId = uuid();
    await c.db.batch([
      c.db
        .prepare("insert into operators (id, name, is_own, contact_phone, created_at) values (?, ?, 0, ?, ?)")
        .bind(newId, name, contactPhone, nowIso()),
      c.audit(admin.id, "operators", "insert", newId, { name, contact_phone: contactPhone }),
    ]);
    return { id: newId };
  }
  const before = await c.db
    .prepare("select name, contact_phone from operators where id = ?")
    .bind(id)
    .first<{ name: string; contact_phone: string | null }>();
  if (!before) throw new ApiError("not_found", 404);
  const changes = diff(before, { name, contact_phone: contactPhone });
  if (Object.keys(changes).length) {
    await c.db.batch([
      c.db.prepare("update operators set name = ?, contact_phone = ? where id = ?").bind(name, contactPhone, id),
      c.audit(admin.id, "operators", "update", id, changes),
    ]);
  }
  return { id };
}

async function addOperatorOwner(c: Ctx, operatorId: string, contact: unknown) {
  const admin = await c.requireAdmin();
  const operator = await c.db.prepare("select 1 from operators where id = ?").bind(operatorId).first();
  if (!operator) throw new ApiError("not_found", 404);
  const account = await findAccount(c, contact);
  await refuseOtherRole(c, account.id);
  const inserted = await c.db
    .prepare("insert or ignore into operator_owners (operator_id, user_id, created_at) values (?, ?, ?)")
    .bind(operatorId, account.id, nowIso())
    .run();
  if (inserted.meta.changes) {
    await c.db.batch([
      c.audit(admin.id, "operator_owners", "insert", `${operatorId}:${account.id}`, { operator_id: operatorId }, { userId: account.id }),
      promoteToOperator(c, account.id),
    ]);
  }
}

async function removeOperatorOwner(c: Ctx, operatorId: string, userId: string) {
  const admin = await c.requireAdmin();
  const deleted = await c.db
    .prepare("delete from operator_owners where operator_id = ? and user_id = ?")
    .bind(operatorId, userId)
    .run();
  if (deleted.meta.changes) {
    await c.db.batch([
      c.audit(admin.id, "operator_owners", "delete", `${operatorId}:${userId}`, { operator_id: operatorId }, { userId }),
      demoteIfIdle(c, userId),
    ]);
  }
}

async function setStationActive(c: Ctx, stationId: string, active: boolean) {
  const admin = await c.requireAdmin();
  const res = await c.db.prepare("update stations set is_active = ? where id = ?").bind(active ? 1 : 0, stationId).run();
  if (!res.meta.changes) throw new ApiError("station_not_found", 404);
  await c.audit(admin.id, "stations", "update", stationId, { is_active: [!active, active] }, { stationId }).run();
}

// Advertising popup ---------------------------------------------------------

async function currentPromotion(c: Ctx): Promise<Promotion | null> {
  const now = nowIso();
  const { results } = await c.db
    .prepare(
      `select * from promotions where is_active = 1 and (starts_at is null or starts_at <= ?1)
       and (ends_at is null or ends_at > ?1) order by updated_at desc limit 1`,
    )
    .bind(now)
    .all<PromotionRow>();
  return pickPromotion(results.map(toPromotion), new Date());
}

function promotionRow(input: PromotionInput) {
  const title = String(input?.title ?? "").trim();
  if (!title || title.length > 120) throw new ApiError("bad_request");
  const body = String(input.body ?? "").trim();
  if (body.length > 1000) throw new ApiError("bad_request");
  const image = input.imageUrl ? safeImage(input.imageUrl) : null;
  const link = input.linkUrl ? safeLink(input.linkUrl) : null;
  if ((input.imageUrl && (!image || image.startsWith("data:"))) || (input.linkUrl && !link)) throw new ApiError("bad_request");
  const date = (v: string | null) => (v ? new Date(v).toISOString() : null);
  let starts: string | null;
  let ends: string | null;
  try {
    starts = date(input.startsAt);
    ends = date(input.endsAt);
  } catch {
    throw new ApiError("bad_request");
  }
  if (starts && ends && ends <= starts) throw new ApiError("bad_request");
  return {
    title,
    body,
    image_url: image,
    link_url: link,
    link_label: input.linkLabel ? String(input.linkLabel).trim().slice(0, 40) || null : null,
    is_active: input.isActive ? 1 : 0,
    starts_at: starts,
    ends_at: ends,
  };
}

async function listPromotions(c: Ctx) {
  await c.requireAdmin();
  const { results } = await c.db.prepare("select * from promotions order by created_at desc").all<PromotionRow>();
  return results.map(toPromotion);
}

async function savePromotion(c: Ctx, id: string | null, input: PromotionInput) {
  const admin = await c.requireAdmin();
  const row = promotionRow(input);
  const now = nowIso();
  if (id) {
    const before = await c.db
      .prepare("select title, body, image_url, link_url, link_label, is_active, starts_at, ends_at from promotions where id = ?")
      .bind(id)
      .first<Record<string, unknown>>();
    if (!before) throw new ApiError("not_found", 404);
    await c.db.batch([
      c.db
        .prepare(
          `update promotions set title = ?, body = ?, image_url = ?, link_url = ?, link_label = ?, is_active = ?,
           starts_at = ?, ends_at = ?, updated_at = ? where id = ?`,
        )
        .bind(...Object.values(row), now, id),
      c.audit(admin.id, "promotions", "update", id, diff(before, row)),
    ]);
    return;
  }
  const newId = uuid();
  await c.db.batch([
    c.db
      .prepare(
        `insert into promotions (id, title, body, image_url, link_url, link_label, is_active, starts_at, ends_at, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(newId, ...Object.values(row), now, now),
    c.audit(admin.id, "promotions", "insert", newId, row),
  ]);
}

async function deletePromotion(c: Ctx, id: string) {
  const admin = await c.requireAdmin();
  const before = await c.db.prepare("select title from promotions where id = ?").bind(id).first<{ title: string }>();
  if (!before) return;
  await c.db.batch([
    c.db.prepare("delete from promotions where id = ?").bind(id),
    c.audit(admin.id, "promotions", "delete", id, { title: before.title }),
  ]);
}

const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

async function uploadImage(c: Ctx) {
  await c.requireAdmin();
  const type = (c.request.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = IMAGE_TYPES[type];
  if (!ext) throw new ApiError("bad_request");
  const length = Number(c.request.headers.get("Content-Length"));
  if (length > MAX_PROMO_IMAGE_BYTES) throw new ApiError("image_too_large", 413);
  const body = await c.request.arrayBuffer();
  if (body.byteLength > MAX_PROMO_IMAGE_BYTES) throw new ApiError("image_too_large", 413);
  if (!body.byteLength) throw new ApiError("bad_request");
  const folder = c.url.searchParams.get("folder") === "stations" ? "stations" : "promotions";
  const key = `${folder}/${uuid()}.${ext}`;
  await c.env.MEDIA.put(key, body, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
  const local = c.url.hostname === "localhost" || c.url.hostname === "127.0.0.1";
  return { url: `${local ? c.url.origin : `https://${c.url.host}`}/api/media/${key}` };
}

async function media(c: Ctx, key: string): Promise<Response> {
  const object = await c.env.MEDIA.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
}

// Routing -------------------------------------------------------------------

type Handler = (c: Ctx, params: string[]) => Promise<unknown>;

const ROUTES: [string, RegExp, Handler][] = [
  ["GET", /^\/api\/stations$/, (c) => publicStations(c)],
  ["GET", /^\/api\/repair-centers$/, (c) => listRepairCenters(c.db, true)],
  ["GET", /^\/api\/operators$/, (c) => listOperators(c)],
  ["GET", /^\/api\/stations\/([\w-]+)\/reviews$/, async (c, [id]) => stationReviews(c.db, id, await c.user())],
  [
    "POST",
    /^\/api\/stations\/([\w-]+)\/reviews$/,
    async (c, [id]) => {
      await saveReview(c.db, await c.requireUser(), id, await readJson<ReviewInput>(c.request));
      return { ok: true };
    },
  ],
  [
    "DELETE",
    /^\/api\/reviews\/([\w-]+)$/,
    async (c, [id]) => {
      const user = await c.requireUser();
      await deleteReview(c.db, user, id, (stationId, changes) => c.audit(user.id, "stations", "update", stationId, changes, { stationId }));
      return { ok: true };
    },
  ],
  ["GET", /^\/api\/me$/, (c) => c.user()],
  // The Turnstile site key for the login form, null while Turnstile is off (worker/ip-limits.ts).
  ["GET", /^\/api\/auth\/captcha$/, async (c) => ({ siteKey: captchaSiteKey(c.env) })],
  // Auth bodies name the phone number or e-mail address "contact"; "phone" is the
  // older name, still sent by app versions released before e-mail login.
  [
    "POST",
    /^\/api\/auth\/send$/,
    async (c) => {
      const body = await readJson<{ contact?: string; phone?: string; captcha?: string }>(c.request);
      await countIpRequest(c.db, c.request, "send");
      await checkCaptcha(c.env, c.request, body.captcha);
      await sendCode(c.env, body.contact ?? body.phone ?? "");
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/api\/auth\/register$/,
    async (c) => {
      const body = await readJson<{ contact?: string; phone?: string; code: string; pin: string }>(c.request);
      return register(c.env, body.contact ?? body.phone ?? "", body.code, body.pin);
    },
  ],
  [
    "POST",
    /^\/api\/auth\/register-fleet$/,
    async (c) => {
      const body = await readJson<{ contact?: string; code: string; pin: string; fleetName: string }>(c.request);
      return registerFleetManager(c.env, body.contact ?? "", body.code, body.pin, body.fleetName);
    },
  ],
  [
    "POST",
    /^\/api\/auth\/register-merchant$/,
    async (c) => {
      const body = await readJson<{ contact?: string; code: string; pin: string; shop: MerchantShopInput }>(c.request);
      return registerMerchant(c.env, body.contact ?? "", body.code, body.pin, body.shop);
    },
  ],
  [
    "POST",
    /^\/api\/auth\/login$/,
    async (c) => {
      const body = await readJson<{ contact?: string; phone?: string; pin: string }>(c.request);
      await countIpRequest(c.db, c.request, "login");
      return signIn(c.env, body.contact ?? body.phone ?? "", body.pin);
    },
  ],
  [
    "POST",
    /^\/api\/auth\/logout$/,
    async (c) => {
      await signOut(c.env, c.request);
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/api\/auth\/contact\/send$/,
    async (c) => {
      const { contact } = await readJson<{ contact: string }>(c.request);
      await sendContactCode(c.env, c.request, contact);
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/api\/auth\/contact$/,
    async (c) => {
      const { contact, code } = await readJson<{ contact: string; code: string }>(c.request);
      return addContact(c.env, c.request, contact, code);
    },
  ],
  [
    "POST",
    /^\/api\/auth\/delete-account\/send$/,
    async (c) => {
      const { channel } = await readJson<{ channel: CodeChannel }>(c.request);
      await sendDeleteCode(c.env, c.request, channel === "email" ? "email" : "sms");
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/api\/auth\/delete-account$/,
    async (c) => {
      const body = await readJson<{ channel?: CodeChannel; code?: string; pin?: string }>(c.request);
      await deleteAccount(c.env, c.request, body);
      return { ok: true };
    },
  ],
  ["GET", /^\/api\/reservations\/mine$/, (c) => myReservations(c)],
  [
    "POST",
    /^\/api\/reservations$/,
    async (c) => {
      return reserve(c, await readJson<{ stationId?: unknown; kind?: unknown; type?: unknown; target?: unknown }>(c.request));
    },
  ],
  ["POST", /^\/api\/reservations\/([\w-]+)\/cancel$/, async (c, [id]) => cancelReservation(c, id)],
  [
    "POST",
    /^\/api\/reservations\/([\w-]+)\/complete$/,
    async (c, [id]) => {
      const { pickupCode } = await readJson<{ pickupCode?: unknown }>(c.request);
      return completeReservation(c, id, pickupCode);
    },
  ],
  ["GET", /^\/api\/staff\/stations$/, (c) => staffStations(c)],
  ["GET", /^\/api\/owner$/, (c) => ownerView(c)],
  [
    "POST",
    /^\/api\/owner\/staff$/,
    async (c) => {
      const { stationId, contact } = await readJson<{ stationId: string; contact: string }>(c.request);
      return ownerInviteStaff(c, String(stationId), contact);
    },
  ],
  ["POST", /^\/api\/owner\/staff-invites\/([\w-]+)\/revoke$/, (c, [id]) => ownerRevokeStaffInvite(c, id)],
  // The invited person: open staff invites for their phone number or e-mail address, accept or decline.
  ["GET", /^\/api\/staff-invites$/, (c) => myStaffInvites(c)],
  ["POST", /^\/api\/staff-invites\/([\w-]+)\/accept$/, (c, [id]) => acceptStaffInvite(c, id)],
  ["POST", /^\/api\/staff-invites\/([\w-]+)\/decline$/, (c, [id]) => declineStaffInvite(c, id)],
  [
    "DELETE",
    /^\/api\/owner\/staff$/,
    async (c) => {
      const { stationId, userId } = await readJson<{ stationId: string; userId: string }>(c.request);
      return ownerRemoveStaff(c, String(stationId), String(userId));
    },
  ],
  [
    "POST",
    /^\/api\/owner\/stations\/([\w-]+)$/,
    async (c, [id]) => ownerSaveStation(c, id, await readJson<OwnerStationInput>(c.request)),
  ],
  // Service unlock per station (worker/services.ts): owners ask, admins decide.
  ["GET", /^\/api\/station-services$/, (c) => listStationServices(c)],
  [
    "POST",
    /^\/api\/station-services\/request$/,
    async (c) => {
      const { stationId, service } = await readJson<{ stationId: string; service: string }>(c.request);
      return requestService(c, String(stationId), service);
    },
  ],
  [
    "POST",
    /^\/api\/admin\/station-services\/decide$/,
    async (c) => {
      const { stationId, service, approve } = await readJson<{ stationId: string; service: string; approve: boolean }>(c.request);
      return decideService(c, String(stationId), service, approve === true);
    },
  ],
  [
    "POST",
    /^\/api\/admin\/station-services\/set$/,
    async (c) => {
      const { stationId, service, unlocked } = await readJson<{ stationId: string; service: string; unlocked: boolean }>(c.request);
      return setService(c, String(stationId), service, unlocked === true);
    },
  ],
  ["GET", /^\/api\/admin\/operators$/, (c) => adminOperators(c)],
  ["GET", /^\/api\/admin\/battery-types$/, async (c) => (await c.requireAdmin(), listBatteryTypes(c.db))],
  [
    "POST",
    /^\/api\/admin\/battery-types$/,
    async (c) => {
      const admin = await c.requireAdmin();
      const { id, input } = await readJson<{ id: string | null; input: BatteryTypeInput }>(c.request);
      return saveBatteryType(c, admin.id, id ?? null, input);
    },
  ],
  // Battery register (worker/batteries.ts): admins, owners read-only.
  [
    "GET",
    /^\/api\/batteries$/,
    (c) =>
      listBatteries(c, {
        brand: c.url.searchParams.has("brand") ? c.url.searchParams.get("brand") : null,
        q: c.url.searchParams.get("q"),
        status: c.url.searchParams.get("status") as BatteryStatusInput["status"] | null,
        stationId: c.url.searchParams.get("stationId"),
      }),
  ],
  ["GET", /^\/api\/batteries\/([\w-]+)$/, (c, [id]) => batteryDetail(c, id)],
  ["POST", /^\/api\/admin\/batteries$/, async (c) => registerBatteries(c, await readJson<RegisterBatteriesInput>(c.request))],
  ["PATCH", /^\/api\/admin\/batteries\/([\w-]+)$/, async (c, [id]) => setBatteryStatus(c, id, await readJson<BatteryStatusInput>(c.request))],
  ["GET", /^\/api\/admin\/ev-chargers$/, async (c) => (await c.requireAdmin(), listEvChargers(c.db))],
  ["GET", /^\/api\/admin\/repair-centers$/, async (c) => (await c.requireAdmin(), listRepairCenters(c.db, false))],
  [
    "POST",
    /^\/api\/admin\/repair-centers$/,
    async (c) => {
      const admin = await c.requireAdmin();
      const { id, input } = await readJson<{ id: string | null; input: RepairCenterInput }>(c.request);
      return saveRepairCenter(c, admin.id, id ? String(id) : null, input);
    },
  ],
  [
    "DELETE",
    /^\/api\/admin\/repair-centers\/([\w-]+)$/,
    async (c, [id]) => {
      const admin = await c.requireAdmin();
      return deleteRepairCenter(c, admin.id, id);
    },
  ],
  [
    "POST",
    /^\/api\/admin\/ev-chargers$/,
    async (c) => {
      const admin = await c.requireAdmin();
      const { id, input } = await readJson<{ id: string | null; input: EvChargerInput }>(c.request);
      return saveEvCharger(c, admin.id, id ? String(id) : null, input);
    },
  ],
  [
    "DELETE",
    /^\/api\/admin\/ev-chargers\/([\w-]+)$/,
    async (c, [id]) => {
      const admin = await c.requireAdmin();
      return deleteEvCharger(c, admin.id, id);
    },
  ],
  [
    "POST",
    /^\/api\/admin\/operators$/,
    async (c) => {
      const { id, input } = await readJson<{ id: string | null; input: OperatorInput }>(c.request);
      return saveOperator(c, id ? String(id) : null, input);
    },
  ],
  [
    "POST",
    /^\/api\/admin\/operators\/([\w-]+)\/owners$/,
    async (c, [id]) => addOperatorOwner(c, id, (await readJson<{ contact: string }>(c.request)).contact),
  ],
  [
    "DELETE",
    /^\/api\/admin\/operators\/([\w-]+)\/owners\/([\w-]+)$/,
    (c, [id, userId]) => removeOperatorOwner(c, id, userId),
  ],
  [
    "PATCH",
    /^\/api\/stations\/([\w-]+)\/status$/,
    async (c, [id]) => updateStatus(c, id, await readJson(c.request)),
  ],
  ["GET", /^\/api\/stations\/([\w-]+)\/reservations$/, (c, [id]) => stationReservations(c, id)],
  // Station work (worker/station-work.ts): counter, swaps and their log.
  ["GET", /^\/api\/stations\/([\w-]+)\/counter$/, (c, [id]) => stationCounter(c, id)],
  ["POST", /^\/api\/stations\/([\w-]+)\/battery-events$/, async (c, [id]) => postBatteryEvent(c, id, await readJson<BatteryEventInput>(c.request))],
  ["POST", /^\/api\/stations\/([\w-]+)\/swaps$/, async (c, [id]) => recordSwap(c, id, await readJson<SwapInput>(c.request))],
  [
    "GET",
    /^\/api\/stations\/([\w-]+)\/swaps$/,
    (c, [id]) =>
      stationSwaps(c, id, {
        customerType: (c.url.searchParams.get("customerType") as SwapFilter["customerType"]) ?? null,
        days: Number(c.url.searchParams.get("days")) || null,
      }),
  ],
  [
    "GET",
    /^\/api\/stations\/([\w-]+)\/batteries\/lookup$/,
    (c, [id]) => lookupBattery(c, id, c.url.searchParams.get("serial"), c.url.searchParams.get("batteryTypeId")),
  ],
  ["GET", /^\/api\/stations\/([\w-]+)\/battery-events$/, (c, [id]) => stationBatteryEvents(c, id, c.url.searchParams.get("days"))],
  // Owner backoffice (worker/owner.ts): live queue and handovers, settlement and statistics.
  ["GET", /^\/api\/owner\/live$/, (c) => ownerLive(c, c.url.searchParams.get("stationId") || null)],
  ["GET", /^\/api\/owner\/report$/, (c) => ownerReport(c, c.url.searchParams.get("stationId") || null, reportPeriod(c.url.searchParams.get("days")))],
  // Station cash (worker/station-cash.ts): what partner stations (at own stations: staff members) owe, their closings and the admin's confirmation.
  ["GET", /^\/api\/stations\/([\w-]+)\/cash$/, (c, [id]) => myStationCash(c, id)],
  ["GET", /^\/api\/owner\/cash$/, (c) => ownerCash(c, c.url.searchParams.get("stationId") || null)],
  ["POST", /^\/api\/owner\/cash\/handovers$/, async (c) => closeCashDay(c, await readJson<HandoverInput>(c.request))],
  [
    "POST",
    /^\/api\/admin\/cash\/handovers\/([\w-]+)\/decide$/,
    async (c, [id]) => decideHandover(c, id, await readJson<{ confirm?: unknown; reason?: unknown }>(c.request)),
  ],
  ["POST", /^\/api\/admin\/cash\/stations\/([\w-]+)$/, async (c, [id]) => saveStationCashSettings(c, id, await readJson<Partial<StationCashSettings>>(c.request))],
  [
    "POST",
    /^\/api\/owner\/staff\/move$/,
    async (c) => {
      const { userId, stationId } = await readJson<{ userId: string; stationId: string }>(c.request);
      return moveStaff(c, String(userId), String(stationId));
    },
  ],
  ["POST", /^\/api\/owner\/reassignments\/([\w-]+)\/resolve$/, (c, [id]) => resolveReassignment(c, id)],
  ["GET", /^\/api\/admin\/reservations$/, (c) => adminReservations(c)],
  ["GET", /^\/api\/promotions\/current$/, (c) => currentPromotion(c)],
  // Modules the backoffice switches off (worker/features.ts)
  ["GET", /^\/api\/features$/, (c) => getFeatures(c.env)],
  ["POST", /^\/api\/admin\/features\/parcels$/, async (c) => {
    const admin = await c.requireAdmin();
    const { enabled } = await readJson<{ enabled?: boolean }>(c.request);
    return setParcelsEnabled(c.env, admin, !!enabled);
  }],
  ["POST", /^\/api\/admin\/features\/drivers$/, async (c) => {
    const admin = await c.requireAdmin();
    const { enabled } = await readJson<{ enabled?: boolean }>(c.request);
    return setDriversEnabled(c.env, admin, !!enabled);
  }],
  ["POST", /^\/api\/admin\/features\/lite$/, async (c) => {
    const admin = await c.requireAdmin();
    const { enabled } = await readJson<{ enabled?: boolean }>(c.request);
    return setLiteEnabled(c.env, admin, !!enabled);
  }],
  // Wallet (worker/wallet.ts)
  ["GET", /^\/api\/wallet$/, async (c) => getWallet(c.env, await c.requireUser())],
  ["POST", /^\/api\/wallet\/code$/, async (c) => createCreditCode(c.env, await c.requireUser(), c.request)],
  ["POST", /^\/api\/stations\/([\w-]+)\/green-credit\/check$/, async (c, [id]) => counterCredit(c.env, await c.requireUser(), c.actAt, id, c.request)],
  ["POST", /^\/api\/stations\/([\w-]+)\/green-credit\/topup$/, async (c, [id]) => topUpCredit(c.env, await c.requireUser(), c.actAt, id, c.request)],
  ["GET", /^\/api\/admin\/wallet$/, async (c) => {
    await c.requireAdmin();
    return adminWallet(c.env, c.url);
  }],
  ["POST", /^\/api\/admin\/wallet\/enabled$/, async (c) => {
    const admin = await c.requireAdmin();
    const { enabled } = await readJson<{ enabled?: boolean }>(c.request);
    return setWalletEnabled(c.env, admin, !!enabled);
  }],
  ["POST", /^\/api\/admin\/wallet\/max$/, async (c) => setCreditMax(c.env, await c.requireAdmin(), c.request)],
  ["POST", /^\/api\/admin\/stations\/([\w-]+)\/green-credit$/, async (c, [id]) => setStationGreenCredit(c.env, await c.requireAdmin(), id, c.request)],
  ["POST", /^\/api\/admin\/wallet\/adjust$/, async (c) => adjustBalance(c.env, await c.requireAdmin(), c.request)],
  ["POST", /^\/api\/admin\/wallet\/freeze$/, async (c) => {
    const admin = await c.requireAdmin();
    const { contact, frozen } = await readJson<{ contact?: string; frozen?: boolean }>(c.request);
    return setWalletFrozen(c.env, admin, contact, !!frozen);
  }],
  ["GET", /^\/api\/payments\/mine$/, async (c) => myPayments(c.env, await customerUser(c))],
  ["POST", /^\/api\/payments$/, async (c) => startPayment(c.env, await customerUser(c), c.request)],
  ["POST", /^\/api\/payments\/([\w-]+)\/refresh$/, async (c, [id]) => refreshPayment(c.env, await customerUser(c), id)],
  // greenpoint (worker/greenpoint.ts)
  ["GET", /^\/api\/greenpoint$/, async (c) => myGreenpoint(c.env, await c.requireUser())],
  ["GET", /^\/api\/greenpoint\/total$/, (c) => networkTotal(c.env)],
  ["POST", /^\/api\/greenpoint\/vehicle$/, async (c) => setVehicle(c.env, await c.requireUser(), c.request)],
  ["POST", /^\/api\/greenpoint\/redemptions$/, async (c) => startRedemption(c.env, await c.requireUser(), c.request)],
  ["POST", /^\/api\/greenpoint\/redemptions\/([\w-]+)\/cancel$/, async (c, [id]) => cancelRedemption(c.env, await customerUser(c), id)],
  [
    "POST",
    /^\/api\/stations\/([\w-]+)\/greenpoint\/redeem$/,
    async (c, [id]) => confirmRedemption(c.env, await c.requireUser(), c.actAt, id, c.request),
  ],
  // Charging at a socket (worker/charging.ts)
  ["GET", /^\/api\/stations\/([\w-]+)\/charging$/, async (c, [id]) => stationCharging(c.env, await c.requireUser(), (u, s) => c.isStaffOf(u, s), id)],
  ["POST", /^\/api\/stations\/([\w-]+)\/charging$/, async (c, [id]) => startCharge(c.env, await c.requireUser(), c.actAt, id, c.request)],
  [
    "POST",
    /^\/api\/stations\/([\w-]+)\/charging\/([\w-]+)\/(stop|cancel|pay)$/,
    async (c, [station, id, action]) => {
      const user = await c.requireUser();
      if (action === "stop") return stopCharge(c.env, user, c.actAt, station, id);
      if (action === "cancel") return cancelCharge(c.env, user, c.actAt, station, id);
      return payCash(c.env, user, c.actAt, station, id);
    },
  ],
  // Charging cards at the counter: staff look up a card's credit and top it up in cash.
  ["GET", /^\/api\/stations\/([\w-]+)\/charge-cards\/([^/]+)$/, async (c, [id, tag]) => counterCardInfo(c.db, await c.requireUser(), (u, s) => c.isStaffOf(u, s), id, tag)],
  ["GET", /^\/api\/charging\/mine$/, async (c) => myCharges(c.env, await customerUser(c))],
  // Charging by QR code: the outlet's page is readable before signing in.
  ["GET", /^\/api\/charging\/outlets\/([\w-]+)$/, async (c, [token]) => outletInfo(c.env, await c.user(), token)],
  ["POST", /^\/api\/charging\/outlets\/([\w-]+)\/start$/, async (c, [token]) => startOutletCharge(c.env, await customerUser(c), token, c.request)],
  ["POST", /^\/api\/charging\/([\w-]+)\/stop$/, async (c, [id]) => stopSelfCharge(c.env, await customerUser(c), id)],
  ["POST", /^\/api\/admin\/charging-points\/([\w-]+)\/qr$/, async (c, [id]) => setQrStart(c.env, await c.requireAdmin(), id, c.request)],
  ["POST", /^\/api\/charging\/([\w-]+)\/pay\/wallet$/, async (c, [id]) => payWithWallet(c.env, await customerUser(c), id, c.request)],
  ["POST", /^\/api\/charging\/([\w-]+)\/pay\/mobile$/, async (c, [id]) => payWithMobile(c.env, await customerUser(c), id, c.request)],
  ["GET", /^\/api\/admin\/charging$/, async (c) => {
    await c.requireAdmin();
    return adminCharging(c.env);
  }],
  ["POST", /^\/api\/admin\/charging\/tariff$/, async (c) => saveChargeTariff(c.env, await c.requireAdmin(), c.request)],
  // Charging cards (worker/charge-cards.ts); a card number is up to 20 printable characters.
  ["GET", /^\/api\/admin\/charge-cards$/, async (c) => {
    await c.requireAdmin();
    return listChargeCards(c.db);
  }],
  ["POST", /^\/api\/admin\/charge-cards$/, async (c) => saveChargeCard(c.db, await c.requireAdmin(), c.request)],
  ["POST", /^\/api\/admin\/charge-cards\/([^/]+)\/balance$/, async (c, [tag]) => adjustChargeCard(c.db, await c.requireAdmin(), tag, c.request)],
  ["POST", /^\/api\/admin\/charge-cards\/([^/]+)\/block$/, async (c, [tag]) => setChargeCardBlocked(c.env, await c.requireAdmin(), tag, c.request)],
  ["DELETE", /^\/api\/admin\/charge-cards\/([^/]+)$/, async (c, [tag]) => deleteChargeCard(c.db, await c.requireAdmin(), tag)],
  ["GET", /^\/api\/admin\/greenpoint$/, async (c) => {
    await c.requireAdmin();
    return adminGreenpoint(c.env);
  }],
  ["POST", /^\/api\/admin\/greenpoint\/factors$/, async (c) => saveFactors(c.env, await c.requireAdmin(), c.request)],
  ["POST", /^\/api\/admin\/greenpoint\/rewards$/, async (c) => {
    await c.requireAdmin();
    return saveReward(c.env, c.request);
  }],
  // Parcel depot (worker/parcels.ts)
  ["GET", /^\/api\/parcels\/info$/, (c) => parcelInfo(c)],
  ["GET", /^\/api\/parcels\/mine$/, (c) => myParcels(c)],
  ["POST", /^\/api\/parcels\/([\w-]+)\/cancel$/, (c, [id]) => cancelParcel(c, id)],
  ["POST", /^\/api\/parcels\/([\w-]+)\/resend$/, (c, [id]) => resendPickupCode(c, id)],
  ["GET", /^\/api\/stations\/([\w-]+)\/parcels$/, (c, [id]) => stationParcels(c, id)],
  ["POST", /^\/api\/stations\/([\w-]+)\/parcels$/, async (c, [id]) => createParcel(c, id, await readJson<ParcelInput>(c.request))],
  ["POST", /^\/api\/stations\/([\w-]+)\/parcels\/([\w-]+)\/label$/, (c, [id, parcel]) => markLabelPrinted(c, id, parcel)],
  // Collection runs and scans (worker/parcel-runs.ts, plan phase 7)
  ["GET", /^\/api\/stations\/([\w-]+)\/runs$/, (c, [id]) => stationRuns(c, id)],
  [
    "POST",
    /^\/api\/stations\/([\w-]+)\/runs$/,
    async (c, [id]) => {
      const { badge, parcelIds } = await readJson<{ badge: string; parcelIds: string[] }>(c.request);
      return startRun(c, id, badge, parcelIds);
    },
  ],
  [
    "POST",
    /^\/api\/stations\/([\w-]+)\/runs\/([\w-]+)\/(scan|remove|depart|cancel)$/,
    async (c, [id, run, action]) => {
      if (action === "depart") return departRun(c, id, run);
      if (action === "cancel") return cancelRun(c, id, run);
      const body = await readJson<{ code?: string; parcelId?: string }>(c.request);
      return action === "scan" ? scanRunParcel(c, id, run, body.code) : removeRunParcel(c, id, run, String(body.parcelId));
    },
  ],
  [
    "POST",
    /^\/api\/stations\/([\w-]+)\/parcels\/receive$/,
    async (c, [id]) => receiveParcel(c, id, (await readJson<{ code: string }>(c.request)).code),
  ],
  [
    "POST",
    /^\/api\/stations\/([\w-]+)\/parcels\/pickup$/,
    async (c, [id]) => {
      const { code, trackingNo } = await readJson<{ code: string; trackingNo?: string }>(c.request);
      return pickUpParcel(c, id, code, trackingNo);
    },
  ],
  // Partner API bookings waiting for drop-off (worker/partners.ts)
  ["GET", /^\/api\/stations\/([\w-]+)\/bookings$/, (c, [id]) => stationBookings(c, id)],
  [
    "POST",
    /^\/api\/stations\/([\w-]+)\/bookings\/([\w-]+)\/accept$/,
    async (c, [id, booking]) => acceptBooking(c, id, booking, (await readJson<{ measures: ParcelMeasures }>(c.request)).measures),
  ],
  ["GET", /^\/api\/admin\/partners$/, (c) => adminPartners(c)],
  [
    "POST",
    /^\/api\/admin\/partners$/,
    async (c) => {
      const { id, input } = await readJson<{ id: string | null; input: PartnerInput }>(c.request);
      return savePartner(c, id ? String(id) : null, input);
    },
  ],
  [
    "POST",
    /^\/api\/admin\/partners\/([\w-]+)\/keys$/,
    async (c, [id]) => createPartnerKey(c, id, (await readJson<{ label?: string }>(c.request)).label ?? ""),
  ],
  ["POST", /^\/api\/admin\/partners\/([\w-]+)\/keys\/([\w-]+)\/revoke$/, (c, [id, key]) => revokePartnerKey(c, id, key)],
  ["POST", /^\/api\/admin\/partners\/([\w-]+)\/secret$/, (c, [id]) => rotatePartnerSecret(c, id)],
  ["POST", /^\/api\/admin\/partner-events\/([\w-]+)\/retry$/, (c, [id]) => retryPartnerEvent(c, id)],
  [
    "POST",
    /^\/api\/admin\/parcels\/([\w-]+)\/(released|auctioned)$/,
    (c, [id, outcome]) => closeStoredParcel(c, id, outcome as "released" | "auctioned"),
  ],
  ["GET", /^\/api\/admin\/parcels$/, (c) => adminParcels(c)],
  [
    "POST",
    /^\/api\/admin\/parcel-depots$/,
    async (c) => {
      const { stationId, input } = await readJson<{ stationId: string; input: ParcelDepotInput }>(c.request);
      return saveDepot(c, String(stationId), input);
    },
  ],
  ["POST", /^\/api\/admin\/parcel-sizes$/, async (c) => saveSizes(c, (await readJson<{ sizes: unknown }>(c.request)).sizes)],
  // Drivers (worker/drivers.ts)
  // Fleet managers (worker/fleet.ts)
  ["GET", /^\/api\/fleet$/, (c) => fleetView(c)],
  ["GET", /^\/api\/fleet\/stats$/, (c) => fleetStats(c, c.url.searchParams.get("from") ?? "", c.url.searchParams.get("to") ?? "")],
  ["POST", /^\/api\/fleet\/jobs\/([\w-]+)\/assign$/, async (c, [id]) => fleetAssign(c, id, String((await readJson<{ driverId: string }>(c.request)).driverId))],
  ["GET", /^\/api\/fleet\/statement$/, (c) => fleetStatement(c, c.url.searchParams.get("from") ?? "", c.url.searchParams.get("to") ?? "")],
  ["POST", /^\/api\/fleet\/invites$/, async (c) => inviteDriver(c, (await readJson<{ phone: string }>(c.request)).phone)],
  ["POST", /^\/api\/fleet\/invites\/([\w-]+)\/revoke$/, (c, [id]) => revokeInvite(c, id)],
  ["POST", /^\/api\/fleet\/drivers\/([\w-]+)\/remove$/, (c, [id]) => removeDriver(c, id)],
  // The invited person (worker/fleet.ts): open invites for their number, accept or decline by code.
  ["GET", /^\/api\/fleet-invites$/, (c) => myFleetInvites(c)],
  ["POST", /^\/api\/fleet-invites\/(\w+)\/accept$/, async (c, [token]) => acceptInvite(c, token, await readJson<FleetInviteAnswer>(c.request).catch(() => null))],
  ["POST", /^\/api\/fleet-invites\/(\w+)\/decline$/, (c, [token]) => declineInvite(c, token)],
  ["GET", /^\/api\/admin\/fleets$/, (c) => adminFleets(c)],
  ["POST", /^\/api\/admin\/fleets\/([\w-]+)\/review$/, async (c, [id]) => reviewFleet(c, id, (await readJson<{ action: FleetDecision }>(c.request)).action)],
  ["POST", /^\/api\/admin\/fleets\/([\w-]+)\/tier$/, async (c, [id]) => setFleetTier(c, id, (await readJson<{ tier: FleetTier }>(c.request)).tier)],
  // Merchants (worker/merchants.ts; registration in worker/auth.ts, bookings in worker/drivers.ts)
  ["GET", /^\/api\/merchant$/, (c) => merchantView(c)],
  ["POST", /^\/api\/merchant\/bookings$/, async (c) => merchantBookings(c, await readJson<MerchantBookingsQuery>(c.request))],
  ["GET", /^\/api\/merchant\/activity$/, (c) => merchantActivity(c)],
  ["POST", /^\/api\/merchant\/stats$/, async (c) => merchantStatistics(c, await readJson<MerchantStatsQuery>(c.request))],
  ["POST", /^\/api\/merchant\/addresses$/, async (c) => addMerchantAddress(c, await readJson<MerchantAddressInput>(c.request))],
  ["DELETE", /^\/api\/merchant\/addresses\/([\w-]+)$/, (c, [id]) => removeMerchantAddress(c, id)],
  ["POST", /^\/api\/merchant\/jobs\/([\w-]+)\/returned$/, (c, [id]) => confirmShopReturn(c, id)],
  ["POST", /^\/api\/merchant\/shop$/, async (c) => updateShop(c, await readJson<MerchantShopInput>(c.request))],
  ["POST", /^\/api\/merchant\/invites$/, async (c) => inviteEmployee(c, (await readJson<{ phone: string }>(c.request)).phone)],
  ["POST", /^\/api\/merchant\/invites\/([\w-]+)\/revoke$/, (c, [id]) => revokeEmployeeInvite(c, id)],
  ["POST", /^\/api\/merchant\/members\/([\w-]+)\/remove$/, (c, [id]) => removeEmployee(c, id)],
  ["POST", /^\/api\/merchant\/drivers$/, async (c) => addMerchantDriver(c, await readJson<MerchantDriverInput>(c.request))],
  [
    "POST",
    /^\/api\/merchant\/drivers\/([\w-]+)\/pay$/,
    async (c, [id]) => changeMerchantPay(c, id, await readJson<{ payMode: unknown; ratePerHourFcfa: unknown }>(c.request)),
  ],
  ["POST", /^\/api\/merchant\/drivers\/([\w-]+)\/end$/, (c, [id]) => endMerchantDriver(c, id)],
  ["POST", /^\/api\/merchant\/drivers\/([\w-]+)\/checkout$/, (c, [id]) => merchantCheckout(c, id)],
  // The invited employee: open invites for their number, accept or decline by code.
  ["GET", /^\/api\/merchant-invites$/, (c) => myMerchantInvites(c)],
  ["POST", /^\/api\/merchant-invites\/(\w+)\/accept$/, (c, [token]) => acceptMerchantInvite(c, token)],
  ["POST", /^\/api\/merchant-invites\/(\w+)\/decline$/, (c, [token]) => declineMerchantInvite(c, token)],
  // Assignments to approve: by the driver, their fleet manager or an admin (decision 9).
  ["GET", /^\/api\/merchant-assignments$/, (c) => assignmentRequests(c)],
  ["POST", /^\/api\/merchant-assignments\/([\w-]+)\/(approve|decline)$/, (c, [id, action]) => decideAssignment(c, id, action === "approve")],
  // The driver at a shop.
  ["GET", /^\/api\/driver\/shops$/, (c) => driverShops(c)],
  ["POST", /^\/api\/driver\/shops\/([\w-]+)\/checkin$/, async (c, [id]) => checkIn(c, id, (await readJson<{ position: unknown }>(c.request)).position)],
  ["POST", /^\/api\/driver\/shops\/checkout$/, (c) => checkOut(c)],
  ["POST", /^\/api\/driver\/shops\/hours\/([\w-]+)\/received$/, (c, [id]) => confirmHoursReceived(c, id)],
  ["GET", /^\/api\/admin\/merchants$/, (c) => adminMerchants(c)],
  ["POST", /^\/api\/admin\/merchants\/([\w-]+)\/review$/, async (c, [id]) => reviewMerchant(c, id, (await readJson<{ action: MerchantDecision }>(c.request)).action)],
  ["POST", /^\/api\/admin\/merchants\/([\w-]+)\/tier$/, async (c, [id]) => setMerchantTier(c, id, (await readJson<{ tier: MerchantTier }>(c.request)).tier)],
  ["POST", /^\/api\/admin\/merchants\/([\w-]+)\/owner$/, async (c, [id]) => setMerchantOwner(c, id, String((await readJson<{ userId: string }>(c.request)).userId))],
  ["POST", /^\/api\/admin\/merchants\/([\w-]+)\/members\/([\w-]+)\/remove$/, (c, [id, member]) => adminRemoveEmployee(c, id, member)],
  ["POST", /^\/api\/admin\/drivers\/([\w-]+)\/manager$/, async (c, [id]) => setDriverManager(c, id, (await readJson<{ contact: string | null }>(c.request)).contact)],
  [
    "GET",
    /^\/api\/driver$/,
    async (c) => {
      // Customers see how to apply, drivers their work; staff, owners and fleet managers have no driver page.
      const user = await c.requireUser();
      if (user.role === "operator" || user.role === "fleet_manager" || user.role === "merchant") throw new ApiError("forbidden", 403);
      return driverHome(c);
    },
  ],
  ["GET", /^\/api\/driver\/pass$/, (c) => driverPass(c)],
  ["POST", /^\/api\/driver\/former-account\/code$/, async (c) => sendFormerAccountCode(c.env, await c.requireUser(), (await readJson<{ contact: string }>(c.request)).contact)],
  ["POST", /^\/api\/driver\/former-account\/claim$/, async (c) => claimFormerAccount(c.env, await c.requireUser(), await readJson<{ contact: string; code: string; pin: string }>(c.request))],
  ["POST", /^\/api\/driver\/apply$/, async (c) => applyDriver(c, await readJson<DriverApplication>(c.request))],
  ["POST", /^\/api\/driver\/documents\/(id|license|portrait)$/, (c, [kind]) => uploadDriverDocument(c, kind, c.request)],
  [
    "POST",
    /^\/api\/driver\/queue$/,
    async (c) => {
      const { stationId, position } = await readJson<{ stationId: string; position: unknown }>(c.request);
      return joinQueue(c, String(stationId), position);
    },
  ],
  ["DELETE", /^\/api\/driver\/queue$/, (c) => leaveQueue(c)],
  ["POST", /^\/api\/driver\/jobs\/([\w-]+)\/accept$/, (c, [id]) => acceptJob(c, id)],
  ["POST", /^\/api\/driver\/jobs\/([\w-]+)\/decline$/, (c, [id]) => declineJob(c, id)],
  ["POST", /^\/api\/driver\/jobs\/([\w-]+)\/abandon$/, async (c, [id]) => abandonJob(c, id, () => readJson<{ reason: string }>(c.request).then((b) => b.reason))],
  [
    "POST",
    /^\/api\/driver\/jobs\/([\w-]+)\/collect$/,
    async (c, [id]) => collectPickup(c, id, (await readJson<{ measures: ParcelMeasures }>(c.request)).measures),
  ],
  ["POST", /^\/api\/driver\/jobs\/([\w-]+)\/door$/, (c, [id]) => arriveAtDoor(c, id)],
  ["POST", /^\/api\/driver\/jobs\/([\w-]+)\/photo$/, (c, [id]) => uploadProof(c, id, c.request)],
  ["POST", /^\/api\/driver\/jobs\/([\w-]+)\/deliver$/, async (c, [id]) => deliverJob(c, id, (await readJson<{ code: string }>(c.request)).code)],
  ["POST", /^\/api\/driver\/jobs\/([\w-]+)\/absent$/, (c, [id]) => failDelivery(c, id)],
  ["POST", /^\/api\/driver\/position$/, async (c) => reportPosition(c, await readJson<unknown>(c.request))],
  ["POST", /^\/api\/driver\/payouts$/, async (c) => askPayout(c, await readJson<unknown>(c.request))],
  ["GET", /^\/api\/admin\/driver-payouts$/, (c) => adminPayouts(c)],
  ["POST", /^\/api\/admin\/driver-payouts\/([\w-]+)$/, async (c, [id]) => decidePayout(c, id, await readJson<unknown>(c.request))],
  ["POST", /^\/api\/push\/token$/, async (c) => registerPushToken(c, await readJson<unknown>(c.request))],
  ["POST", /^\/api\/push\/token\/remove$/, async (c) => removePushToken(c, await readJson<unknown>(c.request))],
  ["POST", /^\/api\/driver\/jobs\/([\w-]+)\/board$/, (c, [id]) => boardRide(c, id)],
  [
    "POST",
    /^\/api\/driver\/jobs\/([\w-]+)\/finish$/,
    // Couriers send the recipient's code (or none, after a photo); rides send nothing.
    async (c, [id]) => finishRide(c, id, (await c.request.json().catch(() => null) as { code?: string } | null)?.code),
  ],
  ["GET", /^\/api\/jobs\/mine$/, (c) => myJobs(c)],
  ["POST", /^\/api\/jobs\/pickup$/, async (c) => bookPickup(c, await readJson<PickupBooking>(c.request))],
  ["POST", /^\/api\/jobs\/ride$/, async (c) => bookRide(c, await readJson<RideBooking>(c.request))],
  ["POST", /^\/api\/jobs\/courier$/, async (c) => bookCourier(c, await readJson<CourierBooking>(c.request))],
  [
    "POST",
    /^\/api\/parcels\/([\w-]+)\/delivery$/,
    async (c, [id]) => {
      const body = await readJson<{ home: unknown; payWith?: unknown }>(c.request);
      return bookDelivery(c, id, body.home, body.payWith);
    },
  ],
  ["POST", /^\/api\/jobs\/([\w-]+)\/cancel$/, (c, [id]) => cancelJob(c, id)],
  ["POST", /^\/api\/jobs\/([\w-]+)\/confirm-receipt$/, (c, [id]) => confirmCourierReceipt(c, id)],
  ["GET", /^\/api\/stations\/([\w-]+)\/drivers$/, (c, [id]) => stationDrivers(c, id)],
  [
    "POST",
    /^\/api\/stations\/([\w-]+)\/drivers\/scan$/,
    async (c, [id]) => driverAtStation(c, id, (await readJson<{ badge: string }>(c.request)).badge),
  ],
  [
    "POST",
    /^\/api\/stations\/([\w-]+)\/drivers\/(handover|receive)$/,
    async (c, [id, action]) => {
      const { badge, jobId, parcel } = await readJson<{ badge: string; jobId: string; parcel: string }>(c.request);
      return action === "handover" ? handToDriver(c, id, badge, String(jobId), parcel) : receiveFromDriver(c, id, badge, String(jobId), parcel);
    },
  ],
  [
    "POST",
    /^\/api\/stations\/([\w-]+)\/drivers\/settle$/,
    async (c, [id]) => {
      const { badge, amount } = await readJson<{ badge: string; amount: number }>(c.request);
      return settleDriver(c, id, badge, amount);
    },
  ],
  ["GET", /^\/api\/admin\/drivers$/, (c) => adminDrivers(c)],
  [
    "POST",
    /^\/api\/admin\/drivers\/([\w-]+)\/review$/,
    async (c, [id]) => reviewDriver(c, id, await readJson<DriverDecision>(c.request)),
  ],
  [
    "POST",
    /^\/api\/admin\/fleet$/,
    async (c) => {
      const { id, input } = await readJson<{ id: string | null; input: FleetVehicleInput }>(c.request);
      return saveFleetVehicle(c, id ? String(id) : null, input);
    },
  ],
  ["POST", /^\/api\/admin\/driver-settings$/, async (c) => saveDriverSettings(c, (await readJson<{ settings: unknown }>(c.request)).settings)],
  [
    "POST",
    /^\/api\/admin\/jobs\/([\w-]+)\/assign$/,
    async (c, [id]) => assignJob(c, id, String((await readJson<{ driverId: string }>(c.request)).driverId)),
  ],
  ["POST", /^\/api\/admin\/jobs\/([\w-]+)\/approve-proof$/, (c, [id]) => approveProof(c, id)],
  [
    "POST",
    /^\/api\/admin\/stations$/,
    async (c) => {
      const { id, input } = await readJson<{ id: string | null; input: StationInput }>(c.request);
      return saveStation(c, id, input);
    },
  ],
  [
    "POST",
    /^\/api\/admin\/stations\/([\w-]+)\/active$/,
    async (c, [id]) => setStationActive(c, id, !!(await readJson<{ active: boolean }>(c.request)).active),
  ],
  ["GET", /^\/api\/admin\/snapshot$/, (c) => adminSnapshot(c)],
  ["GET", /^\/api\/admin\/audit$/, (c) => auditLog(c)],
  [
    "POST",
    /^\/api\/admin\/users\/([\w-]+)\/role$/,
    async (c, [id]) => setUserRole(c, id, (await readJson<{ role: UserRole }>(c.request)).role),
  ],
  [
    "POST",
    /^\/api\/admin\/staff$/,
    async (c) => {
      const { stationId, userId } = await readJson<{ stationId: string; userId: string }>(c.request);
      return assignStaff(c, String(stationId), String(userId));
    },
  ],
  [
    "DELETE",
    /^\/api\/admin\/staff$/,
    async (c) => {
      const { stationId, userId } = await readJson<{ stationId: string; userId: string }>(c.request);
      return unassignStaff(c, String(stationId), String(userId));
    },
  ],
  ["GET", /^\/api\/admin\/promotions$/, (c) => listPromotions(c)],
  [
    "POST",
    /^\/api\/admin\/promotions$/,
    async (c) => {
      const { id, input } = await readJson<{ id: string | null; input: PromotionInput }>(c.request);
      return savePromotion(c, id, input);
    },
  ],
  ["DELETE", /^\/api\/admin\/promotions\/([\w-]+)$/, (c, [id]) => deletePromotion(c, id)],
  ["POST", /^\/api\/admin\/media$/, (c) => uploadImage(c)],
  [
    "POST",
    /^\/api\/admin\/devices$/,
    async (c) => {
      const admin = await c.requireAdmin();
      return createDevice(c.db, await readJson<DeviceInput>(c.request), admin.id);
    },
  ],
  [
    "GET",
    /^\/api\/admin\/devices$/,
    async (c) => {
      await c.requireAdmin();
      return listDevices(c.db);
    },
  ],
  [
    "DELETE",
    /^\/api\/admin\/devices\/([\w:%-]+)$/,
    async (c, [device]) => {
      const admin = await c.requireAdmin();
      return deleteDevice(c.db, decodeURIComponent(device), admin.id);
    },
  ],
  [
    "POST",
    /^\/api\/admin\/devices\/([\w:%-]+)\/outlets\/(\d+)\/(start|stop)$/,
    async (c, [encoded, outlet, action]) => {
      const admin = await c.requireAdmin();
      const device = decodeURIComponent(encoded);
      if (action === "stop") return stopOutlet(c.env, device, Number(outlet), admin.id);
      const { minutes } = await readJson<{ minutes?: number }>(c.request).catch(() => ({ minutes: undefined }));
      return startOutlet(c.env, device, Number(outlet), admin.id, minutes);
    },
  ],
  [
    "POST",
    /^\/api\/admin\/devices\/([\w:%-]+)\/qr$/,
    async (c, [device]) => renewOutletQr(c.env, await c.requireAdmin(), normalizeDeviceId(decodeURIComponent(device))),
  ],
  // Point partners, who own sockets (worker/point-partners.ts)
  [
    "POST",
    /^\/api\/admin\/devices\/([\w:%-]+)\/partner$/,
    async (c, [device]) => setDevicePartner(c, decodeURIComponent(device), (await readJson<{ partnerId?: string | null }>(c.request)).partnerId),
  ],
  ["GET", /^\/api\/admin\/point-partners$/, (c) => adminPointPartners(c)],
  [
    "POST",
    /^\/api\/admin\/point-partners$/,
    async (c) => {
      const { id, input } = await readJson<{ id: string | null; input: PointPartnerInput }>(c.request);
      return savePointPartner(c, id, input);
    },
  ],
  ["POST", /^\/api\/admin\/point-partners\/([\w-]+)\/status$/, async (c, [id]) => setPointPartnerStatus(c, id, (await readJson<{ active?: boolean }>(c.request)).active)],
  [
    "POST",
    /^\/api\/admin\/point-partners\/([\w-]+)\/accounts$/,
    async (c, [id]) => addPointPartnerAccount(c, id, (await readJson<{ contact?: string }>(c.request)).contact),
  ],
  ["DELETE", /^\/api\/admin\/point-partners\/([\w-]+)\/accounts\/([\w-]+)$/, (c, [id, userId]) => removePointPartnerAccount(c, id, userId)],
  ["GET", /^\/api\/point-partner$/, (c) => pointPartnerDashboard(c, reportPeriod(c.url.searchParams.get("days")))],
];

/**
 * Principle 3: every station action is logged with station, person and role (staff, owner,
 * admin), once it succeeded. The action is the route, the station's id replaced by ":station".
 */
async function logStationAction(c: Ctx, method: string, path: string) {
  const a = c.stationAction!;
  const action = `${method} ${path.split("/").map((part) => (part === a.stationId ? ":station" : part)).join("/")}`.slice(0, 200);
  await c.db
    .prepare("insert into station_actions (station_id, person_id, role, action, created_at) values (?, ?, ?, ?, ?)")
    .bind(a.stationId, a.personId, a.role, action, nowIso())
    .run();
}

/** Method and path pattern of every route, for the route × role test (R2, worker/role-matrix.test.ts). */
export const API_ROUTES: readonly (readonly [string, RegExp])[] = ROUTES.map(([method, pattern]) => [method, pattern] as const);

/**
 * Routes anyone may call without signing in (R2). Every other route checks the session before
 * its handler runs, so nothing of a request (its body, a looked-up row) is read for an
 * anonymous caller: they get 401 first.
 */
export const OPEN_ROUTES: ReadonlySet<string> = new Set([
  "GET /api/stations",
  "GET /api/repair-centers",
  "GET /api/operators",
  "GET /api/stations/:id/reviews",
  "GET /api/me",
  "GET /api/auth/captcha",
  "POST /api/auth/send",
  "POST /api/auth/register",
  "POST /api/auth/register-fleet",
  "POST /api/auth/register-merchant",
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "GET /api/reservations/mine",
  "GET /api/promotions/current",
  "GET /api/features",
  "GET /api/greenpoint/total",
  "GET /api/parcels/info",
  "GET /api/parcels/mine",
  "GET /api/fleet-invites",
  "GET /api/merchant-invites",
  "GET /api/staff-invites",
  "GET /api/jobs/mine",
  "GET /api/charging/outlets/:id",
]);

/** "GET /api/stations/:id/reviews" for the route's pattern: every capture group reads ":id". */
export function routeName(method: string, pattern: RegExp): string {
  const path = pattern.source
    .replace(/^\^/, "")
    .replace(/\$$/, "")
    .replace(/\\\//g, "/")
    .replace(/\([^()]*\)/g, ":id");
  return `${method} ${path}`;
}

const OPEN = new Set(ROUTES.filter(([method, pattern]) => OPEN_ROUTES.has(routeName(method, pattern))));

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const c = new Ctx(env, request, url);
  try {
    const mediaMatch = /^\/api\/media\/((?:promotions|stations)\/[\w-]+\.(?:png|jpg|webp|gif))$/.exec(url.pathname);
    if (mediaMatch && (request.method === "GET" || request.method === "HEAD")) return await media(c, mediaMatch[1]);
    // Called by the payment provider, answers in plain text (see worker/payments.ts).
    if (url.pathname === "/api/payments/callback" && request.method === "POST") return await paymentCallback(env, request);
    // Sockets authenticate with their own key, not a user session.
    if (url.pathname === "/api/devices/events") return await handleDeviceEvents(request, env);
    if (url.pathname === "/api/devices/commands") return await handleDeviceCommands(request, env);
    // Private photos of drivers and door handovers: admins only, read as a file.
    const fileMatch = /^\/api\/admin\/driver-files\/((?:drivers|proofs)\/[\w/.-]+)$/.exec(url.pathname);
    if (fileMatch && request.method === "GET") return await driverFile(c, fileMatch[1]);

    if (url.pathname === "/api/devices/xingke") return await handleXingkeCallback(request, env);
    // Other apps authenticate with their API key (worker/partners.ts).
    const partnerApi = url.pathname.startsWith(`${PARTNER_API_BASE}/`) || url.pathname === PARTNER_API_BASE;
    // A switched-off parcel module answers as if it did not exist; the backoffice keeps its pages.
    if ((partnerApi || PARCEL_ROUTE.test(url.pathname)) && !(await parcelsEnabled(env))) return json({ error: "not_found" }, 404);
    if (partnerApi) return await handlePartnerApi(request, env);
    for (const route of ROUTES) {
      const [method, pattern, handler] = route;
      const m = pattern.exec(url.pathname);
      if (!m) continue;
      if (request.method !== method) continue;
      if (!OPEN.has(route)) await c.requireUser();
      const result = await handler(c, m.slice(1));
      if (c.stationAction && request.method !== "GET") await logStationAction(c, request.method, url.pathname);
      return json(result ?? null);
    }
    return json({ error: "not_found" }, 404);
  } catch (err) {
    if (err instanceof ApiError) return json({ error: err.code }, err.status);
    console.error(err);
    return json({ error: "unknown" }, 500);
  }
}
