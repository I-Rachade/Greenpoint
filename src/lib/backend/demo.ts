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
import { BackendError, type Backend, type BackendErrorCode, type CodeChannel, type StartChargeInput, type StatusPatch } from "./backend";
import { applyDemoSwapBattery, resolveDemoBattery, seedDemoBatteries, type DemoBattery, type DemoBatteryEvent, type DemoSwapBattery } from "./demo-batteries";
import {
  BATTERY_LIST_MAX,
  batteryNumbersRequired,
  cleanStatusReason,
  isBatteryStatus,
  REGISTER_MAX,
  sortBrands,
  type BatteryDetail,
  type BatteryFilter,
  type BatteryHistoryEntry,
  type BatteryList,
  type BatteryLookup,
  type BatteryStatusInput,
  type BatteryView,
  type RegisterBatteriesInput,
  type RegisterBatteriesResult,
} from "../batteries";
import {
  freeOfType,
  heldTargets,
  kindFrom,
  RESERVATION_CODE_LOCK_MINUTES,
  RESERVATION_MAX_CODE_FAILURES,
  reservationKind,
  typeOfKind,
  type ReservationKind,
} from "../reservations";
import { getActiveStation } from "../active-station";
import {
  applyBatteryEvent,
  CAPACITY_REASON,
  cleanBatteryLabel,
  cleanReason,
  dayStartLome,
  isSwapCustomerType,
  takesBatteryIn,
  validAmount,
  validCorrection,
  validRequestId,
  type BatteryEventInput,
  type BatteryEventType,
  type BatteryEventView,
  type CounterKey,
  type CounterRow,
  type StationCounter,
  type StationRole,
  type SwapEntry,
  type SwapFilter,
  type SwapInput,
  type SwapPayment,
} from "../station-work";
import {
  chargePrice,
  contactFromCode,
  DEFAULT_CHARGE_TARIFF,
  DEFAULT_EV_TARIFF,
  validTariff,
  type AdminCharging,
  type ChargeOutletInfo,
  type ChargePointState,
  type ChargeSession,
  type ChargeTariff,
  type ChargeTariffInput,
  type StationCharging,
} from "../charging";
import { cardTagVariants, cleanCardTag, sortCards, validAdjustment, type ChargeCard, type ChargeCardInput, type CounterCard } from "../charge-cards";
import {
  DEMO_CHARGING_POINTS,
  DEMO_OPERATORS,
  DEMO_STATIONS,
  demoSocketPoints,
  initialDemoStatus,
  DEMO_BATTERY_TYPES,
  DEMO_STATION_BATTERY_TYPES,
  DEMO_EV_CHARGERS,
  DEMO_EV_POINT,
  DEMO_STATION_EXTRAS,
  demoReviews,
  type DemoReview,
} from "./demo-data";
import { cleanAmenities, cleanMainActivity, cleanPhotos, cleanReview, isUnattended, ratingOf, shortName, type ReviewInput, type StationReview } from "../station-extras";
import { depotPoints, hasAnyPoint, kindFor } from "../station-points";
import {
  cleanSwapOwner,
  COMMISSION_MODES,
  handoverInputError,
  HANDOVER_NOTE_MAX,
  monthStartOf,
  stationCash,
  swapOwnerOf,
  validCommissionPct,
  type CashHandover,
  type CashItem,
  type CommissionMode,
  type HandoverInput,
  type HandoverStatus,
  type StationCash,
  type StationCashSettings,
  type SwapOwner,
} from "../station-cash";
import { validBatteryType, type BatteryType, type BatteryTypeInput } from "../battery-types";
import { DEMO_OWNERS, DEMO_STAFF, demoHistory, demoReassignments, demoUsers } from "../admin/demo-seed";
import { cleanOpeningHours } from "../opening-hours";
import { emptyDays, periodStart, reportPeriod, type Handover, type OwnerLive, type OwnerReport, type ReportPeriod, type StaffStats } from "../owner-backoffice";
import {
  ADMIN_HISTORY_DAYS,
  ADMIN_PAGE_SIZE,
  SNAPSHOT_RESERVATION_DAYS,
  type AdminReservationPage,
  type AdminReservationQuery,
  type AdminSnapshot,
  type AdminUser,
  type AuditEntry,
  type AuditFilter,
  type StaffAssignment,
} from "../admin/types";
import { validPinFormat, weakPin } from "../pin";
import { effectiveFeatures, type Features } from "../features";
import { MAX_PROMO_IMAGE_BYTES, pickPromotion, type Promotion, type PromotionInput } from "../promo";
import {
  DEFAULT_PARCEL_SIZES,
  newTrackingNo,
  PARCEL_CODE_LOCK_MINUTES,
  PARCEL_MAX_CODE_FAILURES,
  PARCEL_PICKUP_DAYS,
  needsLabel,
  OPEN_PARCEL_STATUSES,
  parseHandoverInput,
  parsePickupInput,
  parseParcelScan,
  sizeFor,
  sortHistory,
  type AdminParcels,
  type Parcel,
  type ParcelDepot,
  type ParcelDepotInput,
  type ParcelHistoryEntry,
  type ParcelInput,
  type ParcelMeasures,
  type ParcelRun,
  type ParcelRunStatus,
  type ParcelScanKind,
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
  checkDriverPass,
  fleetTag,
  signDriverPass,
  OPEN_JOB_EXPIRY_MINUTES,
  type DriverPass,
  type FormerAccount,
  pickDriver,
  validPoint,
  freshPosition,
  TRACKED_JOB_STATUSES,
  type DriverPosition,
  validSettings,
  vehicleFits,
  jobFits,
  withAllVehicles,
  BOOKABLE_VEHICLE_TYPES,
  MAX_PASSENGERS,
  type AbandonReason,
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
  type CourierBooking,
  type BookableVehicleType,
  type DropoffPoint,
  type StationDrivers,
  owedToDriver,
  PAYOUT_NETWORKS,
  TOUR_KINDS,
  type AdminDriverPayout,
  type DriverPayout,
  type PayoutNetwork,
  type TripPayment,
} from "../drivers";
import { distanceMeters, type LatLng } from "../geo";
import { parseContact } from "../contact";
import {
  cleanFleetName,
  driverLimit,
  FLEET_INVITE_DAYS,
  FLEET_TIERS,
  fleetRange,
  jobForManager,
  managesFleet,
  STANDARD_DRIVER_LIMIT,
  statsUnlocked,
  type AdminFleet,
  type FleetDecision,
  type FleetInfo,
  type FleetInvite,
  type FleetRemoval,
  type FleetStatement,
  type FleetStats,
  type FleetStatus,
  type FleetTier,
  type FleetView,
  type MyFleetInvite,
} from "../fleet";
import {
  CREDIT_CODE_MINUTES,
  CREDIT_TOPUP_MIN_XOF,
  maxTopup,
  newTrxId,
  parseAmount,
  parseCreditCode,
  personLabel,
  WALLET_REMARK_MAX,
  type AdminWallet,
  type AdminWalletTransaction,
  type CounterCredit,
  type CreditCode,
  type CreditTopupInput,
  type CreditTopupResult,
  type WalletAdjustInput,
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
import {
  OPERATOR_NAME_MAX,
  STAFF_INVITE_DAYS,
  STAFF_INVITE_LIMIT,
  validPrice,
  type AdminOperator,
  type MyStaffInvite,
  type OperatorInput,
  type OwnerStationInput,
  type OwnerView,
} from "../operators";
import {
  POINT_PARTNER_NAME_MAX,
  type AdminPointPartner,
  type PartnerPoint,
  type PointPartnerDashboard,
  type PointPartnerInput,
  type PointPartnerStatus,
} from "../point-partners";
import { validEvCharger, type EvCharger, type EvChargerInput } from "../ev-chargers";
import { cleanRepairCenter, type RepairCenter, type RepairCenterInput } from "../repair-centers";
import { canSwitch, normalizeDeviceId, outletLabel, validDeviceInput, type Device, type DeviceInput } from "../iot/devices";
import { ocppKey } from "../iot/ocpp";
import {
  cleanMerchantName,
  cleanRate,
  employeeLimit,
  endOfDay,
  FAVORITE_ROUND_MINUTES,
  hourlyAmount,
  cleanAddressLabel,
  hasStatistics,
  MAX_MERCHANT_ADDRESSES,
  merchantStats,
  validStatsQuery,
  MERCHANT_ADDRESS_MAX,
  MERCHANT_INVITE_DAYS,
  MERCHANT_PAY_MODES,
  MERCHANT_TIERS,
  nearShop,
  STANDARD_EMPLOYEE_LIMIT,
  type AdminMerchant,
  type CheckoutBy,
  type DriverShops,
  type MerchantActivity,
  type MerchantAddress,
  type MerchantAddressInput,
  type MerchantApprover,
  type MerchantAssignmentRequest,
  type MerchantBookingsQuery,
  type MerchantCheckin,
  type MerchantDecision,
  type MerchantDriver,
  type MerchantDriverInput,
  type MerchantDriverKind,
  type MerchantDriverStatus,
  type MerchantInfo,
  type MerchantInvite,
  type MerchantJob,
  type MerchantMember,
  type MerchantPayMode,
  type MerchantShopInput,
  type MerchantStats,
  type MerchantStatsQuery,
  type MerchantStatus,
  type MerchantTier,
  type MerchantToday,
  type MerchantView,
  type MyMerchantInvite,
} from "../merchants";
import {
  customerStation,
  globalServices,
  isStationService,
  STATION_SERVICES,
  type ServiceRequestStatus,
  type StationService,
  type StationServiceInfo,
} from "../station-services";

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

type DemoHandover = CashHandover & { createdById: string; decidedById: string | null };

/** A stored closing as the API shows it, without who made and decided it. */
function handoverView(h: DemoHandover): CashHandover {
  const view: CashHandover & Partial<Pick<DemoHandover, "createdById" | "decidedById">> = { ...h, staffId: h.staffId ?? null };
  delete view.createdById;
  delete view.decidedById;
  return view;
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
  /** Electric car chargers, assigned to a station or not. */
  evChargers?: EvCharger[];
  /** Repair workshops away from stations (as table repair_centers, migration 0046); missing = none. */
  repairCenters?: RepairCenter[];
  /** Battery types each station swaps, by station id. */
  stationBatteryTypes?: Record<string, string[]>;
  /** Full batteries per battery type, by station id then type id (default: the station's total spread over its types). */
  typeBatteries?: Record<string, Record<string, number>>;
  parcelSizes?: ParcelSizeTier[];
  parcelCodeFailures?: { stationId: string; at: string }[];
  /** Collection runs and parcel scans (plan phase 7), as parcel_runs and parcel_scans (migration 0034). */
  parcelRuns?: DemoRun[];
  parcelScans?: DemoScan[];
  /** Wrong pickup codes per reservation (as reservation_code_failures, migration 0029). */
  reservationCodeFailures?: { reservationId: string; at: string }[];
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
  /** Point partners who own sockets (as point_partners, migration 0039); missing = the seed. */
  pointPartners?: DemoPointPartner[];
  /** Accounts of point partners (as point_partner_accounts); one partner per account. */
  pointPartnerAccounts?: { userId: string; partnerId: string; createdAt: string }[];
  /** Contact phones of operators, set in the backoffice. */
  operatorPhones?: Record<string, string | null>;
  /** Parcel module switch of the backoffice (missing = on). */
  parcelsEnabled?: boolean;
  /** Courses, express and trips at home; off until an admin switches it on (as in worker/features.ts). */
  driversEnabled?: boolean;
  /** Lite version switch of the backoffice (missing = off, as in worker/features.ts). */
  liteEnabled?: boolean;
  /** Demo PINs by phone number or e-mail address (stored in clear: demo only). */
  pins?: Record<string, string>;
  /** Customer reviews (missing = the example reviews). */
  reviews?: DemoReview[];
  /** Charges at a socket (demo only: the socket pretends to draw DEMO_CHARGE_WATTS). */
  charges?: DemoCharge[];
  chargeTariff?: ChargeTariff;
  stationTariffs?: Record<string, { kwhXof: number | null; minXof: number | null }>;
  /** Car chargers' price (0048): the network one and each station's own. */
  evTariff?: ChargeTariff;
  stationEvTariffs?: Record<string, { kwhXof: number | null; minXof: number | null }>;
  /** Charging cards (missing = one card swiped at a socket, not linked yet). */
  chargeCards?: DemoChargeCard[];
  /** Cash put on cards at a counter, for the station's takings. */
  cardTopups?: { stationId: string; amountXof: number; at: string }[];
  /** Service unlock per station (as table station_services; filled in by withServiceRows). */
  stationServices?: DemoServiceRow[];
  /** Counter events, newest first (as table battery_events). */
  batteryEvents?: (BatteryEventView & { requestId: string; stationId: string; personId: string })[];
  /** Empty batteries charging at the station, by station id then counter key (battery_counter.empty). */
  batteryEmpty?: Record<string, Record<string, number>>;
  /** Battery register (migration 0041): batteries and their history (default: seedDemoBatteries). */
  batteries?: DemoBattery[];
  batteryHistory?: DemoBatteryEvent[];
  /** Swap price per station in FCFA (stations.price_battery_xof); missing = DEMO_SWAP_PRICE at own stations. */
  swapPrices?: Record<string, number | null>;
  /** Swap log, newest first (as table swap_log); `owner` as swap_log.owner (0045, missing = the station's rule). */
  swaps?: (SwapEntry & { requestId: string; staffId: string; customerId: string | null; driverId?: string | null; fleetManagerId?: string | null; owner?: SwapOwner })[];
  /** Station type and the host's commission of partner stations (stations.swap_owner, commission_*; 0045). */
  stationCash?: Record<string, { swapOwner: SwapOwner | null; commissionPct: number; commissionMode: CommissionMode }>;
  /** Cash closings of partner stations (as table cash_handovers), with who made and decided them. */
  cashHandovers?: DemoHandover[];
  /** Fleets (as table fleets, 0032); missing = the demo fleet manager's approved fleet. */
  fleets?: DemoFleet[];
  /** Fleet invites, newest first (as table fleet_invites). */
  fleetInvites?: DemoInvite[];
  /** The owner's list to re-staff (as table staff_reassignments, migration 0033); missing = the seed. */
  staffReassignments?: DemoReassignment[];
  /** Every station action, newest first (as table station_actions, migration 0033). */
  stationActions?: { stationId: string; personId: string; role: StationRole; createdAt: string }[];
  /** Shops (as table merchants, 0035); missing = the demo shop "Boutique Akwaba". */
  merchants?: DemoMerchant[];
  /** Who belongs to which shop (merchant_members); missing = the demo merchant in the demo shop. */
  merchantMembers?: DemoMember[];
  /** Employee invites, newest first (merchant_invites). */
  merchantInvites?: DemoMerchantInvite[];
  /** Staff invites, oldest first (staff_invites, 0050). */
  staffInvites?: DemoStaffInvite[];
  /** Favorite and assigned drivers of the shops (merchant_drivers). */
  merchantDrivers?: DemoMerchantDriver[];
  /** Check-ins of assigned drivers, newest first (merchant_checkins). */
  merchantCheckins?: DemoCheckin[];
  /** Saved pickup addresses of the shops (merchant_addresses, 0036). */
  merchantAddresses?: (MerchantAddress & { merchantId: string })[];
  /** The last position each driver on duty reported (driver_positions, 0037). */
  driverPositions?: Record<string, DriverPosition>;
  /** Driver phase 2: requests to be paid out on Flooz/T-Money (driver_payouts). */
  driverPayouts?: (DriverPayout & { driverId: string })[];
}

interface DemoMerchant {
  id: string;
  ownerId: string;
  name: string;
  phone: string;
  address: string;
  lat: number;
  lng: number;
  status: MerchantStatus;
  tier: MerchantTier;
  createdAt: string;
  reviewedAt: string | null;
}

interface DemoMember {
  userId: string;
  merchantId: string;
  isOwner: boolean;
  createdAt: string;
}

interface DemoMerchantInvite extends MerchantInvite {
  merchantId: string;
  userId: string | null;
}

/** As table staff_invites (0050): made for a phone number or e-mail address, account or not. */
interface DemoStaffInvite {
  id: string;
  stationId: string;
  contact: string;
  invitedBy: string;
  status: "pending" | "accepted" | "declined" | "revoked" | "expired";
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  userId: string | null;
}

interface DemoMerchantDriver {
  id: string;
  merchantId: string;
  driverId: string;
  kind: MerchantDriverKind;
  status: MerchantDriverStatus;
  payMode: MerchantPayMode | null;
  ratePerHourFcfa: number | null;
  createdAt: string;
  approvedAt: string | null;
  approvedAs: MerchantApprover | null;
  endedAt: string | null;
}

interface DemoCheckin {
  id: string;
  merchantId: string;
  driverId: string;
  assignmentId: string;
  payMode: MerchantPayMode;
  ratePerHourFcfa: number | null;
  inAt: string;
  outAt: string | null;
  outBy: CheckoutBy | null;
  amountFcfa: number | null;
  receivedAt: string | null;
}

/** Trips with a door step (as hasDoorStep in worker/drivers.ts): home deliveries and shop couriers. */
function hasDoorStep(job: { kind: DemoJob["kind"]; merchantId?: string | null }): boolean {
  return job.kind === "delivery" || (job.kind === "courier" && !!job.merchantId);
}

/** The demo shop: approved, near the Bè station, run by the demo merchant login. */
const DEMO_MERCHANT_ID = "merchant-akwaba";

function seedMerchants(): DemoMerchant[] {
  return [
    {
      id: DEMO_MERCHANT_ID,
      ownerId: "demo-merchant",
      name: "Boutique Akwaba",
      phone: "+22890000066",
      address: "Bè Kpota, à côté de la station",
      lat: 6.1382,
      lng: 1.2431,
      status: "approved",
      tier: "standard",
      createdAt: "2026-10-01T08:00:00.000Z",
      reviewedAt: "2026-10-01T08:00:00.000Z",
    },
  ];
}

function seedMembers(): DemoMember[] {
  return [{ userId: "demo-merchant", merchantId: DEMO_MERCHANT_ID, isOwner: true, createdAt: "2026-10-01T08:00:00.000Z" }];
}

interface DemoReassignment {
  id: string;
  userId: string;
  stationId: string;
  operatorId: string;
  createdAt: string;
  resolvedAt: string | null;
}

interface DemoFleet {
  managerId: string;
  name: string;
  status: FleetStatus;
  tier: FleetTier;
  createdAt: string;
  reviewedAt: string | null;
}

interface DemoInvite extends FleetInvite {
  managerId: string;
  userId: string | null;
}

/** The demo fleet manager starts with an approved fleet of the standard tier, as existing fleets after 0032. */
function seedFleets(): DemoFleet[] {
  return [{ managerId: "demo-fleet_manager", name: "Flotte Express", status: "approved", tier: "standard", createdAt: "2026-10-01T08:00:00.000Z", reviewedAt: "2026-10-01T08:00:00.000Z" }];
}

interface DemoServiceRow {
  stationId: string;
  service: StationService;
  unlocked: boolean;
  status: ServiceRequestStatus | null;
  requestedBy: string | null;
  requestedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

/** `partnerId`: the socket's point partner when the charge started (charging_sessions.partner_id). */
type DemoCharge = ChargeSession & { userId: string | null; pointId: string; startedBy?: string; partnerId?: string | null };

type DemoPointPartner = { id: string; name: string; contactPhone: string | null; status: PointPartnerStatus; createdAt: string };

/** A point partner with no account yet, so the backoffice page is not empty. */
const DEMO_POINT_PARTNERS: DemoPointPartner[] = [
  { id: "demo-pp-solaire", name: "Solaire Togo SARL", contactPhone: "+22890112233", status: "active", createdAt: "2026-10-01T08:00:00.000Z" },
];

/** The demo socket draws this much while charging, so energy and price move on screen. */
const DEMO_CHARGE_WATTS = 360;

interface DemoWallet {
  enabled: boolean;
  balances: Record<string, number>;
  frozen: string[];
  /** Ledger, newest first, with the idempotency key of each payment. */
  transactions: (AdminWalletTransaction & { key?: string; stationId?: string; staffId?: string })[];
  /** Green Credit stations (0047); absent: every demo station, so it can be tried right away. */
  creditStations?: string[];
  /** Highest balance (0 = no limit). */
  maxXof?: number;
  /** Counter codes shown after the PIN (credit_codes). */
  codes?: { code: string; userId: string; expiresAt: string; used: boolean }[];
}

/** Starting balance of every demo Green Credit, so charging by QR code can be tried right away. */
export const DEMO_WALLET_START = 25_000;
/** The demo's balance limit, as migration 0047. */
const DEMO_CREDIT_MAX = 50_000;

/** Signs the demo's driver passes (app_settings.driver_pass_secret on Cloudflare). */
const DEMO_PASS_SECRET = "demo-driver-pass";

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
  return { enabled: true, balances: {}, frozen: [], transactions: [] };
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
    // Afi runs poinderecharge's stations, so they count as staffed (isUnattended) and can be reserved.
    operatorOwners: DEMO_OWNERS,
    inactive: [],
    audit: [],
    promotions: [demoPromotion(now)],
  };
}

/** A demo box's QR token: fixed per device, so a printed demo code keeps working (the Worker draws random ones). */
function demoBoxToken(externalId: string): string {
  return [...externalId].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("").slice(0, 32).padEnd(32, "0");
}

function randomBoxToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Saved demo states from before one QR code per box have no token. */
function boxToken(d: Device): string {
  return d.qrToken ?? demoBoxToken(d.externalId);
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
      protocol: null,
      ocppOpen: false,
      outlets: DEMO_CHARGING_POINTS.length,
      lastSeenAt: null,
      createdAt: "2026-10-01T08:00:00.000Z",
      partnerId: null,
      qrToken: demoBoxToken(first.deviceId!),
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
      protocol: null,
      ocppOpen: false,
      outlets,
      lastSeenAt: null,
      createdAt: "2026-10-01T08:00:00.000Z",
      partnerId: null,
      qrToken: demoBoxToken(externalId),
      points: demoSocketPoints(stationId, externalId, outlets, free),
    })),
    {
      // The car charger of Grand Marché, connected over OCPP (DEMO_EV_CHARGERS).
      externalId: DEMO_EV_POINT.deviceId!,
      stationId: DEMO_EV_POINT.stationId,
      vendor: "OCPP",
      model: "Borne 22 kW",
      link: "own_server",
      protocol: "ocpp1.6",
      ocppOpen: false,
      outlets: 1,
      lastSeenAt: null,
      createdAt: "2026-10-01T08:00:00.000Z",
      partnerId: null,
      qrToken: demoBoxToken(DEMO_EV_POINT.deviceId!),
      points: [DEMO_EV_POINT],
    },
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
  /** When the driver's last offer ran out (DriverHome.lastExpiredAt). */
  lastExpiredAt?: string | null;
}

/** A trip as the demo keeps it: the view (driver filled in on reading) plus bookkeeping. */
/** What the wallet shows for a trip's payment and refund (tripLabel in worker/drivers.ts). */
function tripLabel(kind: DeliveryJob["kind"], trackingNo?: string | null): string {
  const what = kind === "ride" ? "trajet" : kind === "delivery" ? "livraison" : "coursier";
  return trackingNo ? `${what} ${trackingNo}` : what;
}

interface DemoJob extends Omit<DeliveryJob, "driver" | "trackingNo"> {
  customerUserId: string | null;
  driverId: string | null;
  driverStationId: string | null;
  declined: string[];
  /** The shop that booked the trip and who of it (delivery_jobs.merchant_id, booked_by). */
  merchantId?: string | null;
  bookedBy?: string | null;
  /** Which of the driver's trips this is on a tour (delivery_jobs.tour_slot). */
  tourSlot?: number;
}

interface DemoRun {
  id: string;
  stationId: string;
  driverId: string;
  status: ParcelRunStatus;
  createdAt: string;
  departedAt: string | null;
  createdBy: string;
  role: StationRole;
}

interface DemoScan {
  parcelId: string;
  /** The collection run or the driver trip; "" for a parcel that left before scans. */
  runId: string;
  kind: ParcelScanKind;
  driverId: string | null;
  stationId: string | null;
  by: string;
  role: StationRole | "driver";
  at: string;
}

interface DemoLedger extends LedgerEntry {
  driverId: string;
  /** Who settled at the station (driver_ledger.actor). */
  by?: string;
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

/**
 * What a station's set-up offers: unlocked by itself, like the triggers and the backfill
 * of migration 0026 (new station, kind changed, depot switched on, outlet registered,
 * car charger assigned). Rows are only ever added, so a service an admin switched off stays off.
 */
function setUpServices(state: DemoState, station: Station): StationService[] {
  const out: StationService[] = [];
  if (offersSwap(station.kind)) out.push("swap");
  const outlets = (state.devices ?? seedDevices()).some((d) => d.points.some((p) => p.stationId === station.id));
  if (offersCharging(station.kind) || outlets) out.push("charging");
  if ((state.evChargers ?? DEMO_EV_CHARGERS).some((c) => c.stationId === station.id)) out.push("ev");
  if ((state.parcelDepots ?? seedDepots()).some((d) => d.stationId === station.id && d.isActive)) out.push("parcels", "drivers");
  return out;
}

function withServiceRows(state: DemoState): DemoState {
  const rows = state.stationServices ?? [];
  const added: DemoServiceRow[] = [];
  for (const station of state.stations) {
    for (const service of setUpServices(state, station)) {
      if (rows.some((r) => r.stationId === station.id && r.service === service)) continue;
      added.push({ stationId: station.id, service, unlocked: true, status: "approved", requestedBy: null, requestedAt: null, decidedBy: null, decidedAt: null });
    }
  }
  return added.length || !state.stationServices ? { ...state, stationServices: [...rows, ...added] } : state;
}

/** Station unlocked for the service (global switch not checked), as stationUnlocked() in worker/services.ts. */
function stationUnlocked(state: DemoState, stationId: string, service: StationService): boolean {
  return (withServiceRows(state).stationServices ?? []).some((r) => r.stationId === stationId && r.service === service && r.unlocked);
}

/** Global switch on AND station unlocked, as serviceActive() in worker/services.ts. */
function serviceActive(state: DemoState, stationId: string, service: StationService): boolean {
  return globalServices(demoFeatures(state))[service] && stationUnlocked(state, stationId, service);
}

/** Appends an activity log entry, like the Worker does on Cloudflare. */
/** The modules shown, as worker/features.ts works them out. */
function demoFeatures(state: DemoState): Features {
  return effectiveFeatures({ parcels: state.parcelsEnabled !== false, drivers: state.driversEnabled === true, lite: state.liteEnabled === true });
}

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

/** Couriers and a shop's rides are paid when the trip starts; a customer's ride at the end (collectsAtStart in worker/drivers.ts). */
function collectsAtStart(job: Pick<DemoJob, "kind" | "merchantId">): boolean {
  return job.kind === "courier" || (job.kind === "ride" && !!job.merchantId);
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
  /** The station action under way (stationActor), logged by the save that completes it. */
  private pendingAction: { stationId: string; personId: string; role: StationRole; at: number } | null = null;

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

  private save(next: DemoState) {
    // Whatever the admin set up is unlocked, as the triggers of migration 0026 do.
    let state = withServiceRows(next);
    // The station action this save completes is logged with station, person and role, as
    // logStationAction() in worker/api.ts does once a request succeeded. A refused action
    // never reaches a save; what it left behind is dropped after a moment.
    const action = this.pendingAction;
    this.pendingAction = null;
    if (action && Date.now() - action.at < 2000) {
      state = {
        ...state,
        stationActions: [{ stationId: action.stationId, personId: action.personId, role: action.role, createdAt: new Date().toISOString() }, ...(state.stationActions ?? [])].slice(0, 2000),
      };
    }
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
      // What active reservations hold, per battery type, outlet and car charger (as stations() in worker/api.ts).
      const holds = heldTargets(state.reservations, s.id);
      // Demo sockets pretend to report all the time.
      // A car charger's outlet is not a motorbike place: it shows on its charger (evChargers[].point).
      const evPoints = new Map((state.evChargers ?? DEMO_EV_CHARGERS).filter((c) => c.pointId).map((c) => [c.pointId!, c]));
      const stationPoints = (state.devices ?? seedDevices()).flatMap((d) => d.points).filter((p) => p.stationId === s.id);
      const chargingPoints = stationPoints
        .filter((p) => !evPoints.has(p.id))
        .map((p) => ({ ...p, lastSeenAt: seen, ...(holds.has(`charging_point:${p.id}`) ? { reserved: true } : {}) }));
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
        .map((t) => ({ ...t, fullBatteries: counts[t.id] ?? 0, reserved: holds.get(`swap:${t.id}`) ?? 0 }));
      const evChargers = (state.evChargers ?? DEMO_EV_CHARGERS)
        .filter((c) => c.stationId === s.id && c.isActive)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ id, name, connector, powerKw, pointId }) => {
          const p = stationPoints.find((x) => x.id === pointId && x.deviceId);
          const point = p
            ? { point: { id: p.id, status: p.status, deviceId: p.deviceId, outlet: p.outlet, lastSeenAt: seen, ...(p.qrStart ? { qrStart: true } : {}) } }
            : {};
          return { id, name, connector, powerKw, ...(holds.has(`charging_point:${id}`) ? { reserved: true } : {}), ...point };
        });
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
        evChargers,
        // Staff of the station or an owner of its operator, as the Worker counts them.
        hasStaff:
          (state.staff ?? DEMO_STAFF).some((a) => a.stationId === s.id) || (state.operatorOwners ?? []).some((x) => x.operatorId === s.operatorId),
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
    // Only the services active at each station, as publicStations() in worker/api.ts.
    const features = demoFeatures(state);
    return views
      .filter((s) => features.parcels || s.kind !== "parcel")
      .map((s) => customerStation(s, new Set(STATION_SERVICES.filter((service) => serviceActive(state, s.id, service)))))
      .filter((s) => s !== null);
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
    const member = state.profile.role === "merchant" ? this.membershipOf(state, state.profile.id) : null;
    const link = (state.pointPartnerAccounts ?? []).find((a) => a.userId === state.profile!.id);
    const partner = link && this.pointPartnersOf(state).find((p) => p.id === link.partnerId);
    return {
      ...state.profile,
      driverStatus: driver?.status ?? null,
      ...(partner ? { pointPartner: { id: partner.id, name: partner.name, status: partner.status } } : {}),
      ...(state.profile.role === "merchant"
        ? { merchant: member ? { id: member.shop.id, name: member.shop.name, status: member.shop.status, isOwner: member.isOwner } : null }
        : {}),
    };
  }

  async getProfile() {
    return this.profileOf(this.load());
  }

  onAuthChange(callback: (profile: Profile | null) => void) {
    return this.subscribe(() => callback(this.profileOf(this.load())));
  }

  /** The demo sends no codes, so it needs no robot check. */
  async captchaSiteKey() {
    return null;
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
      fullName: known?.fullName ?? (demoRole === "driver" ? "Kodjo (chauffeur)" : null),
      // A demo customer approved as a driver, or taken on by a shop, keeps that account (as on Cloudflare).
      role: known?.role === "driver" || known?.role === "merchant" ? known.role : demoRole,
      ownerOf: ownedOperators(state, `demo-${demoRole}`),
    };
    const signedIn: AdminUser = {
      ...profile,
      createdAt: known?.createdAt ?? new Date().toISOString(),
      lastSignInAt: new Date().toISOString(),
    };
    this.save({ ...state, profile, users: [signedIn, ...users.filter((u) => u.id !== profile.id)], ...this.demoDriverSeed(state, profile) });
    return this.profileOf(this.load())!;
  }

  /** The demo driver login comes with an approved driver on the moto, in the demo fleet. */
  private demoDriverSeed(state: DemoState, profile: Profile): Partial<DemoState> {
    if (profile.id !== "demo-driver" || (state.drivers ?? []).some((d) => d.userId === profile.id)) return {};
    const fleet = state.fleet ?? seedFleet();
    const taken = new Set((state.drivers ?? []).map((d) => d.vehicleId));
    const vehicle = fleet.find((v) => v.isActive && !taken.has(v.id));
    const driver: DemoDriver = {
      userId: profile.id,
      status: "active",
      fullName: profile.fullName ?? "Kodjo",
      phone: profile.phone,
      idNumber: "TG-DEMO-01",
      licenseNumber: "PC-DEMO-01",
      wantedType: vehicle?.type ?? "moto",
      documents: {},
      vehicleId: vehicle?.id ?? null,
      code: newDriverCode(),
      createdAt: new Date().toISOString(),
      reviewedAt: new Date().toISOString(),
    };
    return {
      drivers: [driver, ...(state.drivers ?? [])],
      fleetLinks: [...(state.fleetLinks ?? []), { driverId: profile.id, managerId: "demo-fleet_manager" }],
    };
  }

  /** The role of an account (users.role on Cloudflare). */
  private roleOf(state: DemoState, userId: string): UserRole | null {
    if (state.profile?.id === userId) return state.profile.role;
    return (state.users ?? demoUsers(new Date())).find((u) => u.id === userId)?.role ?? null;
  }

  /** As drives() in worker/drivers.ts: an approved, active driver on a driver account. */
  private drives(state: DemoState, d: DemoDriver | undefined | null): d is DemoDriver {
    return !!d && d.status === "active" && this.roleOf(state, d.userId) === "driver";
  }

  /** Changes the role of an account in the user list and, when signed in, in the profile. */
  private withRole(state: DemoState, userId: string, role: UserRole): DemoState {
    return {
      ...state,
      users: (state.users ?? demoUsers(new Date())).map((u) => (u.id === userId ? { ...u, role } : u)),
      profile: state.profile?.id === userId ? { ...state.profile, role } : state.profile,
    };
  }

  /** R11/R2: drivers, fleet managers, station staff/owners and merchants are never customers (refuseNonCustomer in worker/roles.ts). */
  private refuseNonCustomer(profile: Profile) {
    if (profile.role === "driver" || profile.role === "fleet_manager" || profile.role === "operator" || profile.role === "merchant") throw new BackendError("forbidden");
  }

  /** R15 (customerThingsOpen in worker/drivers.ts): money, an active reservation, an open parcel or a booked trip. */
  private customerThingsOpen(state: DemoState, userId: string, phone: string | null): boolean {
    const now = new Date().toISOString();
    if (this.wallet(state).balances[userId] && this.balance(this.wallet(state), userId) > 0) return true;
    if (state.reservations.some((r) => r.userId === userId && r.status === "active" && r.expiresAt > now)) return true;
    const open = ["deposited", "in_transit", "arrived", "stored"];
    if (
      (state.parcels ?? []).some(
        (p) =>
          open.includes(p.status) &&
          (p.sender.userId === userId || p.recipient.userId === userId || (!!phone && (p.sender.phone === phone || p.recipient.phone === phone))),
      )
    ) {
      return true;
    }
    return (state.jobs ?? []).some((j) => j.customerUserId === userId && !["done", "failed", "cancelled"].includes(j.status));
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

  /** As reserve() in worker/api.ts: riders only; a free battery of the type, or a free outlet or car charger. */
  async reserve(stationId: string, kindOrType: ReservationKind | ReservationType, wanted?: string | null) {
    const state = this.load();
    const profile = this.requireProfile(state);
    if (profile.role !== "customer") throw new BackendError("forbidden");
    if (!profile.phone) throw new BackendError("phone_required");
    const kind = kindFrom(kindOrType);
    if (!kind) throw new BackendError("unknown", "bad_request");
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
    if (isUnattended(this.views(state, [station])[0])) throw new BackendError("station_unattended");
    if (!status.isOpen || !withinOpeningHours(station.openingHours, now)) throw new BackendError("station_closed");
    const view = this.views(state, [station])[0];
    const held = countHolding(state.reservations, stationId, now);
    const target = wanted || null;
    let picked: Pick<Reservation, "target" | "targetLabel" | "targetKind"> = { target: null, targetLabel: null, targetKind: null };
    if (kind === "swap") {
      if (!offersSwap(station.kind) || !serviceActive(state, stationId, "swap")) throw new BackendError("service_not_offered");
      const types = view.batteryTypes ?? [];
      if (types.length) {
        if (!target && types.length > 1) throw new BackendError("battery_type_required");
        const type = target ? types.find((t) => t.id === target) : types[0];
        if (!type || !type.isActive || freeOfType(type) <= 0) throw new BackendError("battery_type_unavailable");
        picked = { target: type.id, targetLabel: `${type.brand} ${type.name}`, targetKind: "battery_type" };
      } else {
        if (target) throw new BackendError("battery_type_unavailable");
        if (status.fullBatteries - held.batteries <= 0) throw new BackendError("none_available");
      }
    } else if (target) {
      const point = (view.chargingPoints ?? []).find((p) => p.id === target && p.deviceId);
      const ev = point ? null : (view.evChargers ?? []).find((x) => x.id === target);
      if (!point && !ev) throw new BackendError("unknown", "not_found");
      if (point) {
        if (!offersCharging(station.kind) || !serviceActive(state, stationId, "charging")) throw new BackendError("service_not_offered");
        const freePoints = (view.chargingPoints ?? []).filter((p) => p.deviceId && p.status === "free").length;
        if (point.status !== "free" || point.reserved || freePoints - held.slots <= 0) throw new BackendError("outlet_busy");
        picked = { target: point.id, targetLabel: point.label, targetKind: "outlet" };
      } else {
        if (!serviceActive(state, stationId, "ev")) throw new BackendError("service_not_offered");
        // A connected charger is held only while its outlet is free (as reserve() in worker/api.ts).
        if (ev!.reserved || (ev!.point && ev!.point.status !== "free")) throw new BackendError("outlet_busy");
        picked = { target: ev!.id, targetLabel: ev!.name, targetKind: "ev" };
      }
    } else {
      if (!offersCharging(station.kind) || !serviceActive(state, stationId, "charging")) throw new BackendError("service_not_offered");
      if ((view.chargingPoints ?? []).some((p) => p.deviceId)) throw new BackendError("outlet_required");
      const places = state.reservations.filter((r) => r.stationId === stationId && isHolding(r, now) && reservationKind(r) === "charging_point" && !r.target).length;
      if (status.freeSlots - places <= 0) throw new BackendError("none_available");
      picked = { target: null, targetLabel: null, targetKind: "place" };
    }
    const type = typeOfKind(kind);
    const reservation: Reservation = {
      id: crypto.randomUUID(),
      userId: profile.id,
      stationId,
      type,
      kind,
      ...picked,
      status: "active",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + RESERVATION_MINUTES * 60_000).toISOString(),
      pickupCode: pickupCode(),
    };
    this.save(
      withAudit(
        { ...state, reservations: [...state.reservations, reservation] },
        {
          table: "reservations",
          action: "insert",
          rowId: reservation.id,
          stationId,
          userId: profile.id,
          changes: { type, kind, target: picked.target, status: "active", station_id: stationId },
        },
      ),
    );
    return reservation;
  }

  /**
   * As checkPickupCode() in worker/reservations.ts: 5 wrong codes within 15 minutes lock
   * the reservation. A wrong code is saved, then refused.
   */
  private checkPickupCode(state: DemoState, r: Reservation, raw: unknown) {
    const since = Date.now() - RESERVATION_CODE_LOCK_MINUTES * 60_000;
    const failures = (state.reservationCodeFailures ?? []).filter((f) => f.reservationId === r.id && Date.parse(f.at) > since);
    if (failures.length >= RESERVATION_MAX_CODE_FAILURES) throw new BackendError("code_locked");
    if (String(raw ?? "").trim() === r.pickupCode) return;
    const dayAgo = Date.now() - 86_400_000;
    this.save({
      ...state,
      reservationCodeFailures: [...(state.reservationCodeFailures ?? []).filter((f) => Date.parse(f.at) > dayAgo), { reservationId: r.id, at: new Date().toISOString() }],
    });
    throw new BackendError("wrong_pickup_code");
  }

  async cancelReservation(id: string) {
    this.setReservationStatus(id, "cancelled");
  }

  async staffStations() {
    const state = this.load();
    const profile = this.requireProfile(state);
    // Menu and rights follow the role, like on Cloudflare: station work is for staff, owners and admins (R2).
    if (profile.role !== "operator" && profile.role !== "admin") throw new BackendError("forbidden");
    const owned = new Set(profile.ownerOf ?? []);
    // Staff their one station, owners their operators' stations; admins see all.
    const active = this.activeStations(state);
    const stations = profile.role === "admin" ? active : active.filter((s) => this.roleAt(state, profile, s.id) !== null);
    // With the services active there and the person's role, as staffStations() in worker/api.ts.
    return this.views(state, stations).map((s) => ({
      ...s,
      activeServices: STATION_SERVICES.filter((service) => serviceActive(state, s.id, service)),
      greenCredit: this.isDemoCreditStation(state, s.id),
      myRole: profile.role === "admin" ? ("admin" as const) : owned.has(s.operatorId) ? ("owner" as const) : ("staff" as const),
    }));
  }

  async updateStatus(stationId: string, patch: StatusPatch) {
    const state = this.load();
    this.stationActor(state, stationId);
    // Full batteries change only through counter events, as in worker/api.ts.
    const raw = patch as StatusPatch & { fullBatteries?: unknown; typeBatteries?: unknown };
    if (raw.fullBatteries !== undefined || raw.typeBatteries !== undefined) throw new BackendError("unknown", "bad_request");
    const closing = patch.isOpen === false && state.statuses.some((s) => s.stationId === stationId && s.isOpen);
    // Closing cancels the reservations still holding (R17, as updateStatus() in worker/api.ts);
    // those already past their expiry become expired.
    const now = new Date();
    let cancelled = 0;
    const reservations = closing
      ? state.reservations.map((r) => {
          if (r.stationId !== stationId || r.status !== "active") return r;
          if (!isHolding(r, now)) return { ...r, status: "expired" as const };
          cancelled++;
          return { ...r, status: "cancelled" as const, cancelReason: "station_closed" };
        })
      : state.reservations;
    const statuses = state.statuses.map((s) =>
      s.stationId === stationId
        ? {
            ...s,
            isOpen: patch.isOpen ?? s.isOpen,
            freeSlots: Math.max(0, patch.freeSlots ?? s.freeSlots),
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
    return { cancelled };
  }

  async stationReservations(stationId: string) {
    // Staff never see the pickup code; the customer shows it.
    return this.load()
      .reservations.filter((r) => r.stationId === stationId)
      .map((r) => ({ ...r, pickupCode: undefined, customer: this.customerLabel(r.userId) }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** As completeReservation() in worker/api.ts: charging reservations only; a swap reservation is completed by its swap. */
  async completeReservation(id: string, code: string) {
    const state = this.load();
    const profile = this.requireProfile(state);
    const r = state.reservations.find((x) => x.id === id);
    if (!r) throw new BackendError("forbidden");
    this.stationActor(state, r.stationId);
    if (r.userId === profile.id) throw new BackendError("own_reservation");
    if (reservationKind(r) === "swap") throw new BackendError("swap_required");
    if (!isHolding(r)) throw new BackendError("reservation_not_active");
    this.checkPickupCode(state, r, code);
    // A counted place comes off the free places; connected outlets and car chargers have no such count.
    const place = !r.target;
    const statuses = place
      ? state.statuses.map((s) => (s.stationId === r.stationId ? { ...s, freeSlots: Math.max(0, s.freeSlots - 1), updatedAt: new Date().toISOString() } : s))
      : state.statuses;
    this.save({
      ...this.earn(state, { userId: r.userId, type: r.type, stationId: r.stationId, reservationId: r.id }),
      statuses,
      reservations: state.reservations.map((x) => (x.id === id ? { ...x, status: "completed" as const } : x)),
    });
  }

  /** Name, else masked phone or e-mail of an account (as staff see customers). */
  private customerLabel(userId: string): string | null {
    const state = this.load();
    const user = (state.users ?? demoUsers(new Date())).find((u) => u.id === userId) ?? (state.profile?.id === userId ? state.profile : null);
    return user ? personLabel(user) : null;
  }

  // Station work (src/lib/station-work.ts), as worker/station-work.ts ------------------

  /** The person's role at the station, or null without rights there (as roleAtStation() in the Worker). */
  private roleAt(state: DemoState, profile: Profile, stationId: string): StationRole | null {
    if (profile.role === "admin") return "admin";
    if (profile.role !== "operator") return null;
    const station = state.stations.find((s) => s.id === stationId);
    if (!station) return null;
    if (ownedOperators(state, profile.id).includes(station.operatorId)) return "owner";
    // Staff work at exactly one station (W2, station_staff).
    return (state.staff ?? DEMO_STAFF).some((a) => a.userId === profile.id && a.stationId === stationId) ? "staff" : null;
  }

  /** As stationActor(): 403 without rights, 409 without the matching active station (staff with one station need none). */
  private stationActor(state: DemoState, stationId: string): { profile: Profile; role: StationRole } {
    const profile = this.requireProfile(state);
    const role = this.roleAt(state, profile, stationId);
    if (!role) throw new BackendError("forbidden");
    if (!this.activeStations(state).some((s) => s.id === stationId)) throw new BackendError("station_not_found");
    const active = getActiveStation();
    // Staff have one station (W2): without a chosen station they act at theirs.
    if (active !== stationId && !(role === "staff" && active === null)) throw new BackendError("active_station_required");
    this.pendingAction = { stationId, personId: profile.id, role, at: Date.now() };
    return { profile, role };
  }

  private stationReader(state: DemoState, stationId: string): { profile: Profile; role: StationRole } {
    const profile = this.requireProfile(state);
    const role = this.roleAt(state, profile, stationId);
    if (!role) throw new BackendError("forbidden");
    return { profile, role };
  }

  /** The station's battery types (id, label) and the full batteries of each, or one "" counter without types. */
  private counterRows(state: DemoState, stationId: string): CounterRow[] {
    const status = state.statuses.find((s) => s.stationId === stationId);
    const empty = state.batteryEmpty?.[stationId] ?? {};
    const view = this.views(state, state.stations.filter((s) => s.id === stationId))[0];
    const types = view?.batteryTypes ?? [];
    if (!types.length) return [{ batteryTypeId: "", label: null, full: status?.fullBatteries ?? 0, empty: empty[""] ?? 0 }];
    return types.map((t) => ({ batteryTypeId: t.id, label: `${t.brand} ${t.name}`, full: t.fullBatteries, empty: empty[t.id] ?? 0 }));
  }

  private counterKey(state: DemoState, stationId: string, raw: CounterKey | null | undefined): CounterKey {
    const rows = this.counterRows(state, stationId);
    const wanted = raw ?? "";
    if (rows.length === 1 && rows[0].batteryTypeId === "") {
      if (wanted !== "") throw new BackendError("unknown", "bad_request");
      return "";
    }
    if (wanted === "") {
      if (rows.length === 1) return rows[0].batteryTypeId;
      throw new BackendError("battery_type_required");
    }
    if (!rows.some((r) => r.batteryTypeId === wanted)) throw new BackendError("unknown", "bad_request");
    return wanted;
  }

  /** One counter event on the state, or null when refused (as eventStatements() in the Worker). */
  private counterEvent(
    state: DemoState,
    e: { stationId: string; key: CounterKey; type: BatteryEventType; delta: number; reason: string | null; requestId: string; swapId: string | null; actor: { profile: Profile; role: StationRole } },
  ): { state: DemoState; event: BatteryEventView } | null {
    const rows = this.counterRows(state, e.stationId);
    const row = rows.find((r) => r.batteryTypeId === e.key)!;
    const station = state.stations.find((s) => s.id === e.stationId)!;
    const total = rows.reduce((n, r) => n + r.full, 0);
    const after = applyBatteryEvent(row, e.type, e.delta, { total, capacity: station.batteryCapacity });
    if (!after) return null;
    const now = new Date().toISOString();
    const event = {
      id: crypto.randomUUID(),
      type: e.type,
      batteryTypeId: e.key,
      delta: e.delta,
      fullAfter: after.full,
      emptyAfter: after.empty,
      reason: e.reason,
      swapId: e.swapId,
      person: personLabel(e.actor.profile),
      role: e.actor.role,
      createdAt: now,
    };
    const newTotal = total - row.full + after.full;
    const counts = e.key ? { ...typeCounts(state, e.stationId, total), [e.key]: after.full } : null;
    return {
      event,
      state: {
        ...state,
        batteryEvents: [{ ...event, requestId: e.requestId, stationId: e.stationId, personId: e.actor.profile.id }, ...(state.batteryEvents ?? [])].slice(0, 1000),
        batteryEmpty: { ...state.batteryEmpty, [e.stationId]: { ...state.batteryEmpty?.[e.stationId], [e.key]: after.empty } },
        typeBatteries: counts ? { ...state.typeBatteries, [e.stationId]: counts } : state.typeBatteries,
        statuses: state.statuses.map((s) => (s.stationId === e.stationId ? { ...s, fullBatteries: newTotal, updatedAt: now } : s)),
      },
    };
  }

  private requireSwapService(state: DemoState, stationId: string) {
    if (!serviceActive(state, stationId, "swap")) throw new BackendError("service_not_offered");
  }

  async stationCounter(stationId: string): Promise<StationCounter> {
    const state = this.load();
    const { profile, role } = this.stationReader(state, stationId);
    this.requireSwapService(state, stationId);
    const station = state.stations.find((s) => s.id === stationId);
    if (!station) throw new BackendError("station_not_found");
    const today = dayStartLome();
    return {
      stationId,
      capacity: station.batteryCapacity,
      rows: this.counterRows(state, stationId),
      events: (state.batteryEvents ?? [])
        .filter((e) => e.stationId === stationId && e.createdAt >= today && (role !== "staff" || e.personId === profile.id))
        .slice(0, 50)
        .map(eventView),
      canCorrect: role !== "staff",
      priceXof: swapPrice(state, station),
    };
  }

  async batteryEvent(stationId: string, input: BatteryEventInput): Promise<BatteryEventView> {
    const state = this.load();
    const actor = this.stationActor(state, stationId);
    this.requireSwapService(state, stationId);
    if (!input || !validRequestId(input.requestId)) throw new BackendError("unknown", "bad_request");
    if (input.type !== "issue" && input.type !== "full" && input.type !== "correction") throw new BackendError("unknown", "bad_request");
    let delta = input.type === "issue" ? -1 : 1;
    let reason: string | null = null;
    if (input.type === "correction") {
      if (actor.role === "staff") throw new BackendError("forbidden");
      if (!validCorrection(input.delta)) throw new BackendError("unknown", "bad_request");
      reason = cleanReason(input.reason);
      if (!reason) throw new BackendError("reason_required");
      delta = input.delta;
    }
    const seen = (state.batteryEvents ?? []).find((e) => e.requestId === input.requestId);
    if (seen) {
      if (seen.stationId !== stationId) throw new BackendError("request_conflict");
      return eventView(seen);
    }
    const key = this.counterKey(state, stationId, input.batteryTypeId);
    const done = this.counterEvent(state, { stationId, key, type: input.type, delta, reason, requestId: input.requestId, swapId: null, actor });
    if (!done) throw new BackendError(input.type === "full" ? "counter_full" : "no_full_battery");
    this.save(done.state);
    return done.event;
  }

  async recordSwap(stationId: string, input: SwapInput): Promise<SwapEntry> {
    return this.swapAt(this.load(), stationId, input);
  }

  /** As recordSwap() in the Worker: from a reservation, the customer and type come from it and the swap completes it. */
  private async swapAt(state: DemoState, stationId: string, input: SwapInput): Promise<SwapEntry> {
    const actor = this.stationActor(state, stationId);
    this.requireSwapService(state, stationId);
    if (!input || !validRequestId(input.requestId) || !isSwapCustomerType(input.customerType)) throw new BackendError("unknown", "bad_request");
    const seen = (state.swaps ?? []).find((x) => x.requestId === input.requestId);
    if (seen) {
      if (seen.stationId !== stationId) throw new BackendError("request_conflict");
      return swapView(seen);
    }
    const type = input.customerType;
    const station = state.stations.find((s) => s.id === stationId)!;
    const features = demoFeatures(state);
    const batteryIn = takesBatteryIn(type) ? cleanBatteryLabel(input.batteryIn) : null;
    const batteryOut = cleanBatteryLabel(input.batteryOut);
    if (batteryIn === undefined || batteryOut === undefined) throw new BackendError("unknown", "bad_request");
    if (batteryIn && batteryOut && batteryIn === batteryOut) throw new BackendError("same_battery");
    const users = state.users ?? demoUsers(new Date());
    const findCustomer = (raw: string | null | undefined) => {
      const user = this.findWalletUser(state, contactFromCode(String(raw ?? "")));
      if (user.id === actor.profile.id) throw new BackendError("own_reservation");
      if (user.role !== "customer") throw new BackendError("not_a_customer");
      return user;
    };

    let customer: AdminUser | null = null;
    let reservation: Reservation | null = null;
    let driver: { driverId: string; managerId: string; label: string } | null = null;
    if (input.reservationId) {
      if (type !== "app") throw new BackendError("unknown", "bad_request");
      reservation = state.reservations.find((r) => r.id === input.reservationId) ?? null;
      if (!reservation || reservation.stationId !== stationId || reservationKind(reservation) !== "swap") throw new BackendError("forbidden");
      if (reservation.userId === actor.profile.id) throw new BackendError("own_reservation");
      if (!isHolding(reservation)) throw new BackendError("reservation_not_active");
      this.checkPickupCode(state, reservation, input.pickupCode);
      if (reservation.target) {
        const given = input.batteryTypeId === undefined || input.batteryTypeId === null || input.batteryTypeId === "" ? null : String(input.batteryTypeId);
        if (given !== null && given !== reservation.target) throw new BackendError("battery_type_mismatch");
        input = { ...input, batteryTypeId: reservation.target };
      }
      const userId = reservation.userId;
      customer = users.find((u) => u.id === userId) ?? null;
    } else if (type === "app" && input.payment !== "cash") {
      // Paid from Green Credit: the customer's counter code, shown after the PIN on their phone (0047).
      const user = this.creditCodeOwner(state, String(input.creditCode ?? input.contact ?? ""));
      if (user.id === actor.profile.id) throw new BackendError("own_reservation");
      if (user.role !== "customer") throw new BackendError("not_a_customer");
      customer = user;
    } else if (type === "app") {
      customer = findCustomer(input.contact);
    } else if (type === "first_purchase" && input.contact) {
      customer = findCustomer(input.contact);
    } else if (type === "fleet") {
      if (features.lite) throw new BackendError("cash_only");
      // R10: the signed pass from the driver page, not the bare code (findFleetDriver in worker/station-work.ts).
      const pass = await checkDriverPass(DEMO_PASS_SECRET, String(input.driverCode ?? ""));
      if (!pass.ok) throw new BackendError(pass.error);
      const d = (state.drivers ?? []).find((x) => x.code === pass.code);
      if (!this.drives(state, d)) throw new BackendError("driver_not_found");
      const link = (state.fleetLinks ?? []).find((l) => l.driverId === d.userId);
      if (!link || fleetTag(link.managerId) !== pass.fleet) throw new BackendError("wrong_fleet");
      if (d.userId === actor.profile.id) throw new BackendError("own_reservation");
      driver = { driverId: d.userId, managerId: link.managerId, label: personLabel({ fullName: d.fullName, phone: d.phone, email: null }) };
    }

    const key = this.counterKey(state, stationId, input.batteryTypeId);
    // Battery register: at a station with battery types every swap names its batteries.
    if (batteryNumbersRequired(key !== "") && (!batteryOut || (takesBatteryIn(type) && !batteryIn))) throw new BackendError("battery_number_required");
    const batteryType = key ? ((state.batteryTypes ?? DEMO_BATTERY_TYPES).find((t) => t.id === key) ?? null) : null;
    const register = this.batteryRegister(state);
    const batteriesOf: { out: DemoSwapBattery | null; in: DemoSwapBattery | null } = {
      out: batteryOut ? resolveDemoBattery(register.batteries, batteryOut, batteryType) : null,
      in: batteryIn ? resolveDemoBattery(register.batteries, batteryIn, batteryType) : null,
    };
    const swapOwner = swapOwnerOf(station.isOwn, state.stationCash?.[station.id]?.swapOwner);
    let payment: SwapPayment;
    let amount: number;
    const price = swapPrice(state, station);
    if (type === "fleet") {
      payment = "fleet";
      amount = price ?? 0;
    } else if (type === "app" && input.payment !== "cash") {
      if (swapOwner !== "poinderecharge") throw new BackendError("payment_not_offered");
      if (!this.isDemoCreditStation(state, stationId)) throw new BackendError("credit_not_accepted");
      payment = "wallet";
      if (!price) throw new BackendError("swap_price_missing");
      amount = price;
    } else {
      payment = "cash";
      if (type === "first_purchase") {
        const raw = input.amountXof ?? 0;
        if (!validAmount(raw)) throw new BackendError("invalid_amount");
        amount = raw;
      } else {
        if (!price) throw new BackendError("swap_price_missing");
        amount = price;
      }
    }

    if (!reservation) {
      // Full batteries held by active reservations are not for a swap without one.
      const full = this.counterRows(state, stationId).find((r) => r.batteryTypeId === key)?.full ?? 0;
      const held = state.reservations.filter((r) => r.stationId === stationId && isHolding(r) && reservationKind(r) === "swap" && (r.target ?? "") === key).length;
      if (full > 0 && full - held <= 0) throw new BackendError("battery_reserved");
    }
    const swapId = crypto.randomUUID();
    const out = this.counterEvent(state, { stationId, key, type: "issue", delta: -1, reason: null, requestId: `${input.requestId}:out`, swapId, actor });
    if (!out) throw new BackendError("no_full_battery");
    let next = out.state;
    if (takesBatteryIn(type)) {
      next = this.counterEvent(next, { stationId, key, type: "empty_in", delta: 1, reason: null, requestId: `${input.requestId}:in`, swapId, actor })!.state;
    }
    if (payment === "wallet" && customer) {
      const w = this.wallet(next);
      if (!features.wallet || !w.enabled) throw new BackendError("wallet_disabled");
      // The code the customer's app showed after their PIN; used once, with the swap.
      const code = String(input.creditCode ?? (reservation ? "" : (input.contact ?? "")));
      if (this.creditCodeOwner(state, code).id !== customer.id) throw new BackendError("credit_code_invalid");
      if (w.frozen.includes(customer.id)) throw new BackendError("wallet_frozen");
      const before = this.balance(w, customer.id);
      if (before < amount) throw new BackendError("insufficient_balance");
      const tx: DemoWallet["transactions"][number] = {
        id: crypto.randomUUID(),
        trxId: newTrxId("charge"),
        type: "charge",
        attribute: "send",
        status: "success",
        amountXof: amount,
        feeXof: 0,
        totalXof: amount,
        balanceAfterXof: before - amount,
        counterparty: station.name,
        remark: "Échange de batterie",
        createdAt: new Date().toISOString(),
        userId: customer.id,
        userLabel: [customer.fullName, customer.phone ?? customer.email].filter(Boolean).join(" · "),
        adminId: null,
        key: `swap:${input.requestId}`,
      };
      next = { ...next, wallet: { ...this.useCreditCode(w, code), balances: { ...w.balances, [customer.id]: before - amount }, transactions: [tx, ...w.transactions] } };
    }
    const typeLabel = this.counterRows(state, stationId).find((r) => r.batteryTypeId === key)?.label ?? null;
    const entry: SwapEntry = {
      id: swapId,
      stationId,
      batteryTypeId: key,
      batteryTypeLabel: typeLabel,
      batteryIn,
      batteryOut,
      customerType: type,
      customer: customer ? personLabel(customer) : null,
      driver: driver?.label ?? null,
      payment,
      amountXof: amount,
      reservationId: reservation?.id ?? null,
      person: personLabel(actor.profile),
      role: actor.role,
      createdAt: new Date().toISOString(),
    };
    let reg = register;
    for (const direction of ["out", "in"] as const) {
      const battery = batteriesOf[direction];
      if (!battery) continue;
      reg = applyDemoSwapBattery(reg, {
        battery,
        direction,
        typeId: batteryType?.id ?? null,
        stationId,
        swapId,
        holderId: customer?.id ?? driver?.driverId ?? null,
        personId: actor.profile.id,
        role: actor.role,
        payment,
        amountXof: amount,
        now: entry.createdAt,
      });
    }
    next = { ...next, batteries: reg.batteries, batteryHistory: reg.history };
    next = { ...next, swaps: [{ ...entry, requestId: input.requestId, staffId: actor.profile.id, customerId: customer?.id ?? null, driverId: driver?.driverId ?? null, fleetManagerId: driver?.managerId ?? null, owner: swapOwner }, ...(next.swaps ?? [])].slice(0, 1000) };
    if (reservation) {
      const done = reservation.id;
      next = { ...next, reservations: next.reservations.map((x) => (x.id === done ? { ...x, status: "completed" as const } : x)) };
    }
    if (customer && (type === "app" || type === "first_purchase")) {
      next = this.earn(next, { userId: customer.id, type: "battery", stationId, reservationId: reservation?.id ?? null });
    }
    this.save(next);
    return entry;
  }

  async stationSwaps(stationId: string, filter: SwapFilter = {}): Promise<SwapEntry[]> {
    const state = this.load();
    const { profile, role } = this.stationReader(state, stationId);
    // Staff see today's own swaps; owners and admins may look back (backoffice, plan phase 8).
    const since = role === "staff" ? dayStartLome() : periodStart(reportPeriod(filter.days ?? 1));
    return (state.swaps ?? [])
      .filter(
        (x) =>
          x.stationId === stationId &&
          x.createdAt >= since &&
          (!filter.customerType || x.customerType === filter.customerType) &&
          (role !== "staff" || x.staffId === profile.id),
      )
      .slice(0, 500)
      .map(swapView);
  }

  /** Counter history of a report period: owners and admins only (stationBatteryEvents in the Worker). */
  async stationBatteryEvents(stationId: string, days: ReportPeriod): Promise<BatteryEventView[]> {
    const state = this.load();
    const { role } = this.stationReader(state, stationId);
    if (role === "staff") throw new BackendError("forbidden");
    const since = periodStart(reportPeriod(days));
    return (state.batteryEvents ?? [])
      .filter((e) => e.stationId === stationId && e.createdAt >= since)
      .slice(0, 500)
      .map(eventView);
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
    // Days and times, never empty (src/lib/opening-hours.ts), as in worker/api.ts.
    const openingHours = cleanOpeningHours(fields.openingHours);
    if (!openingHours) throw new BackendError("opening_hours_invalid");
    const station: Station = {
      ...fields,
      openingHours,
      // Left out: unchanged, as in the Worker.
      isSolar: fields.isSolar ?? (id ? !!state.stations.find((s) => s.id === id)?.isSolar : false),
      id: id ?? crypto.randomUUID(),
      operatorName: operator.name,
      isOwn: operator.isOwn,
      // Left out of the input: unchanged.
      photos: input.photos ? cleanPhotos(input.photos) : (before?.photos ?? extras?.photos ?? []),
      amenities: input.amenities ? cleanAmenities(input.amenities) : (before?.amenities ?? extras?.amenities ?? []),
      mainActivity: input.mainActivity !== undefined ? cleanMainActivity(input.mainActivity) : (before?.mainActivity ?? null),
    };
    if (id) {
      let next = withAudit(
        { ...state, stations: state.stations.map((s) => (s.id === id ? station : s)) },
        { table: "stations", action: "update", rowId: id, stationId: id, changes: before ? diff(before, station) : {} },
      );
      // A lower capacity brings the full batteries down to it, as counter corrections (capacityTrimStatements).
      if (before && station.batteryCapacity < before.batteryCapacity) next = this.trimToCapacity(next, id, station.batteryCapacity);
      this.save(next);
    } else {
      // A new station starts closed and empty: staff open it and mark batteries full as they come.
      const status: StationStatus = {
        stationId: station.id,
        isOpen: false,
        freeSlots: 0,
        fullBatteries: 0,
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

  /** As capacityTrimStatements() in worker/station-work.ts: one correction per counter, largest first. */
  private trimToCapacity(state: DemoState, stationId: string, capacity: number): DemoState {
    const profile = this.requireProfile(state);
    const rows = this.counterRows(state, stationId).map((r) => ({ key: r.batteryTypeId, full: r.full }));
    let excess = rows.reduce((a, r) => a + r.full, 0) - capacity;
    const trim = new Map<string, number>();
    while (excess > 0) {
      const top = rows.reduce((a, r) => (r.full > a.full ? r : a));
      if (top.full <= 0) break;
      top.full--;
      trim.set(top.key, (trim.get(top.key) ?? 0) + 1);
      excess--;
    }
    let next = state;
    for (const [key, n] of trim) {
      const done = this.counterEvent(next, {
        stationId,
        key,
        type: "correction",
        delta: -n,
        reason: CAPACITY_REASON,
        requestId: `capacity-${crypto.randomUUID()}`,
        swapId: null,
        actor: { profile, role: "admin" },
      });
      if (done) next = done.state;
    }
    return next;
  }

  async listBatteryTypes() {
    const state = this.load();
    this.requireAdmin(state);
    return [...(state.batteryTypes ?? DEMO_BATTERY_TYPES)].sort((a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name));
  }

  // Battery register (worker/batteries.ts) ------------------------------------------

  private batteryRegister(state: DemoState): { batteries: DemoBattery[]; history: DemoBatteryEvent[] } {
    if (state.batteries) return { batteries: state.batteries, history: state.batteryHistory ?? [] };
    return seedDemoBatteries(new Date(), state.batteryTypes ?? DEMO_BATTERY_TYPES);
  }

  /** Admins see all; an owner the stations of their operators (null = all). */
  private batteryViewer(state: DemoState): { admin: boolean; own: Set<string> | null } {
    const profile = this.requireProfile(state);
    if (profile.role === "admin") return { admin: true, own: null };
    const owned = profile.role === "operator" ? ownedOperators(state, profile.id) : [];
    if (!owned.length) throw new BackendError("forbidden");
    return { admin: false, own: new Set(state.stations.filter((s) => owned.includes(s.operatorId)).map((s) => s.id)) };
  }

  private batteryView(state: DemoState, b: DemoBattery, history: DemoBatteryEvent[], own: Set<string> | null): BatteryView {
    const users = state.users ?? demoUsers(new Date());
    const type = (state.batteryTypes ?? DEMO_BATTERY_TYPES).find((t) => t.id === b.batteryTypeId);
    const mine = history.filter((h) => h.batteryId === b.id);
    const lastOut = mine.filter((h) => h.type === "out").sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];
    const holder = users.find((u) => u.id === b.holderId);
    const holderShown = b.location === "customer" && (!own || (lastOut?.stationId != null && own.has(lastOut.stationId)));
    return {
      id: b.id,
      serial: b.serial,
      brand: b.brand,
      batteryTypeId: b.batteryTypeId,
      typeLabel: type ? `${type.brand} ${type.name}` : null,
      status: b.status,
      source: b.source,
      location: b.location,
      stationId: b.stationId,
      stationName: state.stations.find((s) => s.id === b.stationId)?.name ?? null,
      holder: holderShown && holder ? personLabel(holder) : null,
      swaps: mine.filter((h) => h.type === "out" || h.type === "in").length,
      lastSwapAt: b.lastSwapAt,
      createdAt: b.createdAt,
    };
  }

  async listBatteries(filter: BatteryFilter = {}): Promise<BatteryList> {
    const state = this.load();
    const { admin, own } = this.batteryViewer(state);
    if (filter.stationId && own && !own.has(filter.stationId)) throw new BackendError("forbidden");
    const { batteries, history } = this.batteryRegister(state);
    const passed = (b: DemoBattery, stations: (id: string) => boolean) => history.some((h) => h.batteryId === b.id && h.stationId !== null && stations(h.stationId));
    const scoped = own ? batteries.filter((b) => passed(b, (id) => own.has(id))) : batteries;
    const q = String(filter.q ?? "").trim().toUpperCase();
    const shown = scoped
      .filter(
        (b) =>
          (filter.brand === undefined || filter.brand === null || b.brand === filter.brand) &&
          (!q || b.serial.includes(q)) &&
          (!isBatteryStatus(filter.status) || b.status === filter.status) &&
          (!filter.stationId || passed(b, (id) => id === filter.stationId)),
      )
      .sort((x, y) => (y.lastSwapAt ?? y.createdAt).localeCompare(x.lastSwapAt ?? x.createdAt) || x.serial.localeCompare(y.serial))
      .slice(0, BATTERY_LIST_MAX);
    const counts = new Map<string, number>((state.batteryTypes ?? DEMO_BATTERY_TYPES).map((t) => [t.brand, 0]));
    for (const b of scoped) counts.set(b.brand, (counts.get(b.brand) ?? 0) + 1);
    return {
      brands: sortBrands([...counts].map(([brand, count]) => ({ brand, count }))),
      batteries: shown.map((b) => this.batteryView(state, b, history, own)),
      canEdit: admin,
    };
  }

  async batteryDetail(id: string): Promise<BatteryDetail> {
    const state = this.load();
    const { own } = this.batteryViewer(state);
    const { batteries, history } = this.batteryRegister(state);
    const battery = batteries.find((b) => b.id === id);
    const mine = history.filter((h) => h.batteryId === id).map((h, i) => ({ h, i })).sort((x, y) => y.h.createdAt.localeCompare(x.h.createdAt) || y.i - x.i).map((x) => x.h);
    if (!battery || (own && !mine.some((h) => h.stationId && own.has(h.stationId)))) throw new BackendError("unknown", "not_found");
    const users = state.users ?? demoUsers(new Date());
    const who = (userId: string | null) => {
      const u = users.find((x) => x.id === userId);
      return u ? personLabel(u) : null;
    };
    const entries: BatteryHistoryEntry[] = mine.map((h) => {
      const hidden = own !== null && h.stationId !== null && !own.has(h.stationId);
      return {
        id: h.id,
        type: h.type,
        stationId: h.stationId,
        stationName: state.stations.find((s) => s.id === h.stationId)?.name ?? null,
        swapId: h.swapId,
        holder: hidden ? null : who(h.holderId),
        payment: hidden ? null : h.payment,
        amountXof: hidden ? null : h.amountXof,
        status: h.status,
        reason: h.reason,
        person: hidden ? "" : (who(h.personId) ?? ""),
        role: h.role,
        createdAt: h.createdAt,
      };
    });
    return { ...this.batteryView(state, battery, history, own), history: entries };
  }

  async registerBatteries(input: RegisterBatteriesInput): Promise<RegisterBatteriesResult> {
    const state = this.load();
    this.requireAdmin(state);
    const profile = this.requireProfile(state);
    const type = (state.batteryTypes ?? DEMO_BATTERY_TYPES).find((t) => t.id === input?.batteryTypeId);
    if (!type || !Array.isArray(input?.serials)) throw new BackendError("unknown", "bad_request");
    const serials: string[] = [];
    const invalid: string[] = [];
    for (const raw of input.serials) {
      const clean = cleanBatteryLabel(raw);
      if (!clean) invalid.push(String(raw ?? ""));
      else if (!serials.includes(clean)) serials.push(clean);
    }
    if (serials.length > REGISTER_MAX) throw new BackendError("unknown", "bad_request");
    let { batteries, history } = this.batteryRegister(state);
    const existing: string[] = [];
    const now = new Date().toISOString();
    for (const serial of serials) {
      if (batteries.some((b) => b.serial === serial && b.brand === type.brand)) {
        existing.push(serial);
        continue;
      }
      const loose = batteries.find((b) => b.serial === serial && b.brand === "");
      let id = loose?.id;
      if (loose) {
        batteries = batteries.map((b) => (b.id === loose.id ? { ...b, brand: type.brand, batteryTypeId: type.id } : b));
      } else {
        id = crypto.randomUUID();
        batteries = [
          ...batteries,
          { id, serial, brand: type.brand, batteryTypeId: type.id, status: "in_service", source: "registered", location: "unknown", stationId: null, holderId: null, lastSwapAt: null, createdAt: now },
        ];
      }
      history = [
        ...history,
        { id: crypto.randomUUID(), batteryId: id!, type: "registered", stationId: null, swapId: null, holderId: null, status: null, reason: null, personId: profile.id, role: "admin", createdAt: now, payment: null, amountXof: null },
      ];
    }
    this.save({ ...state, batteries, batteryHistory: history });
    return { added: serials.length - existing.length, existing, invalid };
  }

  async setBatteryStatus(id: string, input: BatteryStatusInput): Promise<void> {
    const state = this.load();
    this.requireAdmin(state);
    const profile = this.requireProfile(state);
    const reason = cleanStatusReason(input?.reason);
    if (!isBatteryStatus(input?.status) || reason === undefined) throw new BackendError("unknown", "bad_request");
    const { batteries, history } = this.batteryRegister(state);
    if (!batteries.some((b) => b.id === id)) throw new BackendError("unknown", "not_found");
    this.save({
      ...state,
      batteries: batteries.map((b) => (b.id === id ? { ...b, status: input.status } : b)),
      batteryHistory: [
        ...history,
        { id: crypto.randomUUID(), batteryId: id, type: "status", stationId: null, swapId: null, holderId: null, status: input.status, reason, personId: profile.id, role: "admin", createdAt: new Date().toISOString(), payment: null, amountXof: null },
      ],
    });
  }

  async lookupBattery(stationId: string, serial: string, batteryTypeId: string | null): Promise<BatteryLookup> {
    const state = this.load();
    this.stationReader(state, stationId);
    const clean = cleanBatteryLabel(serial);
    if (!clean) throw new BackendError("unknown", "bad_request");
    const type = batteryTypeId ? ((state.batteryTypes ?? DEMO_BATTERY_TYPES).find((t) => t.id === batteryTypeId) ?? null) : null;
    const { batteries } = this.batteryRegister(state);
    try {
      const found = resolveDemoBattery(batteries, clean, type);
      return found.id ? { state: "known", brand: found.adopt ? "" : found.brand, status: found.status } : { state: "new", brand: null, status: null };
    } catch {
      const other = batteries.filter((b) => b.serial === clean).sort((x, y) => x.brand.localeCompare(y.brand))[0];
      return { state: "wrong_brand", brand: other?.brand ?? null, status: other?.status ?? null };
    }
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

  async listEvChargers() {
    const state = this.load();
    this.requireAdmin(state);
    return [...(state.evChargers ?? DEMO_EV_CHARGERS)].sort((a, b) => a.name.localeCompare(b.name));
  }

  async saveEvCharger(id: string | null, input: EvChargerInput) {
    const state = this.load();
    this.requireAdmin(state);
    if (!validEvCharger(input)) throw new BackendError("unknown", "invalid charger");
    if (input.stationId && !state.stations.some((s) => s.id === input.stationId)) throw new BackendError("station_not_found");
    const chargers = state.evChargers ?? DEMO_EV_CHARGERS;
    const pointId = input.pointId || null;
    // As saveEvCharger() in worker/ev-chargers.ts: an outlet of a connected device at the same station, not another charger's.
    if (pointId) {
      const point = (state.devices ?? seedDevices()).flatMap((d) => d.points).find((p) => p.id === pointId && p.deviceId && p.outlet);
      if (!point || point.stationId !== input.stationId) throw new BackendError("unknown", "bad_request");
      if (chargers.some((c) => c.pointId === pointId && c.id !== id)) throw new BackendError("outlet_busy");
    }
    const charger: EvCharger = {
      id: id ?? crypto.randomUUID(),
      name: input.name.trim(),
      connector: input.connector,
      powerKw: Number(input.powerKw),
      stationId: input.stationId || null,
      isActive: input.isActive,
      pointId,
    };
    const before = chargers.find((c) => c.id === id);
    this.save(
      withAudit(
        { ...state, evChargers: before ? chargers.map((c) => (c.id === id ? charger : c)) : [...chargers, charger] },
        {
          table: "ev_chargers",
          action: before ? "update" : "insert",
          rowId: charger.id,
          stationId: charger.stationId ?? before?.stationId ?? null,
          changes: before ? diff(before, charger) : { ...charger },
        },
      ),
    );
  }

  async deleteEvCharger(id: string) {
    const state = this.load();
    this.requireAdmin(state);
    const chargers = state.evChargers ?? DEMO_EV_CHARGERS;
    const before = chargers.find((c) => c.id === id);
    if (!before) return;
    this.save(
      withAudit(
        { ...state, evChargers: chargers.filter((c) => c !== before) },
        { table: "ev_chargers", action: "delete", rowId: id, stationId: before.stationId, changes: { ...before } },
      ),
    );
  }

  async listRepairCenters() {
    return (this.load().repairCenters ?? []).filter((r) => r.isActive).sort((a, b) => a.name.localeCompare(b.name));
  }

  async adminRepairCenters() {
    const state = this.load();
    this.requireAdmin(state);
    return [...(state.repairCenters ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  }

  async saveRepairCenter(id: string | null, input: RepairCenterInput) {
    const state = this.load();
    this.requireAdmin(state);
    const clean = cleanRepairCenter(input);
    if (!clean) throw new BackendError("unknown", "invalid repair centre");
    const centers = state.repairCenters ?? [];
    const before = centers.find((r) => r.id === id);
    const center: RepairCenter = {
      ...clean,
      id: before?.id ?? crypto.randomUUID(),
      operatorName: state.operators.find((o) => o.id === clean.operatorId)?.name ?? null,
    };
    this.save(
      withAudit(
        { ...state, repairCenters: before ? centers.map((r) => (r === before ? center : r)) : [...centers, center] },
        { table: "repair_centers", action: before ? "update" : "insert", rowId: center.id, stationId: null, changes: before ? diff(before, center) : { ...center } },
      ),
    );
  }

  async deleteRepairCenter(id: string) {
    const state = this.load();
    this.requireAdmin(state);
    const centers = state.repairCenters ?? [];
    const before = centers.find((r) => r.id === id);
    if (!before) return;
    this.save(
      withAudit(
        { ...state, repairCenters: centers.filter((r) => r !== before) },
        { table: "repair_centers", action: "delete", rowId: id, stationId: null, changes: { ...before } },
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
    // The dashboard's figures; the reservations table pages through adminReservations().
    const since = Date.now() - SNAPSHOT_RESERVATION_DAYS * 86_400_000;
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

  /** As adminReservations() in worker/api.ts: one page of the last ADMIN_HISTORY_DAYS days, and the total. */
  async adminReservations(query: AdminReservationQuery): Promise<AdminReservationPage> {
    const state = this.load();
    this.requireAdmin(state);
    const now = new Date().toISOString();
    const since = new Date(Date.now() - ADMIN_HISTORY_DAYS * 86_400_000).toISOString();
    const users = state.users ?? demoUsers(new Date());
    const search = (query.search ?? "").trim().toLowerCase().slice(0, 80);
    const matches = state.reservations
      .filter((r) => {
        if (r.createdAt < since) return false;
        if (query.stationId && r.stationId !== query.stationId) return false;
        const expired = r.status === "expired" || (r.status === "active" && r.expiresAt <= now);
        if (query.status === "active" && !(r.status === "active" && r.expiresAt > now)) return false;
        if (query.status === "expired" && !expired) return false;
        if ((query.status === "completed" || query.status === "cancelled") && r.status !== query.status) return false;
        if (search) {
          const u = users.find((x) => x.id === r.userId);
          const hay = [u?.fullName ?? "", u?.phone ?? "", u?.email ?? ""].join(" ").toLowerCase();
          if (!hay.includes(search)) return false;
        }
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const limit = Math.min(Math.max(Number(query.limit) || ADMIN_PAGE_SIZE, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);
    return {
      rows: matches.slice(offset, offset + limit).map((r) => ({ ...r, customer: this.customerLabel(r.userId) })),
      total: matches.length,
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
    // R15: driver accounts change only through the driver review (approve / release).
    if (role === "driver") throw new BackendError("unknown", "bad_request");
    if (before.role === role) return;
    if (before.role === "driver") throw new BackendError("has_other_role");
    // R15: staff become something else only once removed from their station.
    if (role !== "operator" && (state.staff ?? DEMO_STAFF).some((a) => a.userId === userId)) throw new BackendError("role_change_blocked");
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
    // A fleet manager made by an admin gets an approved fleet; leaving the role ends its open invites.
    if (role === "fleet_manager") next = this.withApprovedFleet(next, userId, before.fullName);
    if (before.role === "fleet_manager") {
      const now = new Date().toISOString();
      next = { ...next, fleetInvites: this.invitesOf(next).map((i) => (i.managerId === userId && i.status === "pending" ? { ...i, status: "revoked" as const, decidedAt: now } : i)) };
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

  /** As addStaff() in worker/api.ts: staff work at exactly one station (W2); owners and other roles are refused. */
  private withStaff(state: DemoState, stationId: string, userId: string): DemoState {
    const staff = state.staff ?? DEMO_STAFF;
    const user = (state.users ?? demoUsers(new Date())).find((u) => u.id === userId);
    if (user?.role === "fleet_manager" || user?.role === "driver" || user?.role === "merchant") throw new BackendError("has_other_role");
    if (!user) throw new BackendError("account_not_found");
    const current = staff.find((a) => a.userId === userId);
    if (current?.stationId === stationId) return state;
    if (current) throw new BackendError("staff_other_station");
    if ((state.operatorOwners ?? []).some((o) => o.userId === userId)) throw new BackendError("has_other_role");
    if (user.role === "customer" && this.customerThingsOpen(state, userId, user.phone)) throw new BackendError("role_change_blocked");
    return withAudit(
      {
        ...state,
        staff: [...staff, { stationId, userId }],
        // The role follows the assignment, like on Cloudflare.
        users: promoted(state, userId),
        staffReassignments: this.resolvedReassignments(state, userId, stationId),
      },
      { table: "station_staff", action: "insert", rowId: `${stationId}:${userId}`, stationId, userId, changes: {} },
    );
  }

  private reassignmentsOf(state: DemoState): DemoReassignment[] {
    return state.staffReassignments ?? demoReassignments(new Date());
  }

  /** Open entries of the re-staff list for this person at this station are done. */
  private resolvedReassignments(state: DemoState, userId: string, stationId: string): DemoReassignment[] {
    const now = new Date().toISOString();
    return this.reassignmentsOf(state).map((r) => (r.userId === userId && r.stationId === stationId && !r.resolvedAt ? { ...r, resolvedAt: now } : r));
  }

  /** An owner of some operator, or an admin (requireAnyOwner in worker/api.ts). */
  private requireAnyOwner(state: DemoState): Profile {
    const profile = this.requireProfile(state);
    if (profile.role === "admin") return profile;
    if (profile.role !== "operator" || !ownedOperators(state, profile.id).length) throw new BackendError("forbidden");
    return profile;
  }

  async ownerMoveStaff(userId: string, stationId: string) {
    const state = this.load();
    this.requireAnyOwner(state);
    const staff = state.staff ?? DEMO_STAFF;
    const current = staff.find((a) => a.userId === userId);
    if (!current) throw new BackendError("unknown", "not_found");
    this.requireOwnerOf(state, current.stationId);
    this.requireOwnerOf(state, stationId);
    if (!this.activeStations(state).some((s) => s.id === stationId)) throw new BackendError("station_not_found");
    if (current.stationId === stationId) return;
    this.save(
      withAudit(
        {
          ...state,
          staff: staff.map((a) => (a === current ? { stationId, userId } : a)),
          staffReassignments: this.resolvedReassignments(state, userId, stationId),
        },
        { table: "station_staff", action: "update", rowId: `${stationId}:${userId}`, stationId, userId, changes: { station_id: [current.stationId, stationId] } },
      ),
    );
  }

  async resolveReassignment(id: string) {
    const state = this.load();
    const profile = this.requireAnyOwner(state);
    const r = this.reassignmentsOf(state).find((x) => x.id === id);
    if (!r) throw new BackendError("unknown", "not_found");
    if (profile.role !== "admin" && !ownedOperators(state, profile.id).includes(r.operatorId)) throw new BackendError("forbidden");
    if (r.resolvedAt) return;
    const now = new Date().toISOString();
    this.save({ ...state, staffReassignments: this.reassignmentsOf(state).map((x) => (x.id === id ? { ...x, resolvedAt: now } : x)) });
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
    if (profile.role !== "operator" && profile.role !== "admin") throw new BackendError("forbidden");
    // An admin sees every operator (backoffice: admin all), an owner the operators they run.
    const admin = profile.role === "admin";
    const owned = new Set(admin ? state.operators.map((o) => o.id) : ownedOperators(state, profile.id));
    if (!owned.size && !admin) throw new BackendError("forbidden");
    const stations = this.activeStations(state).filter((s) => owned.has(s.operatorId));
    const ids = new Set(stations.map((s) => s.id));
    const staff = state.staff ?? DEMO_STAFF;
    const tariffs = state.stationTariffs ?? {};
    return {
      operators: state.operators.filter((o) => owned.has(o.id)).sort((a, b) => a.name.localeCompare(b.name)),
      stations: this.views(state, stations),
      staff: staff.filter((a) => ids.has(a.stationId)).map((a) => ({ stationId: a.stationId, ...this.label(state, a.userId) })),
      reassignments: this.reassignmentsOf(state)
        .filter((r) => !r.resolvedAt && owned.has(r.operatorId))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((r) => ({
          id: r.id,
          stationId: r.stationId,
          currentStationId: staff.find((a) => a.userId === r.userId)?.stationId ?? null,
          createdAt: r.createdAt,
          ...this.label(state, r.userId),
        })),
      // The contact as the owner typed it, masked; never the name of an account that has it.
      invites: this.staffInvitesOf(state)
        .filter((i) => i.status === "pending" && ids.has(i.stationId))
        .map((i) => ({
          id: i.id,
          stationId: i.stationId,
          label: personLabel({ fullName: null, phone: i.contact.includes("@") ? null : i.contact, email: i.contact.includes("@") ? i.contact : null }),
          createdAt: i.createdAt,
          expiresAt: i.expiresAt,
        })),
      prices: stations.map((s) => ({
        stationId: s.id,
        swapXof: swapPrice(state, s),
        chargeKwhXof: tariffs[s.id]?.kwhXof ?? null,
        chargeMinXof: tariffs[s.id]?.minXof ?? null,
      })),
    };
  }

  // Staff invites (as worker/api.ts, migration 0050) ------------------------------------

  /** Open invites whose time ran out are 'expired' (expireStaffInvites in worker/api.ts). */
  private staffInvitesOf(state: DemoState): DemoStaffInvite[] {
    const now = new Date().toISOString();
    return (state.staffInvites ?? []).map((i) => (i.status === "pending" && i.expiresAt <= now ? { ...i, status: "expired" as const, decidedAt: i.expiresAt } : i));
  }

  /** The same answer whether an account has the contact or not; the checks run on accepting. */
  async ownerInviteStaff(stationId: string, rawContact: string) {
    const state = this.load();
    const profile = this.requireOwnerOf(state, stationId);
    const contact = parseContact(rawContact ?? "");
    if (!contact) throw new BackendError((rawContact ?? "").includes("@") ? "invalid_contact" : "phone_not_allowed");
    if (!this.activeStations(state).some((s) => s.id === stationId)) throw new BackendError("station_not_found");
    const invites = this.staffInvitesOf(state);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + STAFF_INVITE_DAYS * 86_400_000).toISOString();
    const open = invites.find((i) => i.stationId === stationId && i.contact === contact.value && i.status === "pending");
    // Inviting again gives the open invite a new expiry.
    if (open) return this.save({ ...state, staffInvites: invites.map((i) => (i === open ? { ...i, expiresAt } : i)) });
    if (invites.filter((i) => i.stationId === stationId && i.status === "pending").length >= STAFF_INVITE_LIMIT) throw new BackendError("invite_limit");
    const invite: DemoStaffInvite = {
      id: crypto.randomUUID(),
      stationId,
      contact: contact.value,
      invitedBy: profile.id,
      status: "pending",
      createdAt: now.toISOString(),
      expiresAt,
      decidedAt: null,
      userId: null,
    };
    this.save(withAudit({ ...state, staffInvites: [...invites, invite] }, { table: "staff_invites", action: "insert", rowId: invite.id, stationId, changes: { contact: contact.value } }));
  }

  async ownerRevokeStaffInvite(inviteId: string) {
    const state = this.load();
    this.requireAnyOwner(state);
    const invites = this.staffInvitesOf(state);
    const invite = invites.find((i) => i.id === inviteId);
    if (!invite) throw new BackendError("invite_not_found");
    this.requireOwnerOf(state, invite.stationId);
    if (invite.status !== "pending") throw new BackendError("invite_not_found");
    const now = new Date().toISOString();
    this.save(
      withAudit(
        { ...state, staffInvites: invites.map((i) => (i.id === inviteId ? { ...i, status: "revoked" as const, decidedAt: now } : i)) },
        { table: "staff_invites", action: "update", rowId: inviteId, stationId: invite.stationId, changes: { status: ["pending", "revoked"] } },
      ),
    );
  }

  async myStaffInvites(): Promise<MyStaffInvite[]> {
    const state = this.load();
    const profile = state.profile;
    if (!profile || (!profile.phone && !profile.email)) return [];
    const stations = this.activeStations(state);
    return this.staffInvitesOf(state)
      .filter((i) => i.status === "pending" && (i.contact === profile.phone || i.contact === profile.email) && stations.some((s) => s.id === i.stationId))
      .map((i) => {
        const station = stations.find((s) => s.id === i.stationId)!;
        return { id: i.id, stationName: station.name, operatorName: state.operators.find((o) => o.id === station.operatorId)?.name ?? "", expiresAt: i.expiresAt };
      });
  }

  /** The open invite for the signed-in account's contact, at an active station its inviter still runs. */
  private staffInviteForMe(state: DemoState, profile: Profile, inviteId: string): DemoStaffInvite {
    const invite = this.staffInvitesOf(state).find((i) => i.id === inviteId);
    const station = invite && this.activeStations(state).find((s) => s.id === invite.stationId);
    const inviter = invite && (state.users ?? demoUsers(new Date())).find((u) => u.id === invite.invitedBy);
    const stillRuns = !!station && (inviter?.role === "admin" || (!!inviter && ownedOperators(state, inviter.id).includes(station.operatorId)));
    if (!invite || invite.status !== "pending" || !stillRuns || (invite.contact !== profile.phone && invite.contact !== profile.email)) throw new BackendError("invite_not_found");
    return invite;
  }

  /** As acceptStaffInvite in worker/api.ts: the checks of an assignment (withStaff) run now. */
  async acceptStaffInvite(inviteId: string) {
    const state = this.load();
    const profile = this.requireProfile(state);
    const invite = this.staffInviteForMe(state, profile, inviteId);
    const now = new Date().toISOString();
    const staffed = this.withStaff(state, invite.stationId, profile.id);
    const role = (staffed.users ?? []).find((u) => u.id === profile.id)?.role ?? profile.role;
    const invites = this.staffInvitesOf(state).map((i) =>
      i.id === invite.id
        ? { ...i, status: "accepted" as const, decidedAt: now, userId: profile.id }
        : i.status === "pending" && (i.contact === profile.phone || i.contact === profile.email)
          ? { ...i, status: "expired" as const, decidedAt: now }
          : i,
    );
    this.save(
      withAudit(
        { ...staffed, staffInvites: invites, profile: staffed.profile ? { ...staffed.profile, role } : staffed.profile },
        { table: "staff_invites", action: "update", rowId: invite.id, stationId: invite.stationId, userId: profile.id, changes: { status: ["pending", "accepted"] } },
      ),
    );
  }

  async declineStaffInvite(inviteId: string) {
    const state = this.load();
    const profile = this.requireProfile(state);
    const invite = this.staffInviteForMe(state, profile, inviteId);
    const now = new Date().toISOString();
    this.save(
      withAudit(
        { ...state, staffInvites: this.staffInvitesOf(state).map((i) => (i.id === invite.id ? { ...i, status: "declined" as const, decidedAt: now, userId: profile.id } : i)) },
        { table: "staff_invites", action: "update", rowId: invite.id, stationId: invite.stationId, userId: profile.id, changes: { status: ["pending", "declined"] } },
      ),
    );
  }

  async ownerRemoveStaff(stationId: string, userId: string) {
    const state = this.load();
    this.requireOwnerOf(state, stationId);
    this.save(this.withoutStaff(state, stationId, userId));
  }

  // Owner backoffice (as worker/owner.ts) ---------------------------------------------

  /** The stations a backoffice request covers: the one asked for, or every station of the owner's operators (admins: all). */
  private backofficeStations(state: DemoState, stationId: string | null): { ids: string[]; thirdParty: boolean } {
    const profile = this.requireProfile(state);
    if (profile.role !== "admin" && profile.role !== "operator") throw new BackendError("forbidden");
    const owned = new Set(ownedOperators(state, profile.id));
    const stations = state.stations.filter((s) => (profile.role === "admin" || owned.has(s.operatorId)) && (!stationId || s.id === stationId));
    if (!stations.length) throw new BackendError(stationId && profile.role === "admin" ? "station_not_found" : "forbidden");
    return { ids: stations.map((s) => s.id), thirdParty: stations.some((s) => !s.isOwn) };
  }

  private personName(state: DemoState, userId: string | null | undefined): string | null {
    if (!userId) return null;
    const u = (state.users ?? demoUsers(new Date())).find((x) => x.id === userId) ?? (state.profile?.id === userId ? state.profile : null);
    const d = (state.drivers ?? []).find((x) => x.userId === userId);
    if (d) return personLabel({ fullName: d.fullName, phone: d.phone, email: null });
    return u ? personLabel(u) : null;
  }

  async ownerLive(stationId: string | null): Promise<OwnerLive> {
    const state = this.load();
    const { ids } = this.backofficeStations(state, stationId);
    const set = new Set(ids);
    const now = new Date().toISOString();
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const parcels = this.parcelsOf(state);
    const vehicles = state.fleet ?? seedFleet();
    const handovers: Handover[] = [
      ...(state.parcelScans ?? [])
        .filter((x) => x.stationId && set.has(x.stationId) && (x.kind === "handover_to_driver" || x.kind === "received_at_station") && x.at >= weekAgo)
        .map((x) => ({
          at: x.at,
          stationId: x.stationId!,
          kind: x.kind as "handover_to_driver" | "received_at_station",
          driver: this.personName(state, x.driverId),
          parcel: parcels.find((p) => p.id === x.parcelId)?.trackingNo ?? null,
          amountXof: null,
          by: this.personName(state, x.by),
        })),
      ...(state.ledger ?? [])
        .filter((l) => l.kind === "settlement" && l.stationId && set.has(l.stationId) && l.at >= weekAgo)
        .map((l) => ({
          at: l.at,
          stationId: l.stationId!,
          kind: "driver_settlement" as const,
          driver: this.personName(state, l.driverId),
          parcel: null,
          amountXof: l.amountFcfa,
          by: this.personName(state, l.by),
        })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 50);
    return {
      reservations: state.reservations
        .filter((r) => set.has(r.stationId) && r.status === "active" && r.expiresAt > now)
        .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
        .map((r) => ({ ...r, pickupCode: undefined, customer: this.customerLabel(r.userId) })),
      drivers: (state.driverQueue ?? [])
        .filter((q) => set.has(q.stationId))
        .sort((a, b) => a.since.localeCompare(b.since))
        .map((q) => {
          const d = (state.drivers ?? []).find((x) => x.userId === q.driverId);
          return { stationId: q.stationId, name: this.personName(state, q.driverId) ?? "?", plate: vehicles.find((v) => v.id === d?.vehicleId)?.plate ?? null, since: q.since };
        }),
      runs: (state.parcelRuns ?? [])
        .filter((r) => r.status === "loading" || r.status === "under_way")
        .map((r) => {
          const mine = parcels.filter((p) => p.runId === r.id);
          return { r, parcels: mine.length, incoming: mine.filter((p) => set.has(p.toStationId)).length };
        })
        .filter(({ r, incoming }) => set.has(r.stationId) || incoming > 0)
        .sort((a, b) => a.r.createdAt.localeCompare(b.r.createdAt))
        .map(({ r, parcels: n, incoming }) => ({
          id: r.id,
          stationId: r.stationId,
          driver: this.personName(state, r.driverId) ?? "?",
          status: r.status as "loading" | "under_way",
          parcels: n,
          incoming,
          createdAt: r.createdAt,
        })),
      parcels: ids.map((id) => ({
        stationId: id,
        toSend: parcels.filter((p) => p.fromStationId === id && p.status === "deposited").length,
        incoming: parcels.filter((p) => p.toStationId === id && p.status === "in_transit").length,
        toPickUp: parcels.filter((p) => p.toStationId === id && p.status === "arrived").length,
      })),
      handovers,
    };
  }

  async ownerReport(stationId: string | null, days: ReportPeriod): Promise<OwnerReport> {
    const state = this.load();
    const { ids, thirdParty } = this.backofficeStations(state, stationId);
    const set = new Set(ids);
    const from = periodStart(days);
    const perDay = emptyDays(days);
    const index = new Map(perDay.map((d, i) => [d.day, i]));
    const dayOf = (iso: string) => perDay[index.get(iso.slice(0, 10)) ?? -1];
    const hours = Array.from({ length: 24 }, () => 0);
    const revenue = { swapCashXof: 0, swapAppXof: 0, swapFleetXof: 0, chargeCashXof: 0, chargeAppXof: 0, cashXof: 0, totalXof: 0 };
    let chargesXof = 0;
    let swapsXof = 0;
    const people = new Map<string, StaffStats>();
    const entry = (id: string, role: StaffStats["role"] | null) => {
      const e = people.get(id) ?? { personId: id, person: "", role: role ?? "staff", swaps: 0, charges: 0, actions: 0 };
      if (role) e.role = role;
      people.set(id, e);
      return e;
    };
    for (const x of (state.swaps ?? []).filter((x) => set.has(x.stationId) && x.createdAt >= from)) {
      const d = dayOf(x.createdAt);
      if (d) {
        d.swaps++;
        d.swapXof += x.amountXof;
      }
      hours[new Date(x.createdAt).getUTCHours()]++;
      // A shop station only hosts the swapping (0045): not its revenue, the cash is owed to poinderecharge.
      if (this.swapOwnerOfEntry(state, x) === "poinderecharge" && !state.stations.find((st) => st.id === x.stationId)?.isOwn) {
        if (x.payment === "cash") swapsXof += x.amountXof;
      } else if (x.payment === "cash") revenue.swapCashXof += x.amountXof;
      else if (x.payment === "wallet") revenue.swapAppXof += x.amountXof;
      else if (x.payment === "fleet") revenue.swapFleetXof += x.amountXof;
      entry(x.staffId, x.role).swaps++;
    }
    for (const ch of state.charges ?? []) {
      if (!set.has(ch.stationId)) continue;
      if (ch.status === "paid" && ch.paidAt && ch.paidAt >= from) {
        const d = dayOf(ch.paidAt);
        if (d) {
          d.charges++;
          d.chargeXof += ch.amountXof;
        }
        hours[new Date(ch.paidAt).getUTCHours()]++;
        // A partner's station only hosts the sockets: not its revenue, the cash is owed to poinderecharge.
        const hosted = !state.stations.find((s) => s.id === ch.stationId)?.isOwn;
        if (hosted) {
          if (ch.paymentMethod === "cash") chargesXof += ch.amountXof;
        } else if (ch.paymentMethod === "cash") revenue.chargeCashXof += ch.amountXof;
        else revenue.chargeAppXof += ch.amountXof;
      }
      if (ch.startedBy && ch.startedAt >= from) entry(ch.startedBy, null).charges++;
    }
    let parcelsXof = 0;
    for (const p of this.parcelsOf(state).filter((p) => set.has(p.fromStationId) && p.createdAt >= from)) {
      const d = dayOf(p.createdAt);
      if (d) d.parcels++;
      // Paid at the counter and not refunded (a cancelled parcel is refunded there).
      if (p.paymentMethod === "cash" && p.paidAt && p.status !== "cancelled") parcelsXof += p.priceFcfa;
    }
    revenue.cashXof = revenue.swapCashXof + revenue.chargeCashXof;
    revenue.totalXof = revenue.cashXof + revenue.swapAppXof + revenue.swapFleetXof + revenue.chargeAppXof;
    const driversXof = (state.ledger ?? []).filter((l) => l.kind === "settlement" && l.stationId && set.has(l.stationId) && l.at >= from).reduce((a, l) => a + l.amountFcfa, 0);
    const cardsXof = (state.cardTopups ?? [])
      .filter((t) => set.has(t.stationId) && t.at >= from && !state.stations.find((st) => st.id === t.stationId)?.isOwn)
      .reduce((a, t) => a + t.amountXof, 0);
    const creditXof = this.wallet(state)
      .transactions.filter((t) => t.type === "topup" && t.stationId && set.has(t.stationId) && t.createdAt >= from && !state.stations.find((st) => st.id === t.stationId)?.isOwn)
      .reduce((a, t) => a + t.amountXof, 0);
    for (const a of (state.stationActions ?? []).filter((a) => set.has(a.stationId) && a.createdAt >= from)) entry(a.personId, a.role).actions++;
    for (const p of people.values()) p.person = this.personName(state, p.personId) ?? "?";
    return {
      days,
      from,
      perDay,
      revenue,
      poinderecharge: {
        parcelsXof,
        driversXof,
        chargesXof,
        swapsXof,
        cardsXof,
        creditXof,
        totalXof: parcelsXof + driversXof + chargesXof + swapsXof + cardsXof + creditXof,
        thirdParty,
      },
      hours,
      staff: [...people.values()].sort((a, b) => b.swaps + b.charges + b.actions - (a.swaps + a.charges + a.actions)),
    };
  }

  // Station cash (as worker/station-cash.ts) ---------------------------------------------

  /** Who owned a logged swap: its own owner, else the station's rule (as SWAP_OWNER_SQL). */
  private swapOwnerOfEntry(state: DemoState, x: { stationId: string; owner?: SwapOwner }): SwapOwner {
    const station = state.stations.find((st) => st.id === x.stationId);
    return x.owner ?? swapOwnerOf(!!station?.isOwn, state.stationCash?.[x.stationId]?.swapOwner);
  }

  private stationCashOf(state: DemoState, ids: string[] | null, now = new Date()): StationCash[] {
    const partner = state.stations
      .filter((st) => !st.isOwn && (!ids || ids.includes(st.id)))
      .sort((a, b) => a.name.localeCompare(b.name));
    const parcels = this.parcelsOf(state);
    return partner.map((st) => {
      const settings = state.stationCash?.[st.id];
      const cash: CashItem[] = [
        ...(state.charges ?? [])
          .filter((c) => c.stationId === st.id && c.status === "paid" && c.paidAt && c.paymentMethod === "cash")
          .map((c): CashItem => ({ kind: "chargesXof", at: c.paidAt!, amountXof: c.amountXof })),
        ...(state.swaps ?? [])
          .filter((x) => x.stationId === st.id && x.payment === "cash" && this.swapOwnerOfEntry(state, x) === "poinderecharge")
          .map((x): CashItem => ({ kind: "swapsXof", at: x.createdAt, amountXof: x.amountXof })),
        ...parcels
          .filter((p) => p.fromStationId === st.id && p.paymentMethod === "cash" && p.paidAt && p.status !== "cancelled")
          .map((p): CashItem => ({ kind: "parcelsXof", at: p.paidAt!, amountXof: p.priceFcfa })),
        ...(state.ledger ?? [])
          .filter((l) => l.kind === "settlement" && l.stationId === st.id)
          .map((l): CashItem => ({ kind: "driversXof", at: l.at, amountXof: l.amountFcfa })),
        ...(state.cardTopups ?? []).filter((t) => t.stationId === st.id).map((t): CashItem => ({ kind: "cardsXof", at: t.at, amountXof: t.amountXof })),
        ...this.wallet(state)
          .transactions.filter((t) => t.type === "topup" && t.stationId === st.id)
          .map((t): CashItem => ({ kind: "creditXof", at: t.createdAt, amountXof: t.amountXof })),
      ];
      // No commission on Green Credit, loaded or spent (0047).
      const sales = [
        ...(state.charges ?? [])
          .filter((c) => c.stationId === st.id && c.status === "paid" && c.paidAt && !c.partnerId && c.paymentMethod !== "wallet")
          .map((c) => ({ at: c.paidAt!, amountXof: c.amountXof })),
        ...(state.swaps ?? [])
          .filter((x) => x.stationId === st.id && x.payment !== "none" && x.payment !== "wallet" && this.swapOwnerOfEntry(state, x) === "poinderecharge")
          .map((x) => ({ at: x.createdAt, amountXof: x.amountXof })),
      ];
      return stationCash(
        {
          stationId: st.id,
          stationName: st.name,
          operatorName: state.operators.find((o) => o.id === st.operatorId)?.name ?? "",
          swapOwner: settings?.swapOwner ?? "operator",
          commissionPct: settings?.commissionPct ?? 0,
          commissionMode: settings?.commissionMode ?? "monthly",
          // The demo has no history before this feature: every station's balance starts at the beginning of the month.
          start: monthStartOf(now),
          cash,
          sales,
          handovers: (state.cashHandovers ?? []).filter((h) => h.stationId === st.id).map(handoverView),
        },
        now,
      );
    });
  }

  /** Our own stations, one balance per staff member: the Green Credit they loaded (as cashOfOwnStations). */
  private ownStationCashOf(state: DemoState, ids: string[] | null, staffId: string | null = null, now = new Date()): StationCash[] {
    const own = state.stations.filter((st) => st.isOwn && (!ids || ids.includes(st.id)));
    const handovers = (state.cashHandovers ?? []).filter((h) => h.staffId);
    const topups = this.wallet(state).transactions.filter((t) => t.type === "topup" && t.stationId && t.staffId);
    const out: StationCash[] = [];
    for (const st of own) {
      const people = new Set([...topups.filter((t) => t.stationId === st.id).map((t) => t.staffId!), ...handovers.filter((h) => h.stationId === st.id).map((h) => h.staffId!)]);
      if (staffId) {
        people.clear();
        people.add(staffId);
      }
      for (const person of people) {
        out.push(
          stationCash(
            {
              stationId: st.id,
              stationName: st.name,
              operatorName: state.operators.find((o) => o.id === st.operatorId)?.name ?? "",
              swapOwner: "poinderecharge",
              commissionPct: 0,
              commissionMode: "monthly",
              start: monthStartOf(now),
              cash: topups
                .filter((t) => t.stationId === st.id && t.staffId === person)
                .map((t): CashItem => ({ kind: "creditXof", at: t.createdAt, amountXof: t.amountXof })),
              sales: [],
              handovers: handovers.filter((h) => h.stationId === st.id && h.staffId === person).map(handoverView),
              staff: { id: person, name: this.personName(state, person) ?? "?" },
            },
            now,
          ),
        );
      }
    }
    return out.sort((a, b) => a.stationName.localeCompare(b.stationName) || a.staffName!.localeCompare(b.staffName!));
  }

  async ownerCash(stationId: string | null): Promise<StationCash[]> {
    const state = this.load();
    const profile = this.requireProfile(state);
    const ids = profile.role === "admin" && !stationId ? null : this.backofficeStations(state, stationId).ids;
    return [...this.stationCashOf(state, ids), ...this.ownStationCashOf(state, ids)];
  }

  async myStationCash(stationId: string): Promise<StationCash | null> {
    const state = this.load();
    const profile = this.requireProfile(state);
    if (!this.roleAt(state, profile, stationId)) throw new BackendError("forbidden");
    return this.ownStationCashOf(state, [stationId], profile.id)[0] ?? null;
  }

  async closeCashDay(input: HandoverInput): Promise<CashHandover> {
    const error = handoverInputError(input);
    if (error) throw new BackendError(error as BackendErrorCode);
    const state = this.load();
    const profile = this.requireProfile(state);
    const own = !!state.stations.find((st) => st.id === input.stationId)?.isOwn;
    const staffId = own ? (input.staffId ?? profile.id) : null;
    if (staffId === profile.id) {
      if (!this.roleAt(state, profile, input.stationId)) throw new BackendError("forbidden");
    } else this.backofficeStations(state, input.stationId);
    const now = new Date();
    const [cash] = own ? this.ownStationCashOf(state, [input.stationId], staffId, now) : this.stationCashOf(state, [input.stationId], now);
    if (!cash) throw new BackendError("own_station");
    if (cash.dueXof !== input.expectedDueXof) throw new BackendError("cash_changed");
    const handover: CashHandover = {
      id: crypto.randomUUID(),
      stationId: input.stationId,
      periodFrom: cash.since,
      periodUntil: now.toISOString(),
      cashXof: cash.lines.totalXof,
      carryXof: cash.carryXof,
      commissionXof: cash.commissionXof,
      dueXof: cash.dueXof,
      amountXof: input.amountXof,
      method: input.method,
      reference: input.reference.trim(),
      note: input.note?.trim() || null,
      status: "pending",
      createdBy: personLabel(profile),
      createdAt: now.toISOString(),
      decidedBy: null,
      decidedAt: null,
      rejectReason: null,
      staffId,
    };
    const next = withAudit(
      { ...state, cashHandovers: [{ ...handover, createdById: profile.id, decidedById: null }, ...(state.cashHandovers ?? [])] },
      { table: "cash_handovers", action: "insert", rowId: handover.id, changes: { amount_xof: handover.amountXof, due_xof: handover.dueXof, method: handover.method }, stationId: input.stationId },
    );
    this.save(next);
    return handover;
  }

  async decideHandover(id: string, confirm: boolean, reason?: string): Promise<CashHandover> {
    const state = this.load();
    this.requireAdmin(state);
    const profile = this.requireProfile(state);
    const why = reason?.trim() ?? "";
    if (!confirm && (!why || why.length > HANDOVER_NOTE_MAX)) throw new BackendError("reject_reason_required");
    const found = (state.cashHandovers ?? []).find((h) => h.id === id);
    if (!found) throw new BackendError("unknown", "not_found");
    if (found.status !== "pending") throw new BackendError("handover_decided");
    const decided = {
      ...found,
      status: (confirm ? "confirmed" : "rejected") as HandoverStatus,
      decidedBy: personLabel(profile),
      decidedById: profile.id,
      decidedAt: new Date().toISOString(),
      rejectReason: confirm ? null : why,
    };
    this.save(
      withAudit(
        { ...state, cashHandovers: (state.cashHandovers ?? []).map((h) => (h.id === id ? decided : h)) },
        { table: "cash_handovers", action: "update", rowId: id, changes: { status: ["pending", decided.status] }, stationId: found.stationId },
      ),
    );
    return handoverView(decided);
  }

  async saveStationCashSettings(stationId: string, settings: StationCashSettings): Promise<void> {
    const state = this.load();
    this.requireAdmin(state);
    const station = state.stations.find((st) => st.id === stationId);
    if (!station) throw new BackendError("station_not_found");
    if (station.isOwn) throw new BackendError("own_station");
    const swapOwner = cleanSwapOwner(settings?.swapOwner);
    if (!swapOwner || !validCommissionPct(settings?.commissionPct) || !COMMISSION_MODES.includes(settings?.commissionMode)) throw new BackendError("unknown", "bad_request");
    const before = state.stationCash?.[stationId] ?? { swapOwner: null, commissionPct: 0, commissionMode: "monthly" as CommissionMode };
    const after = { swapOwner, commissionPct: settings.commissionPct, commissionMode: settings.commissionMode };
    this.save(
      withAudit(
        { ...state, stationCash: { ...state.stationCash, [stationId]: after } },
        { table: "stations", action: "update", rowId: stationId, changes: diff(before, after), stationId },
      ),
    );
  }

  /** As ownerSaveStation() in worker/api.ts: hours as days and times (never empty), phone and prices. */
  async ownerSaveStation(stationId: string, input: OwnerStationInput) {
    const state = this.load();
    this.requireOwnerOf(state, stationId);
    const station = state.stations.find((s) => s.id === stationId);
    if (!station) throw new BackendError("station_not_found");
    const openingHours = cleanOpeningHours(input?.openingHours);
    if (!openingHours) throw new BackendError("opening_hours_invalid");
    const tariff = state.stationTariffs?.[stationId] ?? { kwhXof: null, minXof: null };
    const price = (key: "swapXof" | "chargeKwhXof" | "chargeMinXof", old: number | null) => {
      if (input?.[key] === undefined) return old;
      if (!validPrice(input[key])) throw new BackendError("unknown", "bad_request");
      return input[key] ?? null;
    };
    const before = {
      opening_hours: station.openingHours,
      phone: station.phone ?? null,
      price_battery_xof: state.swapPrices?.[stationId] !== undefined ? state.swapPrices[stationId] : swapPrice(state, station),
      charge_kwh_xof: tariff.kwhXof,
      charge_min_xof: tariff.minXof,
    };
    const after = {
      opening_hours: openingHours,
      phone: String(input?.phone ?? "").trim().slice(0, 40) || null,
      price_battery_xof: price("swapXof", before.price_battery_xof),
      charge_kwh_xof: price("chargeKwhXof", before.charge_kwh_xof),
      charge_min_xof: price("chargeMinXof", before.charge_min_xof),
    };
    if (after.charge_kwh_xof === 0 || after.price_battery_xof === 0) throw new BackendError("unknown", "bad_request");
    const changes = diff(before, after);
    if (!Object.keys(changes).length) return;
    this.save(
      withAudit(
        {
          ...state,
          stations: state.stations.map((s) => (s.id === stationId ? { ...s, openingHours, phone: after.phone } : s)),
          swapPrices: { ...state.swapPrices, [stationId]: after.price_battery_xof },
          stationTariffs: { ...state.stationTariffs, [stationId]: { kwhXof: after.charge_kwh_xof, minXof: after.charge_min_xof } },
        },
        { table: "stations", action: "update", rowId: stationId, stationId, changes },
      ),
    );
  }

  // Service unlock per station (as worker/services.ts) ------------------------------

  async stationServices(): Promise<StationServiceInfo[]> {
    const state = withServiceRows(this.load());
    const profile = this.requireProfile(state);
    let stations: Station[];
    if (profile.role === "admin") {
      stations = state.stations;
    } else if (profile.role === "operator") {
      const owned = new Set(ownedOperators(state, profile.id));
      stations = this.activeStations(state).filter((s) => owned.has(s.operatorId));
      if (!stations.length) throw new BackendError("forbidden");
    } else {
      throw new BackendError("forbidden");
    }
    const global = globalServices(demoFeatures(state));
    const users = state.users ?? demoUsers(new Date());
    return [...stations]
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((s) =>
        STATION_SERVICES.map((service) => {
          const r = state.stationServices?.find((x) => x.stationId === s.id && x.service === service);
          const unlocked = !!r?.unlocked;
          const by = r?.requestedBy ? users.find((u) => u.id === r.requestedBy) : undefined;
          return {
            stationId: s.id,
            stationName: s.name,
            service,
            unlocked,
            status: r?.status ?? null,
            requestedBy: by ? personLabel(by) : null,
            requestedAt: r?.requestedAt ?? null,
            decidedAt: r?.decidedAt ?? null,
            globalOn: global[service],
            active: global[service] && unlocked,
          };
        }),
      );
  }

  private serviceRow(state: DemoState, stationId: string, service: StationService) {
    return withServiceRows(state).stationServices?.find((r) => r.stationId === stationId && r.service === service);
  }

  private saveServiceRow(state: DemoState, row: DemoServiceRow, audit: AuditInput) {
    const rows = (withServiceRows(state).stationServices ?? []).filter((r) => !(r.stationId === row.stationId && r.service === row.service));
    this.save(withAudit({ ...state, stationServices: [...rows, row] }, audit));
  }

  async requestStationService(stationId: string, service: StationService) {
    const state = this.load();
    const profile = this.requireProfile(state);
    const station = state.stations.find((s) => s.id === stationId);
    // The station's owner only; an admin switches directly.
    if (profile.role !== "operator" || !station || !ownedOperators(state, profile.id).includes(station.operatorId)) throw new BackendError("forbidden");
    if (!isStationService(service)) throw new BackendError("unknown", "unknown service");
    const before = this.serviceRow(state, stationId, service);
    if (before?.unlocked) throw new BackendError("service_already_unlocked");
    if (before?.status === "pending") throw new BackendError("service_request_pending");
    this.saveServiceRow(
      state,
      { stationId, service, unlocked: false, status: "pending", requestedBy: profile.id, requestedAt: new Date().toISOString(), decidedBy: null, decidedAt: null },
      { table: "station_services", action: before ? "update" : "insert", rowId: `${stationId}:${service}`, stationId, changes: { service, status: [before?.status ?? null, "pending"] } },
    );
  }

  async decideStationService(stationId: string, service: StationService, approve: boolean) {
    const state = this.load();
    this.requireAdmin(state);
    if (!isStationService(service)) throw new BackendError("unknown", "unknown service");
    const before = this.serviceRow(state, stationId, service);
    if (before?.status !== "pending") throw new BackendError("no_pending_request");
    const status = approve ? "approved" : "rejected";
    this.saveServiceRow(
      state,
      { ...before, status, unlocked: approve || before.unlocked, decidedBy: state.profile!.id, decidedAt: new Date().toISOString() },
      {
        table: "station_services",
        action: "update",
        rowId: `${stationId}:${service}`,
        stationId,
        changes: { service, status: ["pending", status], ...(approve && !before.unlocked ? { unlocked: [false, true] } : {}) },
      },
    );
  }

  async setStationService(stationId: string, service: StationService, unlocked: boolean) {
    const state = this.load();
    this.requireAdmin(state);
    if (!isStationService(service)) throw new BackendError("unknown", "unknown service");
    if (!state.stations.some((s) => s.id === stationId)) throw new BackendError("station_not_found");
    const before = this.serviceRow(state, stationId, service);
    if (!!before?.unlocked === unlocked) return;
    // A pending request is settled with it.
    const settled = before?.status === "pending" ? (unlocked ? "approved" : "rejected") : null;
    const now = new Date().toISOString();
    this.saveServiceRow(
      state,
      before
        ? { ...before, unlocked, status: settled ?? before.status, decidedBy: state.profile!.id, decidedAt: now }
        : { stationId, service, unlocked, status: unlocked ? "approved" : null, requestedBy: null, requestedAt: null, decidedBy: state.profile!.id, decidedAt: now },
      {
        table: "station_services",
        action: before ? "update" : "insert",
        rowId: `${stationId}:${service}`,
        stationId,
        changes: { service, unlocked: [!!before?.unlocked, unlocked], ...(settled ? { status: ["pending", settled] } : {}) },
      },
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
      partnerId: d.partnerId ?? null,
      qrToken: boxToken(d),
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
      protocol: input.protocol ?? null,
      ocppOpen: input.protocol === "ocpp1.6" && !!input.ocppNoPassword,
      lastSeenAt: null,
      createdAt: new Date().toISOString(),
      partnerId: null,
      qrToken: randomBoxToken(),
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
    return device.protocol === "ocpp1.6" && !device.ocppOpen ? { ocppKey: ocppKey() } : {};
  }

  async deleteDevice(externalId: string) {
    const state = this.load();
    this.requireAdmin(state);
    const devices = state.devices ?? seedDevices();
    const before = devices.find((d) => d.externalId === externalId);
    if (!before) return;
    // As the Worker: a running charge would lose its outlet.
    const pointIds = new Set(before.points.map((p) => p.id));
    if ((state.charges ?? []).some((c) => c.status === "charging" && pointIds.has(c.pointId))) throw new BackendError("charge_busy");
    this.save(
      withAudit(
        { ...state, devices: devices.filter((d) => d !== before) },
        { table: "charging_points", action: "delete", rowId: externalId, stationId: before.stationId, changes: { device: externalId } },
      ),
    );
  }

  async setQrStart(pointId: string, enabled: boolean) {
    const state = this.load();
    this.requireAdmin(state);
    const all = state.devices ?? seedDevices();
    if (!all.some((d) => d.points.some((p) => p.id === pointId))) throw new BackendError("unknown", "not_found");
    const devices = all.map((d) => ({ ...d, points: d.points.map((p) => (p.id === pointId ? { ...p, qrStart: enabled } : p)) }));
    this.save({ ...state, devices });
  }

  async renewBoxQr(externalId: string): Promise<string> {
    const state = this.load();
    this.requireAdmin(state);
    const all = state.devices ?? seedDevices();
    if (!all.some((d) => d.externalId === externalId)) throw new BackendError("unknown", "not_found");
    const qrToken = randomBoxToken();
    this.save({ ...state, devices: all.map((d) => (d.externalId === externalId ? { ...d, qrToken } : d)) });
    return qrToken;
  }

  async setDevicePartner(externalId: string, partnerId: string | null) {
    const state = this.load();
    this.requireAdmin(state);
    const all = state.devices ?? seedDevices();
    const device = all.find((d) => d.externalId === externalId);
    if (!device) throw new BackendError("unknown", "not_found");
    if (partnerId && !this.pointPartnersOf(state).some((p) => p.id === partnerId)) throw new BackendError("unknown", "not_found");
    const before = device.partnerId ?? null;
    if (before === partnerId) return;
    this.save(
      withAudit(
        { ...state, devices: all.map((d) => (d === device ? { ...d, partnerId } : d)) },
        { table: "charging_points", action: "update", rowId: externalId, stationId: device.stationId, changes: { device: externalId, partner_id: [before, partnerId] } },
      ),
    );
  }

  // Point partners (as worker/point-partners.ts) -------------------------------------

  private pointPartnersOf(state: DemoState): DemoPointPartner[] {
    return state.pointPartners ?? DEMO_POINT_PARTNERS;
  }

  /** The point partner who owns the socket of this charging point now; null: ours. */
  private partnerOfPoint(state: DemoState, pointId: string): string | null {
    return (state.devices ?? seedDevices()).find((d) => d.points.some((p) => p.id === pointId))?.partnerId ?? null;
  }

  async adminPointPartners(): Promise<AdminPointPartner[]> {
    const state = this.load();
    this.requireAdmin(state);
    const devices = state.devices ?? seedDevices();
    return [...this.pointPartnersOf(state)]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({
        ...p,
        accounts: (state.pointPartnerAccounts ?? []).filter((a) => a.partnerId === p.id).map((a) => this.label(state, a.userId)),
        devices: devices.filter((d) => d.partnerId === p.id).map((d) => ({ externalId: d.externalId, stationId: d.stationId, outlets: d.outlets })),
      }));
  }

  async savePointPartner(id: string | null, input: PointPartnerInput) {
    const state = this.load();
    this.requireAdmin(state);
    const name = input.name.trim().replace(/\s+/g, " ");
    if (!name || name.length > POINT_PARTNER_NAME_MAX) throw new BackendError("unknown", "invalid name");
    const contactPhone = input.contactPhone?.trim() ? normalizeTogoPhone(input.contactPhone) : null;
    if (input.contactPhone?.trim() && !contactPhone) throw new BackendError("phone_not_allowed");
    const partners = this.pointPartnersOf(state);
    if (id && !partners.some((p) => p.id === id)) throw new BackendError("unknown", "not_found");
    const partnerId = id ?? `demo-pp-${Date.now()}`;
    const pointPartners = id
      ? partners.map((p) => (p.id === id ? { ...p, name, contactPhone } : p))
      : [...partners, { id: partnerId, name, contactPhone, status: "active" as const, createdAt: new Date().toISOString() }];
    this.save(
      withAudit(
        { ...state, pointPartners },
        { table: "point_partners", action: id ? "update" : "insert", rowId: partnerId, changes: { name, contact_phone: contactPhone } },
      ),
    );
  }

  async setPointPartnerActive(id: string, active: boolean) {
    const state = this.load();
    this.requireAdmin(state);
    const partners = this.pointPartnersOf(state);
    const before = partners.find((p) => p.id === id);
    if (!before) throw new BackendError("unknown", "not_found");
    const status: PointPartnerStatus = active ? "active" : "suspended";
    if (before.status === status) return;
    this.save(
      withAudit(
        { ...state, pointPartners: partners.map((p) => (p.id === id ? { ...p, status } : p)) },
        { table: "point_partners", action: "update", rowId: id, changes: { status: [before.status, status] } },
      ),
    );
  }

  async addPointPartnerAccount(partnerId: string, contact: string) {
    const state = this.load();
    this.requireAdmin(state);
    if (!this.pointPartnersOf(state).some((p) => p.id === partnerId)) throw new BackendError("unknown", "not_found");
    const user = this.accountByContact(state, contact);
    const accounts = state.pointPartnerAccounts ?? [];
    const linked = accounts.find((a) => a.userId === user.id);
    if (linked) {
      if (linked.partnerId === partnerId) return;
      throw new BackendError("already_point_partner");
    }
    this.save(
      withAudit(
        { ...state, pointPartnerAccounts: [...accounts, { userId: user.id, partnerId, createdAt: new Date().toISOString() }] },
        { table: "point_partner_accounts", action: "insert", rowId: `${partnerId}:${user.id}`, userId: user.id, changes: { partner_id: partnerId } },
      ),
    );
  }

  async removePointPartnerAccount(partnerId: string, userId: string) {
    const state = this.load();
    this.requireAdmin(state);
    const accounts = state.pointPartnerAccounts ?? [];
    if (!accounts.some((a) => a.userId === userId && a.partnerId === partnerId)) return;
    this.save(
      withAudit(
        { ...state, pointPartnerAccounts: accounts.filter((a) => !(a.userId === userId && a.partnerId === partnerId)) },
        { table: "point_partner_accounts", action: "delete", rowId: `${partnerId}:${userId}`, userId, changes: { partner_id: partnerId } },
      ),
    );
  }

  async pointPartnerDashboard(days: ReportPeriod): Promise<PointPartnerDashboard> {
    const state = this.load();
    const profile = this.requireProfile(state);
    const link = (state.pointPartnerAccounts ?? []).find((a) => a.userId === profile.id);
    const partner = link && this.pointPartnersOf(state).find((p) => p.id === link.partnerId);
    if (!partner) throw new BackendError("forbidden");
    if (partner.status !== "active") throw new BackendError("partner_suspended");
    const from = periodStart(days);
    const seen = new Date().toISOString();
    const totals = { charges: 0, energyWh: 0, amountXof: 0, cashXof: 0, appXof: 0 };
    const perPoint = new Map<string, { charges: number; energyWh: number; amountXof: number }>();
    for (const c of state.charges ?? []) {
      if (c.partnerId !== partner.id || c.status !== "paid" || !c.paidAt || c.paidAt < from) continue;
      totals.charges++;
      totals.energyWh += c.energyWh;
      totals.amountXof += c.amountXof;
      if (c.paymentMethod === "cash") totals.cashXof += c.amountXof;
      else totals.appXof += c.amountXof;
      const e = perPoint.get(c.pointId) ?? { charges: 0, energyWh: 0, amountXof: 0 };
      perPoint.set(c.pointId, { charges: e.charges + 1, energyWh: e.energyWh + c.energyWh, amountXof: e.amountXof + c.amountXof });
    }
    const points: PartnerPoint[] = [];
    for (const d of state.devices ?? seedDevices()) {
      if (d.partnerId !== partner.id) continue;
      const station = state.stations.find((s) => s.id === d.stationId);
      if (!station) continue;
      for (const p of d.points) {
        points.push({
          id: p.id,
          label: p.label,
          outlet: p.outlet,
          deviceId: d.externalId,
          stationId: station.id,
          stationName: station.name,
          stationAddress: station.address,
          lat: station.lat,
          lng: station.lng,
          status: p.status,
          powerWatts: p.powerWatts,
          lastSeenAt: seen,
          ...(perPoint.get(p.id) ?? { charges: 0, energyWh: 0, amountXof: 0 }),
        });
      }
    }
    points.sort((a, b) => a.stationName.localeCompare(b.stationName) || a.label.localeCompare(b.label));
    return { partner: { id: partner.id, name: partner.name, status: partner.status, contactPhone: partner.contactPhone }, days, from, points, totals };
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

  /** An active depot at a station unlocked for parcels, as requireDepot() in worker/parcels.ts. */
  private depotOpen(state: DemoState, stationId: string): boolean {
    return this.activeDepot(state, stationId) && stationUnlocked(state, stationId, "parcels");
  }

  async parcelInfo() {
    const state = this.load();
    return {
      depots: (state.parcelDepots ?? seedDepots()).filter((d) => this.depotOpen(state, d.stationId)),
      sizes: state.parcelSizes ?? DEFAULT_PARCEL_SIZES,
      driverSettings: this.settingsOf(state),
      bookableVehicles: this.bookableVehiclesOf(state),
    };
  }

  private bookableVehiclesOf(state: DemoState): BookableVehicleType[] {
    const fleet = (state.fleet ?? seedFleet()).filter((v) => v.isActive);
    return BOOKABLE_VEHICLE_TYPES.filter((type) => fleet.some((v) => v.type === type));
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
        return {
          ...p,
          pickupCode: received && p.status === "arrived" ? p.pickupCode : undefined,
          direction: received ? "received" : "sent",
          history: this.historyOf(state, p),
        } as Parcel;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async stationParcels(stationId: string): Promise<Parcel[]> {
    const state = this.load();
    this.stationReader(state, stationId);
    return this.parcelsOf(state)
      .filter((p) => p.fromStationId === stationId || p.toStationId === stationId)
      .map((p) => this.forStaff(state, p))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** A parcel as staff see it (as STAFF_SELECT in worker/parcels.ts): no pickup code, and whether the sender uses the app. */
  private forStaff(state: DemoState, p: Parcel): Parcel {
    const account = (state.users ?? demoUsers(new Date())).find((u) => u.id === p.sender.userId);
    const senderHasApp = !!p.sender.userId && (state.profile?.id === p.sender.userId || !!account?.lastSignInAt);
    return { ...p, pickupCode: undefined, senderHasApp };
  }

  async markParcelLabel(stationId: string, parcelId: string): Promise<Parcel> {
    const state = this.load();
    const { profile, role } = this.stationActor(state, stationId);
    const parcels = this.parcelsOf(state);
    const parcel = parcels.find((p) => p.id === parcelId && (p.fromStationId === stationId || p.toStationId === stationId));
    if (!parcel) throw new BackendError("parcel_not_found");
    if (!OPEN_PARCEL_STATUSES.includes(parcel.status)) throw new BackendError("parcel_wrong_status");
    const updated: Parcel = { ...parcel, labelPrintedAt: parcel.labelPrintedAt ?? new Date().toISOString() };
    this.saveParcels(
      state,
      parcels.map((p) => (p.id === parcelId ? updated : p)),
      { table: "parcels", action: "update", rowId: parcelId, stationId, changes: { label: parcel.labelPrintedAt ? "reprinted" : "printed", role, by: profile.id } },
    );
    return this.forStaff(this.load(), updated);
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
    const staff = this.stationActor(state, stationId).profile;
    const senderPhone = normalizeTogoPhone(input.senderPhone ?? "");
    const recipientPhone = normalizeTogoPhone(input.recipientPhone ?? "");
    if (!senderPhone || !recipientPhone) throw new BackendError("phone_not_allowed");
    this.requireCustomerNumber(state, senderPhone, "sender_not_customer");
    this.requireCustomerNumber(state, recipientPhone, "recipient_not_customer");
    if (input.toStationId === stationId) throw new BackendError("same_station");
    if (!this.depotOpen(state, stationId) || !this.depotOpen(state, input.toStationId)) throw new BackendError("depot_inactive");
    if (input.express) this.requireDrivers(state);
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
      labelPrintedAt: null,
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
    return this.forStaff(this.load(), parcel);
  }

  // Collection runs and scans (plan phase 7), as worker/parcel-runs.ts ----------------

  /** R14: parcels are for customers only; a staff, owner, driver, fleet manager or admin number is refused. */
  private requireCustomerNumber(state: DemoState, phone: string, error: "recipient_not_customer" | "sender_not_customer") {
    const users = state.users ?? demoUsers(new Date());
    const holder = users.find((u) => u.phone === phone) ?? (state.profile?.phone === phone ? state.profile : null);
    if (holder && holder.role !== "customer") throw new BackendError(error);
  }

  /** Adds a scan unless the same one is there (parcel, run, kind): scanning twice is one record. */
  private withScan(state: DemoState, scan: Omit<DemoScan, "at"> & { at?: string }): DemoState {
    const scans = state.parcelScans ?? [];
    if (scans.some((x) => x.parcelId === scan.parcelId && x.runId === scan.runId && x.kind === scan.kind)) return state;
    return { ...state, parcelScans: [...scans, { ...scan, at: scan.at ?? new Date().toISOString() }] };
  }

  /** What happened to the parcel, as parcelHistories() in worker/parcels.ts (status times stand in for parcel_events). */
  private historyOf(state: DemoState, p: Parcel): ParcelHistoryEntry[] {
    const fromHome = p.paymentMethod === "cash_driver";
    const entries: ParcelHistoryEntry[] = [];
    if (!fromHome) entries.push({ at: p.createdAt, kind: "deposited", stationId: p.fromStationId });
    if (p.inTransitAt) entries.push({ at: p.inTransitAt, kind: "in_transit", stationId: fromHome ? null : p.fromStationId });
    if (p.arrivedAt) entries.push({ at: p.arrivedAt, kind: "arrived", stationId: p.toStationId });
    if (p.pickedUpAt) entries.push({ at: p.pickedUpAt, kind: "picked_up", stationId: p.deliveryStatus === "delivered" ? null : p.toStationId });
    for (const x of state.parcelScans ?? []) if (x.parcelId === p.id) entries.push({ at: x.at, kind: x.kind, stationId: x.stationId });
    return sortHistory(entries);
  }

  private runView(state: DemoState, run: DemoRun): ParcelRun {
    const driver = (state.drivers ?? []).find((d) => d.userId === run.driverId);
    const vehicle = (state.fleet ?? seedFleet()).find((v) => v.id === driver?.vehicleId);
    const scanned = (parcelId: string, kind: ParcelScanKind) =>
      (state.parcelScans ?? []).some((x) => x.parcelId === parcelId && x.runId === run.id && x.kind === kind);
    return {
      id: run.id,
      stationId: run.stationId,
      driver: { userId: run.driverId, name: driver?.fullName ?? "?", phone: driver?.phone ?? null, plate: vehicle?.plate ?? null },
      status: run.status,
      createdAt: run.createdAt,
      departedAt: run.departedAt,
      parcels: this.parcelsOf(state)
        .filter((p) => p.runId === run.id)
        .sort((a, b) => a.trackingNo.localeCompare(b.trackingNo))
        .map((p) => ({
          id: p.id,
          trackingNo: p.trackingNo,
          toStationId: p.toStationId,
          size: p.size,
          scanned: scanned(p.id, "handover_to_driver"),
          received: scanned(p.id, "received_at_station"),
        })),
    };
  }

  private loadingRun(state: DemoState, stationId: string, runId: string): DemoRun {
    const run = (state.parcelRuns ?? []).find((r) => r.id === runId);
    if (!run || run.stationId !== stationId) throw new BackendError("run_not_found");
    if (run.status !== "loading") throw new BackendError("run_wrong_status");
    return run;
  }

  private scannedParcel(state: DemoState, code: string): Parcel {
    const trackingNo = parseParcelScan(code);
    const parcel = trackingNo ? this.parcelsOf(state).find((p) => p.trackingNo === trackingNo) : undefined;
    if (!parcel) throw new BackendError("parcel_not_found");
    return parcel;
  }

  private saveRun(state: DemoState, run: DemoRun, audit?: AuditInput, parcels?: Parcel[]): ParcelRun {
    const next = { ...state, parcelRuns: (state.parcelRuns ?? []).map((r) => (r.id === run.id ? run : r)), ...(parcels ? { parcels } : {}) };
    this.save(audit ? withAudit(next, audit) : next);
    return this.runView(this.load(), run);
  }

  async stationRuns(stationId: string): Promise<ParcelRun[]> {
    const state = this.load();
    this.stationReader(state, stationId);
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    return (state.parcelRuns ?? [])
      .filter((r) => r.stationId === stationId && (r.status === "loading" || r.status === "under_way" || r.createdAt > since))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => this.runView(state, r));
  }

  async startRun(stationId: string, badge: string, parcelIds: string[]): Promise<ParcelRun> {
    const state = this.load();
    const { profile, role } = this.stationActor(state, stationId);
    if (!this.depotOpen(state, stationId)) throw new BackendError("depot_inactive");
    const driver = this.byBadge(state, badge);
    const ids = [...new Set(parcelIds)];
    if (!ids.length) throw new BackendError("unknown", "no parcels");
    const parcels = this.parcelsOf(state);
    const chosen = parcels.filter((p) => ids.includes(p.id));
    if (chosen.length !== ids.length) throw new BackendError("parcel_not_found");
    if (chosen.some((p) => p.fromStationId !== stationId || p.status !== "deposited" || p.express || p.runId)) throw new BackendError("parcel_wrong_status");
    if (chosen.some(needsLabel)) throw new BackendError("parcel_label_missing");
    const run: DemoRun = {
      id: crypto.randomUUID(),
      stationId,
      driverId: driver.userId,
      status: "loading",
      createdAt: new Date().toISOString(),
      departedAt: null,
      createdBy: profile.id,
      role,
    };
    const next = { ...state, parcelRuns: [run, ...(state.parcelRuns ?? [])] };
    return this.saveRun(
      next,
      run,
      { table: "parcel_runs", action: "insert", rowId: run.id, stationId, userId: driver.userId, changes: { driver: driver.userId, parcels: chosen.map((p) => p.trackingNo), role } },
      parcels.map((p) => (ids.includes(p.id) ? { ...p, runId: run.id } : p)),
    );
  }

  async scanRunParcel(stationId: string, runId: string, code: string): Promise<ParcelRun> {
    const state = this.load();
    const { profile, role } = this.stationActor(state, stationId);
    const run = this.loadingRun(state, stationId, runId);
    const parcel = this.scannedParcel(state, code);
    if (parcel.runId !== run.id || parcel.status !== "deposited") throw new BackendError("parcel_not_in_run");
    const next = this.withScan(state, { parcelId: parcel.id, runId: run.id, kind: "handover_to_driver", driverId: run.driverId, stationId, by: profile.id, role });
    if (next === state) return this.runView(state, run);
    return this.saveRun(next, run, {
      table: "parcels",
      action: "update",
      rowId: parcel.id,
      stationId,
      changes: { scan: "handover_to_driver", run: run.id, driver: run.driverId, role },
    });
  }

  async removeRunParcel(stationId: string, runId: string, parcelId: string): Promise<ParcelRun> {
    const state = this.load();
    const { role } = this.stationActor(state, stationId);
    const run = this.loadingRun(state, stationId, runId);
    const parcels = this.parcelsOf(state);
    if (!parcels.some((p) => p.id === parcelId && p.runId === run.id && p.status === "deposited")) throw new BackendError("parcel_not_in_run");
    return this.saveRun(
      { ...state, parcelScans: (state.parcelScans ?? []).filter((x) => !(x.parcelId === parcelId && x.runId === run.id)) },
      run,
      { table: "parcel_runs", action: "update", rowId: run.id, stationId, changes: { removed: parcelId, role } },
      parcels.map((p) => (p.id === parcelId ? { ...p, runId: null } : p)),
    );
  }

  async cancelRun(stationId: string, runId: string) {
    const state = this.load();
    const { role } = this.stationActor(state, stationId);
    const run = this.loadingRun(state, stationId, runId);
    this.saveRun(
      { ...state, parcelScans: (state.parcelScans ?? []).filter((x) => x.runId !== run.id) },
      { ...run, status: "cancelled" },
      { table: "parcel_runs", action: "update", rowId: run.id, stationId, changes: { status: ["loading", "cancelled"], role } },
      this.parcelsOf(state).map((p) => (p.runId === run.id && p.status === "deposited" ? { ...p, runId: null } : p)),
    );
  }

  async departRun(stationId: string, runId: string): Promise<ParcelRun> {
    const state = this.load();
    const { role } = this.stationActor(state, stationId);
    const run = this.loadingRun(state, stationId, runId);
    const view = this.runView(state, run);
    if (!view.parcels.length) throw new BackendError("run_wrong_status");
    if (view.parcels.some((p) => !p.scanned)) throw new BackendError("run_unscanned");
    const now = new Date().toISOString();
    return this.saveRun(
      state,
      { ...run, status: "under_way", departedAt: now },
      { table: "parcel_runs", action: "update", rowId: run.id, stationId, userId: run.driverId, changes: { status: ["loading", "under_way"], role } },
      this.parcelsOf(state).map((p) => (p.runId === run.id && p.status === "deposited" ? { ...p, status: "in_transit" as const, inTransitAt: now } : p)),
    );
  }

  /** A new 6-digit pickup code, unique among the parcels waiting at the station. */
  private newPickupCode(state: DemoState, stationId: string): string {
    const taken = new Set(this.parcelsOf(state).filter((p) => p.toStationId === stationId && p.status === "arrived").map((p) => p.pickupCode));
    let code: string;
    do code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    while (taken.has(code));
    return code;
  }

  async receiveParcel(stationId: string, code: string): Promise<Parcel> {
    const state = this.load();
    const { profile, role } = this.stationActor(state, stationId);
    const parcel = this.scannedParcel(state, code);
    if (parcel.toStationId !== stationId) throw new BackendError("parcel_wrong_status");
    const runId = parcel.runId ?? "";
    const scannedIn = (state.parcelScans ?? []).some((x) => x.parcelId === parcel.id && x.runId === runId && x.kind === "received_at_station");
    if (parcel.status === "arrived" && scannedIn) return { ...parcel, pickupCode: undefined };
    if (parcel.status !== "in_transit") throw new BackendError("parcel_wrong_status");
    if (parcel.express) throw new BackendError("parcel_with_driver");
    const run = (state.parcelRuns ?? []).find((r) => r.id === parcel.runId);
    const now = new Date();
    const arrived: Parcel = {
      ...parcel,
      status: "arrived",
      arrivedAt: now.toISOString(),
      pickupDeadline: new Date(now.getTime() + PARCEL_PICKUP_DAYS * 86_400_000).toISOString(),
      pickupCode: this.newPickupCode(state, stationId),
    };
    const parcels = this.parcelsOf(state).map((p) => (p.id === parcel.id ? arrived : p));
    // The run is done once none of its parcels is still on the road.
    const runs = (state.parcelRuns ?? []).map((r) =>
      r === run && r.status === "under_way" && !parcels.some((p) => p.runId === r.id && p.status === "in_transit") ? { ...r, status: "done" as const } : r,
    );
    const next = this.withScan({ ...state, parcelRuns: runs }, {
      parcelId: parcel.id,
      runId,
      kind: "received_at_station",
      driverId: run?.driverId ?? null,
      stationId,
      by: profile.id,
      role,
      at: now.toISOString(),
    });
    this.saveParcels(next, parcels, { table: "parcels", action: "update", rowId: parcel.id, stationId, changes: { status: ["in_transit", "arrived"], scan: "received_at_station", role } });
    return { ...arrived, pickupCode: undefined };
  }

  async pickUpParcel(stationId: string, codeOrQr: string): Promise<Parcel> {
    const state = this.load();
    this.stationActor(state, stationId);
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
    this.stationActor(state, parcel.fromStationId);
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
    this.stationActor(state, parcel.toStationId);
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
    return state.driverSettings ? withAllVehicles(state.driverSettings) : DEFAULT_DRIVER_SETTINGS;
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
    return this.busyJobs(state, driverId)[0] ?? null;
  }

  /** Every trip under way of a driver (several on a tour): an open offer first, then by slot (busyJobs in worker/drivers.ts). */
  private busyJobs(state: DemoState, driverId: string): DemoJob[] {
    return (state.jobs ?? [])
      .filter((j) => j.driverId === driverId && BUSY_JOB_STATUSES.includes(j.status))
      .sort((a, b) => Number(b.status === "assigned") - Number(a.status === "assigned") || (a.tourSlot ?? 1) - (b.tourSlot ?? 1) || (a.assignedAt ?? "").localeCompare(b.assignedAt ?? ""));
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
      vehicleType: j.vehicleType ?? null,
      size: j.size,
      weightKg: j.weightKg,
      content: j.content,
      distanceM: j.distanceM,
      fareFcfa: j.fareFcfa,
      collectFcfa: j.collectFcfa,
      ...(j.prepaidFcfa ? { prepaidFcfa: j.prepaidFcfa, ...(j.refunded ? { refunded: true as const } : {}) } : {}),
      recipient: j.recipient,
      declaredValue: j.declaredValue,
      driver: driver
        ? {
            name: driver.fullName,
            phone: driver.phone,
            plate: vehicle?.plate ?? null,
            vehicleType: vehicle?.type ?? null,
            position: TRACKED_JOB_STATUSES.includes(j.status) ? freshPosition(state.driverPositions?.[driver.userId]) : null,
          }
        : null,
      customerName: j.customerName,
      createdAt: j.createdAt,
      assignedAt: j.assignedAt,
      acceptedAt: j.acceptedAt,
      pickedUpAt: j.pickedUpAt,
      atDoorAt: j.atDoorAt,
      doneAt: j.doneAt,
      proofKey: j.proofKey,
      ...(j.merchantId ? { forShop: true as const } : {}),
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
      vehicleType: null,
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
    const now = new Date().toISOString();
    const expired = (state.jobs ?? []).filter((j) => j.status === "assigned" && j.assignedAt && j.assignedAt < stale);
    // Trips nobody took in time are called off (expireOpenJobs in worker/drivers.ts); express parcels wait for the run.
    const tooOld = new Date(Date.now() - OPEN_JOB_EXPIRY_MINUTES * 60_000).toISOString();
    const lapsed = (state.jobs ?? []).filter((j) => j.status === "open" && j.kind !== "express" && j.createdAt < tooOld);
    let jobs = (state.jobs ?? []).map((j) =>
      expired.includes(j)
        ? { ...j, status: "open" as const, driverId: null, assignedAt: null, declined: [...j.declined, j.driverId ?? ""] }
        : lapsed.includes(j)
          ? { ...j, status: "cancelled" as const, doneAt: now, noDriver: true }
          : j,
    );
    const parcels = (state.parcels ?? []).map((p) =>
      lapsed.some((j) => j.parcelId === p.id && j.kind === "delivery") && p.deliveryStatus === "booked" ? { ...p, deliveryStatus: null } : p,
    );
    let queue = [...(state.driverQueue ?? [])];
    const fleet = state.fleet ?? seedFleet();
    // The driver goes back to the end of the line where they were, if they still may drive.
    for (const j of expired) {
      if (!j.driverId || !j.driverStationId || queue.some((q) => q.driverId === j.driverId)) continue;
      const d = (state.drivers ?? []).find((x) => x.userId === j.driverId);
      const v = fleet.find((x) => x.id === d?.vehicleId);
      if (this.drives(state, d) && v?.isActive && this.balanceOfDriver(state, d.userId) < s.cashLimitFcfa) {
        queue.push({ driverId: d.userId, stationId: j.driverStationId, since: now });
      }
    }
    const drivers = (state.drivers ?? []).map((d) => (expired.some((j) => j.driverId === d.userId) ? { ...d, lastExpiredAt: now } : d));
    const stations = this.depotPoints(state);
    const tiers = state.parcelSizes ?? DEFAULT_PARCEL_SIZES;
    // A driver forgotten at a shop after the end of the day is checked out at 23:59:59 (autoCheckouts in worker/merchant-rules.ts).
    const checkins = this.autoCheckouts(state, jobs);
    // Drivers checked in at a shop: free, with an active vehicle; they only get that shop's trips, the first to check in first.
    let checkedIn = checkins
      .filter((k) => !k.outAt && !jobs.some((j) => j.driverId === k.driverId && BUSY_JOB_STATUSES.includes(j.status)))
      .sort((a, b) => a.inAt.localeCompare(b.inAt))
      .map((k) => {
        const d = drivers.find((x) => x.userId === k.driverId);
        const v = fleet.find((x) => x.id === d?.vehicleId);
        return this.drives(state, d) && v?.isActive ? { ...k, vehicleType: v.type } : null;
      })
      .filter((k) => k !== null);
    const favoriteSince = new Date(Date.now() - FAVORITE_ROUND_MINUTES * 60_000).toISOString();
    for (const job of [...jobs].filter((j) => j.status === "open").sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      const start = job.kind === "pickup" || job.kind === "ride" || job.kind === "courier" ? job.home : this.stationAt(state, job.fromStationId);
      if (!start) continue;
      const entries = queue
        // No new trip for a line at a station locked for drivers.
        .filter((q) => !job.declined.includes(q.driverId) && stationUnlocked(state, q.stationId, "drivers"))
        .map((q) => {
          const d = drivers.find((x) => x.userId === q.driverId);
          const v = fleet.find((x) => x.id === d?.vehicleId);
          return this.drives(state, d) && v?.isActive ? { ...q, vehicleType: v.type } : null;
        })
        .filter((q) => q !== null);
      const weight = job.weightKg ?? tiers.find((t) => t.size === job.size)?.maxWeightKg ?? 50;
      const fits = (type: FleetVehicle["type"]) => jobFits({ ...job, vehicleType: job.vehicleType ?? null, passengers: job.passengers ?? null }, type, weight, s);
      // A shop trip: its checked-in drivers first, then for a few minutes its favorites in the queue, then everyone.
      let pick: { driverId: string; stationId: string | null } | null = null;
      if (job.merchantId) {
        const here = checkedIn.find(
          (k) => k.merchantId === job.merchantId && !job.declined.includes(k.driverId) && fits(k.vehicleType) && this.balanceOfDriver(state, k.driverId) < s.cashLimitFcfa,
        );
        if (here) pick = { driverId: here.driverId, stationId: null };
        const favs = new Set(this.merchantDriversOf(state).filter((m) => m.merchantId === job.merchantId && m.kind === "favorite" && m.status === "active").map((m) => m.driverId));
        if (!pick && favs.size && job.createdAt > favoriteSince) pick = pickDriver(start, entries.filter((q) => favs.has(q.driverId)), stations, fits);
      }
      pick ??= pickDriver(start, entries, stations, fits);
      if (!pick) continue;
      const picked = pick;
      queue = queue.filter((q) => q.driverId !== picked.driverId);
      checkedIn = checkedIn.filter((k) => k.driverId !== picked.driverId);
      jobs = jobs.map((j) =>
        j.id === job.id ? { ...j, status: "assigned" as const, driverId: picked.driverId, driverStationId: picked.stationId, assignedAt: new Date().toISOString(), tourSlot: 1 } : j,
      );
    }
    jobs = this.offerTours(state, jobs, drivers, s);
    const checkinsChanged = JSON.stringify(checkins) !== JSON.stringify(state.merchantCheckins ?? []);
    if (expired.length || checkinsChanged || JSON.stringify(jobs) !== JSON.stringify(state.jobs ?? []) || queue.length !== (state.driverQueue ?? []).length) {
      const next = { ...state, jobs, driverQueue: queue, drivers, parcels: state.parcels ? parcels : state.parcels, ...(checkinsChanged ? { merchantCheckins: checkins } : {}) };
      this.save(
        lapsed.length
          ? withAudit(next, { table: "delivery_jobs", action: "update", rowId: lapsed.map((j) => j.id).join(","), changes: { status: ["open", "cancelled"], reason: "no_driver" } })
          : next,
      );
    }
  }

  /** Tours (offerTours in worker/drivers.ts): parcel trips nobody in line took go to a busy driver nearby. */
  private offerTours(state: DemoState, jobs: DemoJob[], drivers: DemoDriver[], s: DriverSettings): DemoJob[] {
    if (s.tourMax < 2) return jobs;
    const fleet = state.fleet ?? seedFleet();
    const tiers = state.parcelSizes ?? DEFAULT_PARCEL_SIZES;
    const busyOf = (id: string) => jobs.filter((j) => j.driverId === id && BUSY_JOB_STATUSES.includes(j.status));
    let candidates = drivers
      .map((d) => {
        const v = fleet.find((x) => x.id === d.vehicleId);
        const position = freshPosition(state.driverPositions?.[d.userId]);
        const busy = busyOf(d.userId);
        const ok =
          this.drives(state, d) &&
          v?.isActive &&
          position &&
          busy.length > 0 &&
          busy.length < s.tourMax &&
          busy.every((j) => j.status !== "assigned" && TOUR_KINDS.includes(j.kind)) &&
          !this.openCheckin(state, d.userId);
        return ok ? { driverId: d.userId, vehicleType: v!.type, position: position!, slots: busy.map((j) => j.tourSlot ?? 1) } : null;
      })
      .filter((x) => x !== null);
    for (const job of jobs.filter((j) => j.status === "open" && TOUR_KINDS.includes(j.kind)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      if (!candidates.length) break;
      const start = job.kind === "express" ? this.stationAt(state, job.fromStationId) : job.home;
      if (!start) continue;
      const weight = job.weightKg ?? tiers.find((t) => t.size === job.size)?.maxWeightKg ?? 50;
      const near = candidates
        .filter((c) => !job.declined.includes(c.driverId) && jobFits({ ...job, vehicleType: job.vehicleType ?? null, passengers: job.passengers ?? null }, c.vehicleType, weight, s))
        .map((c) => ({ c, m: distanceMeters(start, c.position) }))
        .filter((x) => x.m <= s.tourRadiusM && this.balanceOfDriver(state, x.c.driverId) < s.cashLimitFcfa)
        .sort((a, b) => a.m - b.m)[0];
      if (!near) continue;
      const slot = Array.from({ length: s.tourMax }, (_, i) => i + 1).find((n) => !near.c.slots.includes(n))!;
      jobs = jobs.map((j) =>
        j.id === job.id ? { ...j, status: "assigned" as const, driverId: near.c.driverId, driverStationId: null, assignedAt: new Date().toISOString(), tourSlot: slot } : j,
      );
      candidates = candidates.filter((c) => c.driverId !== near.c.driverId);
    }
    return jobs;
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
    const refunded = this.refundTrips({ ...state, jobs }, hit);
    this.save(
      withAudit(
        { ...refunded, parcels, driverQueue: [...(state.driverQueue ?? []).filter((q) => !back.some((b) => b.driverId === q.driverId)), ...back] },
        { table: "delivery_jobs", action: "update", rowId: hit.map((j) => j.id).join(","), changes: { status: ["open", "cancelled"] } },
      ),
    );
  }

  /** Phase 2: takes a trip's fare from the customer's wallet (worker/trip-payments.ts). */
  private payTripFromWallet(state: DemoState, profile: Profile, amount: number, label: string): DemoWallet {
    this.walletAccess(state);
    const w = this.wallet(state);
    const before = this.balance(w, profile.id);
    if (before < amount) throw new BackendError("insufficient_balance");
    return {
      ...w,
      balances: { ...w.balances, [profile.id]: before - amount },
      transactions: [this.tripTx(profile.id, profile, "send", amount, before - amount, label), ...w.transactions],
    };
  }

  private tripTx(userId: string, profile: Pick<Profile, "fullName" | "phone" | "email"> | null, attribute: "send" | "received", amount: number, after: number, label: string) {
    const tx: DemoWallet["transactions"][number] = {
      id: crypto.randomUUID(),
      trxId: newTrxId("trip"),
      type: "trip",
      attribute,
      status: "success",
      amountXof: amount,
      feeXof: 0,
      totalXof: amount,
      balanceAfterXof: after,
      counterparty: label,
      remark: null,
      createdAt: new Date().toISOString(),
      userId,
      userLabel: profile ? [profile.fullName, profile.phone ?? profile.email].filter(Boolean).join(" · ") : "",
      adminId: null,
    };
    return tx;
  }

  /** Online payments of trips that did not happen go back to the wallet, once. */
  private refundTrips(state: DemoState, which: DemoJob[]): DemoState {
    const due = which.filter((j) => j.prepaidFcfa && !j.refunded && j.customerUserId);
    if (!due.length) return state;
    let w = this.wallet(state);
    for (const j of due) {
      const after = this.balance(w, j.customerUserId!) + j.prepaidFcfa!;
      w = { ...w, balances: { ...w.balances, [j.customerUserId!]: after }, transactions: [this.tripTx(j.customerUserId!, null, "received", j.prepaidFcfa!, after, tripLabel(j.kind)), ...w.transactions] };
    }
    return { ...state, wallet: w, jobs: (state.jobs ?? []).map((j) => (due.some((d) => d.id === j.id) ? { ...j, refunded: true as const } : j)) };
  }

  async requestDriverPayout(network: PayoutNetwork, phone: string): Promise<DriverPayout> {
    const state = this.load();
    const { driver } = this.demoDriver(state);
    if (!PAYOUT_NETWORKS.includes(network)) throw new BackendError("unknown", "bad_request");
    const normalized = normalizeTogoPhone(phone);
    if (!normalized) throw new BackendError("phone_not_allowed");
    const amount = owedToDriver(this.balanceOfDriver(state, driver.userId));
    if (!amount) throw new BackendError("nothing_owed");
    if ((state.driverPayouts ?? []).some((p) => p.driverId === driver.userId && p.status === "requested")) throw new BackendError("payout_pending");
    const payout: DriverPayout & { driverId: string } = {
      id: crypto.randomUUID(),
      driverId: driver.userId,
      amountFcfa: amount,
      network,
      phone: normalized,
      status: "requested",
      reference: null,
      requestedAt: new Date().toISOString(),
      decidedAt: null,
    };
    this.save(
      withAudit(
        { ...state, driverPayouts: [payout, ...(state.driverPayouts ?? [])] },
        { table: "driver_ledger", action: "insert", rowId: payout.id, userId: driver.userId, changes: { payout_requested: amount, network } },
      ),
    );
    const { driverId, ...view } = payout;
    void driverId;
    return view;
  }

  async adminDriverPayouts(): Promise<AdminDriverPayout[]> {
    const state = this.load();
    this.requireAdmin(state);
    return [...(state.driverPayouts ?? [])]
      .sort((a, b) => Number(b.status === "requested") - Number(a.status === "requested") || b.requestedAt.localeCompare(a.requestedAt))
      .map(({ driverId, ...p }) => {
        const d = (state.drivers ?? []).find((x) => x.userId === driverId);
        return { ...p, driverId, driverName: d?.fullName ?? "", driverPhone: d?.phone ?? null, balanceFcfa: this.balanceOfDriver(state, driverId) };
      });
  }

  async decideDriverPayout(id: string, status: "paid" | "rejected", reference?: string) {
    const state = this.load();
    this.requireAdmin(state);
    const admin = this.requireProfile(state);
    const payout = (state.driverPayouts ?? []).find((p) => p.id === id);
    if (!payout || payout.status !== "requested") throw new BackendError("payout_not_open");
    const now = new Date().toISOString();
    const ref = reference?.trim().slice(0, 80) || null;
    this.save(
      withAudit(
        {
          ...state,
          driverPayouts: (state.driverPayouts ?? []).map((p) => (p.id === id ? { ...p, status, reference: ref, decidedAt: now } : p)),
          ledger:
            status === "paid"
              ? [{ ...this.ledgerEntry(payout.driverId, "settlement", -payout.amountFcfa, null, null), by: admin.id }, ...(state.ledger ?? [])]
              : state.ledger,
        },
        { table: "driver_ledger", action: "update", rowId: id, userId: payout.driverId, changes: { payout: ["requested", status], amount_fcfa: payout.amountFcfa, reference: ref } },
      ),
    );
  }

  private demoDriver(state: DemoState): { profile: Profile; driver: DemoDriver } {
    const profile = this.requireProfile(state);
    const driver = (state.drivers ?? []).find((d) => d.userId === profile.id);
    if (profile.role !== "driver" || !this.drives(state, driver)) throw new BackendError("not_a_driver");
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
    // Converted accounts only exist on Cloudflare (migration 0031): nothing waits in the demo.
    if (!d) return { driver: null, job: null, history: [], ledger: [], settings, lastExpiredAt: null, formerAccount: null };
    const mine = (state.jobs ?? []).filter((j) => j.driverId === profile.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const under = this.busyJobs(state, profile.id);
    const busy = under[0];
    const week = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const payout = (state.driverPayouts ?? [])
      .filter((p) => p.driverId === profile.id && (p.status === "requested" || (p.decidedAt ?? "") >= week))
      .sort((a, b) => Number(b.status === "requested") - Number(a.status === "requested") || b.requestedAt.localeCompare(a.requestedAt))[0];
    return {
      payout: payout ? (({ driverId, ...p }) => (void driverId, p))(payout) : null,
      driver: this.viewDriver(state, d, true),
      job: busy ? this.viewJob(state, busy) : null,
      jobs: under.map((j) => this.viewJob(state, j)),
      history: mine.filter((j) => !under.includes(j)).slice(0, 30).map((j) => this.viewJob(state, j)),
      ledger: (state.ledger ?? []).filter((e) => e.driverId === profile.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100),
      settings,
      lastExpiredAt: d.lastExpiredAt ?? null,
      formerAccount: null,
    };
  }

  async driverPass(): Promise<DriverPass> {
    const state = this.load();
    const { driver } = this.demoDriver(state);
    const link = (state.fleetLinks ?? []).find((l) => l.driverId === driver.userId);
    return signDriverPass(DEMO_PASS_SECRET, driver.code, link?.managerId ?? null);
  }

  async sendFormerAccountCode(contact: string) {
    void contact;
    this.demoDriver(this.load());
    throw new BackendError("account_not_found");
  }

  async claimFormerAccount(contact: string, code: string, pin: string): Promise<FormerAccount> {
    void contact;
    void code;
    void pin;
    this.demoDriver(this.load());
    throw new BackendError("account_not_found");
  }

  async applyDriver(input: DriverApplication) {
    const state = this.load();
    const profile = this.requireProfile(state);
    this.requireDrivers(state);
    // Customers apply; staff and managers keep their role. A driver account invited by a fleet completes its open application.
    if (profile.role !== "customer" && profile.role !== "driver") throw new BackendError("forbidden");
    if (!profile.phone) throw new BackendError("phone_required");
    const text = (v: string, min: number) => {
      const t = (v ?? "").trim();
      if (t.length < min || t.length > (min === 2 ? 80 : 40)) throw new BackendError("unknown", "invalid field");
      return t;
    };
    const fields = { fullName: text(input.fullName, 2), idNumber: text(input.idNumber, 3), licenseNumber: text(input.licenseNumber, 3), wantedType: input.wantedType };
    const existing = (state.drivers ?? []).find((d) => d.userId === profile.id);
    if (existing && (existing.status === "active" || existing.status === "suspended")) throw new BackendError("forbidden");
    if (!existing && profile.role === "driver") throw new BackendError("forbidden");
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
    this.requireDrivers(state);
    if (profile.role !== "customer" && profile.role !== "driver") throw new BackendError("forbidden");
    const driver = (state.drivers ?? []).find((d) => d.userId === profile.id);
    if (!driver || (driver.status !== "pending" && driver.status !== "rejected")) throw new BackendError("driver_not_found");
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
    this.requireDrivers(state);
    const vehicle = (state.fleet ?? seedFleet()).find((v) => v.id === driver.vehicleId);
    if (!vehicle?.isActive) throw new BackendError("no_vehicle");
    if (this.busyJob(state, driver.userId)) throw new BackendError("driver_busy");
    // Checked in at a shop: only the shop's trips until the driver checks out.
    if (this.openCheckin(state, driver.userId)) throw new BackendError("checked_in_at_shop");
    if (this.balanceOfDriver(state, driver.userId) >= this.settingsOf(state).cashLimitFcfa) throw new BackendError("cash_limit");
    if (!this.depotOpen(state, stationId)) throw new BackendError("depot_inactive");
    // Drivers queue only where the station is unlocked for them.
    if (!serviceActive(state, stationId, "drivers")) throw new BackendError("service_not_offered");
    // The demo runs anywhere, so it does not check that the driver is at the station.
    void position;
    const queue = state.driverQueue ?? [];
    if (queue.find((q) => q.driverId === driver.userId)?.stationId !== stationId) {
      this.save({ ...state, driverQueue: [...queue.filter((q) => q.driverId !== driver.userId), { driverId: driver.userId, stationId, since: new Date().toISOString() }] });
    }
    this.dispatch();
  }

  /** As reportPosition() in worker/drivers.ts: kept only while the driver is on duty. */
  /** The demo runs in the browser: no push notices. */
  async registerPushToken() {}

  async reportDriverPosition(position: { lat: number; lng: number; accuracyM?: number | null }) {
    const state = this.load();
    const { driver } = this.demoDriver(state);
    if (!validPoint(position)) throw new BackendError("unknown", "bad_request");
    const onDuty =
      driver.status === "active" &&
      ((state.driverQueue ?? []).some((q) => q.driverId === driver.userId) || !!this.openCheckin(state, driver.userId) || !!this.busyJob(state, driver.userId));
    const positions = { ...state.driverPositions };
    if (onDuty) positions[driver.userId] = { lat: position.lat, lng: position.lng, at: new Date().toISOString() };
    else delete positions[driver.userId];
    this.save({ ...state, driverPositions: positions });
    return { kept: onDuty };
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
    // Still carrying other trips of a tour: back in line only once they are done.
    const others = jobs.some((j) => j.id !== job.id && j.driverId === driver.userId && BUSY_JOB_STATUSES.includes(j.status));
    if (job.driverStationId && !others) queue.push({ driverId: driver.userId, stationId: job.driverStationId, since: new Date().toISOString() });
    this.saveJobs(state, jobs, undefined, { driverQueue: queue });
    this.dispatch();
  }

  async abandonJob(id: string, reason: AbandonReason) {
    const state = this.load();
    const { driver, job } = this.myDemoJob(state, id);
    const jobs = this.updateJob(state, job.id, ["accepted"], { status: "open", driverId: null, assignedAt: null, acceptedAt: null, declined: [...job.declined, driver.userId] });
    const queue = (state.driverQueue ?? []).filter((q) => q.driverId !== driver.userId);
    const others = jobs.some((j) => j.id !== job.id && j.driverId === driver.userId && BUSY_JOB_STATUSES.includes(j.status));
    if (job.driverStationId && !others && this.balanceOfDriver(state, driver.userId) < this.settingsOf(state).cashLimitFcfa) {
      queue.push({ driverId: driver.userId, stationId: job.driverStationId, since: new Date().toISOString() });
    }
    this.saveJobs(
      state,
      jobs,
      { table: "delivery_jobs", action: "update", rowId: job.id, userId: driver.userId, changes: { status: ["accepted", "open"], reason: "abandoned", abandon_reason: reason } },
      { driverQueue: queue },
    );
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
    const from = this.originDepot(state, job.home, job.toStationId);
    if (!from) throw new BackendError("no_origin_depot");
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
    // The parcel is numbered at the door, in the driver's hands: the driver's record is the handover.
    state = this.withScan(state, { parcelId: parcel.id, runId: job.id, kind: "handover_to_driver", driverId: driver.userId, stationId: null, by: driver.userId, role: "driver" });
    this.saveJobs(
      state,
      jobs,
      { table: "parcels", action: "insert", rowId: parcel.id, stationId: from.id, userId: job.customerUserId, changes: { tracking_no: parcel.trackingNo, size: tier.size, collect_fcfa: collect } },
      { parcels: [parcel, ...(state.parcels ?? [])], ledger: [this.ledgerEntry(driver.userId, "collected", collect, job.id, null), ...(state.ledger ?? [])] },
    );
    const saved = this.load();
    return this.viewJob(saved, (saved.jobs ?? []).find((j) => j.id === job.id)!);
  }

  /** The depot a parcel collected at home counts as handed in at: the nearest open one other than the destination. */
  private originDepot(state: DemoState, home: LatLng, toStationId: string) {
    return nearestStation(home, this.depotPoints(state).filter((st) => st.id !== toStationId && stationUnlocked(state, st.id, "parcels")));
  }

  async arriveAtDoor(id: string) {
    const state = this.load();
    const { job } = this.myDemoJob(state, id);
    if (!hasDoorStep(job)) throw new BackendError("job_wrong_status");
    this.saveJobs(state, this.updateJob(state, job.id, ["picked_up"], { status: "at_door", atDoorAt: new Date().toISOString() }));
  }

  async uploadDeliveryPhoto(id: string, image: Blob) {
    const state = this.load();
    const { job } = this.myDemoJob(state, id);
    // Home deliveries and couriers: the photo of the handover at the door.
    const atDoor: JobStatus[] = hasDoorStep(job) ? ["picked_up", "at_door"] : job.kind === "courier" ? ["picked_up"] : [];
    if (!atDoor.includes(job.status)) throw new BackendError("job_wrong_status");
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
      this.withScan(state, { parcelId: parcel.id, runId: job.id, kind: "delivered", driverId: driver.userId, stationId: null, by: driver.userId, role: "driver" }),
      jobs,
      { table: "parcels", action: "update", rowId: parcel.id, userId: parcel.recipient.userId, changes: { status: ["arrived", "picked_up"], delivery_status: ["out_for_delivery", "delivered"] } },
      {
        parcels: (state.parcels ?? []).map((p) =>
          p.id === parcel.id ? { ...p, status: "picked_up" as const, pickedUpAt: now, pickupCode: undefined, deliveryStatus: "delivered" as const } : p,
        ),
        greenpoint: this.tripGreenpoint(state, driver.userId, job, job.fromStationId),
        ledger: [
          ...(job.collectFcfa ? [this.ledgerEntry(driver.userId, "collected", job.collectFcfa, job.id, null)] : []),
          ...this.earning(state, job, driver.userId, null),
          ...(state.ledger ?? []),
        ],
      },
    );
  }

  async failDelivery(id: string) {
    const state = this.load();
    const { job } = this.myDemoJob(state, id);
    if (!hasDoorStep(job) || job.status !== "at_door" || !job.atDoorAt) throw new BackendError("job_wrong_status");
    if (Date.now() - new Date(job.atDoorAt).getTime() < this.settingsOf(state).waitMinutes * 60_000) throw new BackendError("wait_longer");
    this.saveJobs(state, this.updateJob(state, job.id, ["at_door"], { status: "returning" }), {
      table: "delivery_jobs",
      action: "update",
      rowId: job.id,
      userId: job.driverId,
      changes: { status: ["at_door", "returning"], ...(job.merchantId ? { merchant_id: job.merchantId } : {}) },
    });
  }

  /** Ride: the customer got on. Courier: the driver took the parcel and the fare in cash. */
  async boardRide(id: string) {
    const state = this.load();
    const { driver, job } = this.myDemoJob(state, id);
    if (job.kind !== "ride" && job.kind !== "courier") throw new BackendError("job_wrong_status");
    // Courier: the code the recipient gives at the door, made now; the sender sees it in the app.
    const handoverCode = job.kind === "courier" ? String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0") : undefined;
    const jobs = this.updateJob(state, job.id, ["accepted"], { status: "picked_up", pickedUpAt: new Date().toISOString(), handoverCode });
    // Couriers and a shop's rides are paid when the trip starts (collectsAtStart in worker/drivers.ts).
    if (!collectsAtStart(job) || !job.collectFcfa) return this.saveJobs(state, jobs);
    this.saveJobs(state, jobs, undefined, {
      ledger: [this.ledgerEntry(driver.userId, "collected", job.collectFcfa, job.id, null), ...(state.ledger ?? [])],
    });
  }

  async finishRide(id: string, code?: string) {
    const state = this.load();
    const { driver, job } = this.myDemoJob(state, id);
    if (job.kind !== "ride" && job.kind !== "courier") throw new BackendError("job_wrong_status");
    if (job.kind === "courier") this.checkCourierHandover(state, job, code);
    const from: JobStatus[] = hasDoorStep(job) ? ["picked_up", "at_door"] : ["picked_up"];
    const jobs = this.updateJob(state, job.id, from, { status: "done", doneAt: new Date().toISOString() });
    this.saveJobs(
      state,
      jobs,
      { table: "delivery_jobs", action: "update", rowId: job.id, userId: driver.userId, changes: { status: [job.status, "done"], collect_fcfa: job.collectFcfa } },
      {
        greenpoint: this.tripGreenpoint(state, driver.userId, job, job.driverStationId),
        ledger: [
          // A courier (and a shop's ride) was paid when the trip started.
          ...(collectsAtStart(job) || !job.collectFcfa ? [] : [this.ledgerEntry(driver.userId, "collected", job.collectFcfa, job.id, null)]),
          ...this.earning(state, job, driver.userId, null),
          ...(state.ledger ?? []),
        ],
      },
    );
  }

  /** Courier at the door, as checkCourierHandover() in worker/drivers.ts: the recipient's code, or a photo without one. */
  private checkCourierHandover(state: DemoState, job: DemoJob, code: string | undefined) {
    const typed = (code ?? "").replace(/\s/g, "");
    if (!typed) {
      if (!job.proofKey) throw new BackendError("proof_required");
      return;
    }
    const lockKey = `job:${job.id}`;
    const since = Date.now() - PARCEL_CODE_LOCK_MINUTES * 60_000;
    const failures = (state.parcelCodeFailures ?? []).filter((f) => f.stationId === lockKey && new Date(f.at).getTime() > since);
    if (failures.length >= PARCEL_MAX_CODE_FAILURES) throw new BackendError("code_locked");
    if (!job.handoverCode || typed !== job.handoverCode) {
      this.save({ ...state, parcelCodeFailures: [...(state.parcelCodeFailures ?? []), { stationId: lockKey, at: new Date().toISOString() }] });
      throw new BackendError("wrong_pickup_code");
    }
  }

  async myJobs(): Promise<DeliveryJob[]> {
    const state = this.load();
    if (!state.profile) return [];
    // A shop's members all see the shop's trips (planung/marchand.md, decision 4).
    const shop = state.profile.role === "merchant" ? this.membershipOf(state, state.profile.id)?.shop : null;
    if (state.profile.role === "merchant" && !shop) return [];
    return (state.jobs ?? [])
      .filter((j) => (shop ? j.merchantId === shop.id : j.customerUserId === state.profile!.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      // The sender of a courier sees the code the recipient gives at the door, to pass it on.
      .map((j) => ({ ...this.viewJob(state, j), ...(j.kind === "courier" && j.handoverCode && j.status === "picked_up" ? { handoverCode: j.handoverCode } : {}) }));
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
    const shop = this.bookingShop(state, profile);
    this.requireDrivers(state);
    const home = this.cleanHome(input.home);
    if (!this.depotOpen(state, input.toStationId)) throw new BackendError("depot_inactive");
    const recipientPhone = normalizeTogoPhone(input.recipientPhone ?? "");
    if (!recipientPhone) throw new BackendError("phone_not_allowed");
    this.requireCustomerNumber(state, recipientPhone, "recipient_not_customer");
    const content = (input.content ?? "").trim().slice(0, 300);
    if (!content) throw new BackendError("unknown", "content missing");
    const tier = (state.parcelSizes ?? DEFAULT_PARCEL_SIZES).find((t) => t.size === input.size);
    if (!tier) throw new BackendError("parcel_too_large");
    // Checked at booking, not only at the door: another depot must take the parcel in.
    if (!this.originDepot(state, home, input.toStationId)) throw new BackendError("no_origin_depot");
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
      customerName: shop?.name ?? profile.fullName,
      ...this.shopColumns(shop, profile),
    });
    this.saveJobs(state, [job, ...(state.jobs ?? [])], {
      table: "delivery_jobs",
      action: "insert",
      rowId: job.id,
      stationId: input.toStationId,
      userId: profile.id,
      changes: { kind: "pickup", fare_fcfa: fare, ...(shop ? { merchant_id: shop.id } : {}) },
    });
    this.dispatch();
    const saved = this.load();
    return this.viewJob(saved, (saved.jobs ?? []).find((j) => j.id === job.id)!);
  }

  async bookRide(input: RideBooking): Promise<DeliveryJob> {
    const state = this.load();
    const profile = this.requireProfile(state);
    const shop = this.bookingShop(state, profile);
    this.requireDrivers(state);
    const pickup = this.cleanHome(input.pickup);
    const d = this.cleanDropoff(input.dropoff);
    if (!Number.isInteger(input.passengers) || input.passengers < 1 || input.passengers > MAX_PASSENGERS) throw new BackendError("unknown", "passengers");
    const done: JobStatus[] = ["done", "failed", "cancelled"];
    // A customer rides once at a time; a shop books rides for several people.
    if (!shop && (state.jobs ?? []).some((j) => j.kind === "ride" && j.customerUserId === profile.id && !done.includes(j.status))) throw new BackendError("ride_open");
    const passenger = shop ? (input.passengerName ?? "").trim().replace(/\s+/g, " ").slice(0, 80) || null : null;
    const distanceM = Math.round(distanceMeters(pickup, d));
    const fare = fareFor(distanceM, false, this.settingsOf(state));
    const wallet = !shop && input.payWith === "wallet" ? this.payTripFromWallet(state, profile, fare, tripLabel("ride")) : null;
    const job = this.newJob({
      ...(wallet ? { prepaidFcfa: fare } : {}),
      kind: "ride",
      home: pickup,
      dropoff: d,
      passengers: input.passengers,
      size: "S",
      distanceM,
      fareFcfa: fare,
      collectFcfa: wallet ? 0 : fare,
      customerUserId: profile.id,
      customerName: shop ? (passenger ?? shop.name) : profile.fullName,
      ...this.shopColumns(shop, profile),
    });
    this.saveJobs(wallet ? { ...state, wallet } : state, [job, ...(state.jobs ?? [])], {
      table: "delivery_jobs",
      action: "insert",
      rowId: job.id,
      userId: profile.id,
      changes: { kind: "ride", passengers: input.passengers, fare_fcfa: fare, ...(shop ? { merchant_id: shop.id } : {}) },
    });
    this.dispatch();
    const saved = this.load();
    return this.viewJob(saved, (saved.jobs ?? []).find((j) => j.id === job.id)!);
  }

  private cleanDropoff(d: DropoffPoint): DropoffPoint {
    if (!validPoint(d)) throw new BackendError("unknown", "no destination");
    if (!inServiceArea(d)) throw new BackendError("outside_area");
    return { lat: d.lat, lng: d.lng, note: (d.note ?? "").trim().slice(0, 300) };
  }

  async bookCourier(input: CourierBooking): Promise<DeliveryJob> {
    const state = this.load();
    const profile = this.requireProfile(state);
    const shop = this.bookingShop(state, profile);
    this.requireDrivers(state);
    const pickup = this.cleanHome(input.pickup);
    const dropoff = this.cleanDropoff(input.dropoff);
    if (!dropoff.note) throw new BackendError("unknown", "directions missing");
    const recipientPhone = normalizeTogoPhone(input.recipientPhone ?? "");
    if (!recipientPhone) throw new BackendError("phone_not_allowed");
    this.requireCustomerNumber(state, recipientPhone, "recipient_not_customer");
    const content = (input.content ?? "").trim().slice(0, 300);
    if (!content) throw new BackendError("unknown", "content missing");
    const tier = (state.parcelSizes ?? DEFAULT_PARCEL_SIZES).find((t) => t.size === input.size);
    if (!tier) throw new BackendError("parcel_too_large");
    const vehicleType = input.vehicleType ?? null;
    if (vehicleType) {
      if (!BOOKABLE_VEHICLE_TYPES.includes(vehicleType)) throw new BackendError("unknown", "vehicle");
      if (!this.bookableVehiclesOf(state).includes(vehicleType)) throw new BackendError("vehicle_soon");
      if (!vehicleFits(vehicleType, tier.size, tier.maxWeightKg, this.settingsOf(state))) throw new BackendError("parcel_too_large");
    }
    const distanceM = Math.round(distanceMeters(pickup, dropoff));
    const fare = fareFor(distanceM, false, this.settingsOf(state));
    const wallet = !shop && input.payWith === "wallet" ? this.payTripFromWallet(state, profile, fare, tripLabel("courier")) : null;
    const job = this.newJob({
      ...(wallet ? { prepaidFcfa: fare } : {}),
      kind: "courier",
      vehicleType,
      home: pickup,
      dropoff,
      size: tier.size,
      weightKg: tier.maxWeightKg,
      content,
      recipient: { phone: recipientPhone, name: input.recipientName?.trim() || null },
      distanceM,
      fareFcfa: fare,
      collectFcfa: wallet ? 0 : fare,
      customerUserId: profile.id,
      customerName: shop?.name ?? profile.fullName,
      ...this.shopColumns(shop, profile),
    });
    this.saveJobs(wallet ? { ...state, wallet } : state, [job, ...(state.jobs ?? [])], {
      table: "delivery_jobs",
      action: "insert",
      rowId: job.id,
      userId: profile.id,
      changes: { kind: "courier", size: tier.size, vehicle_type: vehicleType, fare_fcfa: fare, ...(shop ? { merchant_id: shop.id } : {}) },
    });
    this.dispatch();
    const saved = this.load();
    return this.viewJob(saved, (saved.jobs ?? []).find((j) => j.id === job.id)!);
  }

  async bookDelivery(parcelId: string, input: HomePoint, payWith?: TripPayment): Promise<DeliveryJob> {
    const state = this.load();
    const profile = this.requireProfile(state);
    this.refuseNonCustomer(profile);
    this.requireDrivers(state);
    const home = this.cleanHome(input);
    const parcel = this.parcelsOf(state).find((p) => p.id === parcelId);
    if (!parcel) throw new BackendError("parcel_not_found");
    const isRecipient = parcel.recipient.userId === profile.id || (!!profile.phone && parcel.recipient.phone === profile.phone);
    if (!isRecipient) throw new BackendError("forbidden");
    if (parcel.status !== "arrived" || (parcel.deliveryStatus && parcel.deliveryStatus !== "failed")) throw new BackendError("parcel_wrong_status");
    if (!this.depotOpen(state, parcel.toStationId)) throw new BackendError("depot_inactive");
    const from = this.stationAt(state, parcel.toStationId)!;
    const distanceM = Math.round(distanceMeters(from, home));
    const fare = fareFor(distanceM, false, this.settingsOf(state));
    const wallet = payWith === "wallet" ? this.payTripFromWallet(state, profile, fare, tripLabel("delivery", parcel.trackingNo)) : null;
    const job = this.newJob({
      ...(wallet ? { prepaidFcfa: fare } : {}),
      kind: "delivery",
      parcelId: parcel.id,
      fromStationId: parcel.toStationId,
      home,
      size: parcel.size,
      weightKg: parcel.measures.weightKg,
      content: parcel.content,
      distanceM,
      fareFcfa: fare,
      collectFcfa: wallet ? 0 : fare,
      customerUserId: profile.id,
      customerName: parcel.recipient.name ?? profile.fullName,
    });
    this.saveJobs(
      wallet ? { ...state, wallet } : state,
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
    const shop = profile.role === "merchant" ? this.membershipOf(state, profile.id)?.shop : null;
    if (!shop) this.refuseNonCustomer(profile);
    const job = (state.jobs ?? []).find((j) => j.id === id);
    if (!job) throw new BackendError("job_not_found");
    const mine = shop ? job.merchantId === shop.id : job.customerUserId === profile.id;
    if (profile.role !== "admin" && !mine) throw new BackendError("forbidden");
    if (!["open", "assigned", "accepted"].includes(job.status)) throw new BackendError("job_wrong_status");
    this.cancelJobs(state, (j) => j.id === id);
  }

  async stationDrivers(stationId: string): Promise<StationDrivers> {
    this.dispatch();
    const state = this.load();
    this.stationReader(state, stationId);
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
    const driver = (state.drivers ?? []).find((d) => d.code === code);
    if (!code || !this.drives(state, driver)) throw new BackendError("driver_not_found");
    return driver;
  }

  private stationJobs(state: DemoState, stationId: string, driverId: string, jobId?: string) {
    // On a tour the driver may take one parcel here and bring another.
    const jobs = this.busyJobs(state, driverId).filter((j) => !jobId || j.id === jobId);
    const handOver =
      jobs.find((job) => job.fromStationId === stationId && (job.kind === "express" || job.kind === "delivery") && ["assigned", "accepted"].includes(job.status)) ?? null;
    const receive =
      jobs.find(
        (job) =>
          (job.status === "picked_up" && job.toStationId === stationId && (job.kind === "express" || job.kind === "pickup")) ||
          (job.status === "returning" && job.fromStationId === stationId && job.kind === "delivery"),
      ) ?? null;
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

  /** The parcel staff scanned must be the trip's (as tripParcel() in worker/drivers.ts). */
  private tripParcel(state: DemoState, job: DemoJob, code: string): Parcel {
    const parcel = this.scannedParcel(state, code);
    if (parcel.id !== job.parcelId) throw new BackendError("parcel_not_in_run");
    return parcel;
  }

  async handToDriver(stationId: string, badge: string, jobId: string, parcelCode: string) {
    const state = this.load();
    const { profile, role } = this.stationActor(state, stationId);
    const d = this.byBadge(state, badge);
    const { handOver: job } = this.stationJobs(state, stationId, d.userId, jobId);
    if (!job || job.id !== jobId) throw new BackendError("job_wrong_status");
    this.tripParcel(state, job, parcelCode);
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
      this.withScan(state, { parcelId: job.parcelId!, runId: job.id, kind: "handover_to_driver", driverId: d.userId, stationId, by: profile.id, role }),
      this.updateJob(state, job.id, ["assigned", "accepted"], { status: "picked_up", pickedUpAt: now, acceptedAt: job.acceptedAt ?? now }),
      { table: "delivery_jobs", action: "update", rowId: job.id, stationId, userId: d.userId, changes: { status: [job.status, "picked_up"], role } },
      { parcels },
    );
  }

  async receiveFromDriver(stationId: string, badge: string, jobId: string, parcelCode: string) {
    const loaded = this.load();
    const { profile, role } = this.stationActor(loaded, stationId);
    const d = this.byBadge(loaded, badge);
    const { receive: job } = this.stationJobs(loaded, stationId, d.userId, jobId);
    if (!job || job.id !== jobId) throw new BackendError("job_wrong_status");
    this.tripParcel(loaded, job, parcelCode);
    const now = new Date();
    const state = this.withScan(loaded, {
      parcelId: job.parcelId!,
      runId: job.id,
      kind: "received_at_station",
      driverId: d.userId,
      stationId,
      by: profile.id,
      role,
      at: now.toISOString(),
    });
    if (job.status === "returning") {
      // Nobody was home: the recipient pays nothing, an online payment goes back.
      const failed = this.updateJob(state, job.id, ["returning"], { status: "failed", doneAt: now.toISOString() });
      const refunded = this.refundTrips({ ...state, jobs: failed }, [job]);
      this.saveJobs(
        refunded,
        refunded.jobs ?? failed,
        { table: "delivery_jobs", action: "update", rowId: job.id, stationId, userId: d.userId, changes: { status: ["returning", "failed"] } },
        { parcels: (state.parcels ?? []).map((p) => (p.id === job.parcelId ? { ...p, deliveryStatus: "failed" as const } : p)) },
      );
      return;
    }
    const code = this.newPickupCode(state, stationId);
    const deadline = new Date(now.getTime() + PARCEL_PICKUP_DAYS * 86_400_000).toISOString();
    this.saveJobs(
      state,
      this.updateJob(state, job.id, ["picked_up"], { status: "done", doneAt: now.toISOString() }),
      { table: "delivery_jobs", action: "update", rowId: job.id, stationId, userId: d.userId, changes: { status: ["picked_up", "done"] } },
      {
        parcels: (state.parcels ?? []).map((p) =>
          p.id === job.parcelId ? { ...p, status: "arrived" as const, arrivedAt: now.toISOString(), pickupDeadline: deadline, pickupCode: code } : p,
        ),
        ledger: [...this.earning(state, job, d.userId, stationId), ...(state.ledger ?? [])],
        greenpoint: this.tripGreenpoint(state, d.userId, job, stationId),
      },
    );
  }

  async settleDriver(stationId: string, badge: string, amountFcfa: number) {
    const state = this.load();
    const actor = this.stationActor(state, stationId);
    const d = this.byBadge(state, badge);
    const current = this.balanceOfDriver(state, d.userId);
    if (amountFcfa !== current) throw new BackendError("balance_changed");
    if (current < 0 && (state.driverPayouts ?? []).some((p) => p.driverId === d.userId && p.status === "requested")) throw new BackendError("payout_pending");
    if (current === 0) return;
    this.save(
      withAudit(
        { ...state, ledger: [{ ...this.ledgerEntry(d.userId, "settlement", current, null, stationId), by: actor.profile.id }, ...(state.ledger ?? [])] },
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
    this.stationReader(state, stationId);
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
    const { senderHasApp, ...stored } = parcel;
    const taken: Parcel = { ...stored, trackingNo: booking.trackingNo, paymentMethod: "partner", paidAt: null };
    this.save({
      ...after,
      parcels: (after.parcels ?? []).map((p) => (p.id === parcel.id ? taken : p)),
      bookings: this.bookingsOf(after).filter((b) => b.id !== bookingId),
    });
    return { ...taken, senderHasApp };
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
    let base: DemoState = state;
    const role = this.roleOf(state, userId);
    switch (decision.action) {
      case "approve": {
        if (d.status !== "pending" && d.status !== "rejected") throw new BackendError("forbidden");
        if (!d.documents.id || !d.documents.license || !d.documents.portrait) throw new BackendError("documents_missing");
        // The customer account becomes a driver account (one role per account).
        if (role !== "customer" && role !== "driver") throw new BackendError("has_other_role");
        if (role === "customer" && this.customerThingsOpen(state, userId, d.phone)) throw new BackendError("role_change_blocked");
        vehicleFree(decision.vehicleId);
        next = { ...d, status: "active", vehicleId: decision.vehicleId, reviewedAt: now };
        if (role === "customer") {
          base = withAudit(this.withRole(state, userId, "driver"), {
            table: "profiles",
            action: "update",
            rowId: userId,
            userId,
            changes: { role: ["customer", "driver"] },
          });
        }
        break;
      }
      case "release": {
        // R15: back to customer only with no trip under way, no cash open and out of any fleet.
        if (role !== "driver") throw new BackendError("forbidden");
        if (busy) throw new BackendError("driver_busy");
        if ((state.fleetLinks ?? []).some((l) => l.driverId === userId) || this.balanceOfDriver(state, userId) !== 0) {
          throw new BackendError("role_change_blocked");
        }
        const released = withAudit(
          {
            ...this.withRole(state, userId, "customer"),
            drivers: (state.drivers ?? []).filter((x) => x.userId !== userId),
            driverQueue: queue.filter((q) => q.driverId !== userId),
          },
          { table: "drivers", action: "update", rowId: userId, userId, changes: { status: [d.status, null], released: true } },
        );
        this.save(withAudit(released, { table: "profiles", action: "update", rowId: userId, userId, changes: { role: ["driver", "customer"] } }));
        return;
      }
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
        { ...base, drivers: (state.drivers ?? []).map((x) => (x.userId === userId ? next : x)), driverQueue: queue, jobs, fleet },
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
    if (!this.drives(state, d) || !vehicle?.isActive) throw new BackendError("driver_not_found");
    if (this.busyJob(state, driverId)) throw new BackendError("driver_busy");
    // A driver checked in at a shop takes only that shop's trips (planung/marchand.md).
    const checkin = this.openCheckin(state, driverId);
    if (checkin && checkin.merchantId !== job.merchantId) throw new BackendError("driver_checked_in");
    const weight = job.weightKg ?? (state.parcelSizes ?? DEFAULT_PARCEL_SIZES).find((t) => t.size === job.size)?.maxWeightKg ?? 50;
    if (!jobFits({ ...job, vehicleType: job.vehicleType ?? null, passengers: job.passengers ?? null }, vehicle.type, weight, this.settingsOf(state))) {
      throw new BackendError("vehicle_too_small");
    }
    const queued = checkin ? null : (state.driverQueue ?? []).find((q) => q.driverId === driverId);
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

  // Fleets (as worker/fleet.ts) ------------------------------------------------------

  private fleetsOf(state: DemoState): DemoFleet[] {
    return state.fleets ?? seedFleets();
  }

  /** Open invites whose time ran out are 'expired' (expireInvites in worker/fleet.ts). */
  private invitesOf(state: DemoState): DemoInvite[] {
    const now = new Date().toISOString();
    return (state.fleetInvites ?? []).map((i) => (i.status === "pending" && i.expiresAt <= now ? { ...i, status: "expired" as const, decidedAt: i.expiresAt } : i));
  }

  /** R13: drivers in the fleet plus open invites. */
  private usedPlaces(state: DemoState, managerId: string): number {
    return (
      (state.fleetLinks ?? []).filter((l) => l.managerId === managerId).length +
      this.invitesOf(state).filter((i) => i.managerId === managerId && i.status === "pending").length
    );
  }

  private fleetInfo(state: DemoState, f: DemoFleet, used = this.usedPlaces(state, f.managerId)): FleetInfo {
    return { managerId: f.managerId, name: f.name, status: f.status, tier: f.tier, driverLimit: driverLimit(f.tier), used, createdAt: f.createdAt };
  }

  private viewInvite(i: DemoInvite): FleetInvite {
    return { id: i.id, phone: i.phone, status: i.status, token: i.token, createdAt: i.createdAt, expiresAt: i.expiresAt, decidedAt: i.decidedAt };
  }

  /** A manager of an approved fleet, or an admin (fleet null): fleet_not_approved otherwise (M1). */
  private requireApprovedFleet(state: DemoState): { profile: Profile; fleet: DemoFleet | null } {
    const profile = this.requireProfile(state);
    if (!managesFleet(profile)) throw new BackendError("forbidden");
    if (profile.role === "admin") return { profile, fleet: null };
    const fleet = this.fleetsOf(state).find((f) => f.managerId === profile.id);
    if (!fleet || fleet.status !== "approved") throw new BackendError("fleet_not_approved");
    return { profile, fleet };
  }

  /** An approved fleet for an account an admin makes fleet manager (approvedFleetFor in worker/fleet.ts). */
  private withApprovedFleet(state: DemoState, userId: string, name: string | null): DemoState {
    const fleets = this.fleetsOf(state);
    const now = new Date().toISOString();
    const existing = fleets.find((f) => f.managerId === userId);
    if (existing?.status === "approved") return state;
    const fleet: DemoFleet = existing
      ? { ...existing, status: "approved", reviewedAt: now }
      : { managerId: userId, name: name && name.trim().length >= 2 ? name.trim().slice(0, 80) : "Flotte", status: "approved", tier: "standard", createdAt: now, reviewedAt: now };
    return { ...state, fleets: [fleet, ...fleets.filter((f) => f.managerId !== userId)] };
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
      // A fleet manager is an account of its own: losing the last driver does not end it.
      next = withAudit(
        { ...next, fleetLinks: rest },
        { table: "fleet_manager_drivers", action: "delete", rowId: driverId, userId: driverId, changes: { manager_id: before.managerId } },
      );
    }
    if (contact?.trim()) {
      const account = this.accountByContact(state, contact);
      if (account.id === driverId) throw new BackendError("forbidden");
      if (!["customer", "fleet_manager", "admin"].includes(account.role)) throw new BackendError("has_other_role");
      if (before?.managerId === account.id) return;
      if (account.role === "fleet_manager") {
        const fleet = this.fleetsOf(state).find((f) => f.managerId === account.id);
        if (fleet && fleet.status !== "approved") throw new BackendError("fleet_not_approved");
        // R13 holds for the admin too.
        if (fleet?.tier !== "unlocked" && this.usedPlaces(next, account.id) >= STANDARD_DRIVER_LIMIT) throw new BackendError("fleet_limit");
      }
      if (account.role === "customer") next = this.withApprovedFleet(next, account.id, account.fullName);
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
    const profile = this.requireProfile(state);
    if (!managesFleet(profile)) throw new BackendError("forbidden");
    let fleet: FleetInfo | null = null;
    if (profile.role !== "admin") {
      const row = this.fleetsOf(state).find((f) => f.managerId === profile.id);
      // Not approved (yet): only the fleet itself, so the page can say what is missing.
      if (!row || row.status !== "approved") {
        const info: FleetInfo = row
          ? this.fleetInfo(state, row, 0)
          : { managerId: profile.id, name: profile.fullName ?? "", status: "pending", tier: "standard", driverLimit: STANDARD_DRIVER_LIMIT, used: 0, createdAt: new Date().toISOString() };
        return { fleet: info, drivers: [], invites: [], openJobs: [], settings: this.settingsOf(state) };
      }
      fleet = this.fleetInfo(state, row);
    }
    const drivers = this.managedDrivers(state).sort((a, b) => a.fullName.localeCompare(b.fullName));
    return {
      fleet,
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
          position: freshPosition(state.driverPositions?.[d.userId]),
        };
      }),
      invites: fleet
        ? this.invitesOf(state)
            .filter((i) => i.managerId === profile.id)
            .slice(0, 30)
            .map((i) => this.viewInvite(i))
        : [],
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
    const { profile, fleet } = this.requireApprovedFleet(state);
    if (!statsUnlocked(profile.role, fleet)) throw new BackendError("fleet_locked");
    const drivers = this.managedDrivers(state);
    const range = fleetRange(from, to);
    if (!range) throw new BackendError("unknown", "period");
    const inRange = (at: string | null) => !!at && at >= range.start && at < range.end;
    const ledger = this.gp(state).ledger;
    return {
      from,
      to,
      drivers: drivers.map((d) => {
        const jobs = (state.jobs ?? []).filter((j) => j.driverId === d.userId && inRange(j.doneAt));
        const done = jobs.filter((j) => j.status === "done");
        const money = (state.ledger ?? []).filter((e) => e.driverId === d.userId && inRange(e.at));
        const sum = (kind: LedgerEntry["kind"]) => money.filter((e) => e.kind === kind).reduce((n, e) => n + e.amountFcfa, 0);
        const visits = state.reservations.filter((r) => r.userId === d.userId && r.status === "completed" && inRange(r.createdAt));
        // Swaps at the counter with the driver's pass, billed to this fleet.
        const swaps = (state.swaps ?? []).filter(
          (x) => x.customerType === "fleet" && x.driverId === d.userId && inRange(x.createdAt) && (profile.role === "admin" || x.fleetManagerId === profile.id),
        );
        const trips = ledger.filter((l) => l.userId === d.userId && l.kind === "delivery" && inRange(l.createdAt));
        // Km of the finished trips: the demo keeps them on the trips.
        const km = done.reduce((n, j) => n + j.distanceM, 0);
        return {
          userId: d.userId,
          tripsDone: done.length,
          tripsFailed: jobs.filter((j) => j.status === "failed").length,
          fareFcfa: done.reduce((n, j) => n + j.fareFcfa, 0),
          earningFcfa: sum("earning"),
          collectedFcfa: sum("collected"),
          settledFcfa: sum("settlement"),
          batterySwaps: visits.filter((r) => r.type === "battery").length + swaps.length,
          chargingSlots: visits.filter((r) => r.type === "slot").length,
          // The demo has no app payments.
          chargingPaidFcfa: 0,
          fleetSwaps: swaps.length,
          fleetSwapsXof: swaps.reduce((n, x) => n + x.amountXof, 0),
          distanceKm: Math.round(km / 100) / 10,
          co2Grams: trips.reduce((n, l) => n + l.co2Grams, 0),
        };
      }),
    };
  }

  async fleetAssign(jobId: string, driverId: string) {
    this.dispatch();
    const state = this.load();
    this.requireApprovedFleet(state);
    if (!this.managedDrivers(state).some((d) => d.userId === driverId)) throw new BackendError("driver_not_found");
    const job = (state.jobs ?? []).find((j) => j.id === jobId);
    if (!job) throw new BackendError("job_not_found");
    if (job.status !== "open") throw new BackendError("job_wrong_status");
    this.handJob(state, job, driverId, "fleet");
  }

  async registerFleetManager(contact: string, code: string, pin: string, fleetName: string) {
    if (HOSTED_DEMO) throw new BackendError("forbidden");
    const name = cleanFleetName(fleetName);
    if (!name) throw new BackendError("unknown", "bad_request");
    if (!validPinFormat(pin)) throw new BackendError("bad_pin");
    if (weakPin(pin)) throw new BackendError("weak_pin");
    const state = this.load();
    const users = state.users ?? demoUsers(new Date());
    const isEmail = contact.includes("@");
    if (state.pins?.[contact] !== undefined || users.some((u) => (isEmail ? u.email : u.phone) === contact)) throw new BackendError("account_exists");
    if (code.trim() !== DEMO_CODE) throw new BackendError("invalid_code");
    const now = new Date().toISOString();
    const profile: Profile = {
      id: `demo-fleet-${Date.now().toString(36)}`,
      phone: isEmail ? null : contact,
      email: isEmail ? contact : null,
      fullName: name,
      role: "fleet_manager",
      ownerOf: [],
    };
    const next = withAudit(
      {
        ...state,
        profile,
        pins: { ...state.pins, [contact]: pin },
        users: [{ ...profile, createdAt: now, lastSignInAt: now }, ...users],
        fleets: [{ managerId: profile.id, name, status: "pending", tier: "standard", createdAt: now, reviewedAt: null }, ...this.fleetsOf(state)],
      },
      { table: "fleets", action: "insert", rowId: profile.id, userId: profile.id, changes: { name, status: "pending", tier: "standard" } },
    );
    this.save(withAudit(next, { table: "profiles", action: "insert", rowId: profile.id, userId: profile.id, changes: { [isEmail ? "email" : "phone"]: contact, role: "fleet_manager" } }));
    return profile;
  }

  async fleetStatement(from: string, to: string): Promise<FleetStatement> {
    const state = this.load();
    const { profile } = this.requireApprovedFleet(state);
    const range = fleetRange(from, to);
    if (!range) throw new BackendError("unknown", "period");
    const swaps = (state.swaps ?? [])
      .filter((x) => x.customerType === "fleet" && x.createdAt >= range.start && x.createdAt < range.end && (profile.role === "admin" || x.fleetManagerId === profile.id))
      .slice(0, 1000)
      .map((x) => ({
        id: x.id,
        at: x.createdAt,
        stationId: x.stationId,
        stationName: state.stations.find((s) => s.id === x.stationId)?.name ?? "?",
        driverId: x.driverId ?? null,
        driverName: (state.drivers ?? []).find((d) => d.userId === x.driverId)?.fullName ?? x.driver,
        batteryTypeId: x.batteryTypeId,
        amountXof: x.amountXof,
      }));
    return { from, to, swaps, totalXof: swaps.reduce((n, s) => n + s.amountXof, 0) };
  }

  /** R12: only a free number or an empty customer account (checkInvitable in worker/fleet.ts). */
  private checkInvitable(state: DemoState, phone: string) {
    const account = (state.users ?? demoUsers(new Date())).find((u) => u.phone === phone);
    if (!account) return;
    const role = this.roleOf(state, account.id);
    if (role !== "customer") throw new BackendError("invite_number_taken");
    if (this.customerThingsOpen(state, account.id, phone)) throw new BackendError("invite_account_not_empty");
    if ((state.fleetLinks ?? []).some((l) => l.driverId === account.id)) throw new BackendError("already_in_fleet");
  }

  async inviteFleetDriver(rawPhone: string): Promise<FleetInvite> {
    const state = this.load();
    const { profile, fleet } = this.requireApprovedFleet(state);
    if (profile.role !== "fleet_manager" || !fleet) throw new BackendError("forbidden");
    const phone = normalizeTogoPhone(rawPhone ?? "");
    if (!phone) throw new BackendError("phone_not_allowed");
    this.checkInvitable(state, phone);
    const invites = this.invitesOf(state);
    if (invites.some((i) => i.managerId === profile.id && i.phone === phone && i.status === "pending")) throw new BackendError("invite_pending");
    // R13: standard tier at most 3 drivers, open invites included.
    if (fleet.tier !== "unlocked" && this.usedPlaces(state, profile.id) >= STANDARD_DRIVER_LIMIT) throw new BackendError("fleet_limit");
    const now = new Date();
    const invite: DemoInvite = {
      id: crypto.randomUUID(),
      managerId: profile.id,
      phone,
      status: "pending",
      token: newDriverCode(),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + FLEET_INVITE_DAYS * 86_400_000).toISOString(),
      decidedAt: null,
      userId: null,
    };
    this.save(
      withAudit(
        { ...state, fleetInvites: [invite, ...invites] },
        { table: "fleet_invites", action: "insert", rowId: invite.id, changes: { phone, manager_id: profile.id } },
      ),
    );
    return this.viewInvite(invite);
  }

  async revokeFleetInvite(inviteId: string) {
    const state = this.load();
    const { profile } = this.requireApprovedFleet(state);
    const invites = this.invitesOf(state);
    const invite = invites.find((i) => i.id === inviteId);
    if (!invite || invite.status !== "pending" || (profile.role !== "admin" && invite.managerId !== profile.id)) throw new BackendError("invite_not_found");
    const now = new Date().toISOString();
    this.save(
      withAudit(
        { ...state, fleetInvites: invites.map((i) => (i.id === inviteId ? { ...i, status: "revoked" as const, decidedAt: now } : i)) },
        { table: "fleet_invites", action: "update", rowId: inviteId, changes: { status: ["pending", "revoked"] } },
      ),
    );
  }

  async removeFleetDriver(driverId: string): Promise<FleetRemoval> {
    const state = this.load();
    const { profile } = this.requireApprovedFleet(state);
    const link = (state.fleetLinks ?? []).find((l) => l.driverId === driverId);
    if (!link || (profile.role !== "admin" && link.managerId !== profile.id)) throw new BackendError("driver_not_found");
    if (this.busyJob(state, driverId)) throw new BackendError("driver_busy");
    const d = (state.drivers ?? []).find((x) => x.userId === driverId);
    // R15: back to customer with nothing open; with cash open the account stays a driver outside the fleet.
    const release = !!d && this.roleOf(state, driverId) === "driver" && this.balanceOfDriver(state, driverId) === 0;
    let next = withAudit(
      { ...state, fleetLinks: (state.fleetLinks ?? []).filter((l) => l !== link) },
      { table: "fleet_manager_drivers", action: "delete", rowId: driverId, userId: driverId, changes: { manager_id: link.managerId } },
    );
    if (release) {
      next = withAudit(
        {
          ...this.withRole(next, driverId, "customer"),
          drivers: (next.drivers ?? []).filter((x) => x.userId !== driverId),
          driverQueue: (next.driverQueue ?? []).filter((q) => q.driverId !== driverId),
        },
        { table: "drivers", action: "update", rowId: driverId, userId: driverId, changes: { status: [d!.status, null], released: true } },
      );
      next = withAudit(next, { table: "profiles", action: "update", rowId: driverId, userId: driverId, changes: { role: ["driver", "customer"] } });
    }
    this.save(next);
    return { released: release };
  }

  async myFleetInvites(): Promise<MyFleetInvite[]> {
    const state = this.load();
    const profile = state.profile;
    if (!profile?.phone || profile.role !== "customer") return [];
    const d = (state.drivers ?? []).find((x) => x.userId === profile.id);
    const fleets = this.fleetsOf(state);
    return this.invitesOf(state)
      .filter((i) => i.phone === profile.phone && i.status === "pending" && fleets.find((f) => f.managerId === i.managerId)?.status === "approved")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((i) => ({
        token: i.token,
        fleetName: fleets.find((f) => f.managerId === i.managerId)!.name,
        expiresAt: i.expiresAt,
        needsApplication: !d || d.status === "rejected",
      }));
  }

  private inviteForMe(state: DemoState, profile: Profile, token: string): DemoInvite {
    const invite = this.invitesOf(state).find((i) => i.token === token.trim().toUpperCase());
    if (!invite || invite.status !== "pending" || !profile.phone || invite.phone !== profile.phone) throw new BackendError("invite_not_found");
    return invite;
  }

  async acceptFleetInvite(token: string, application?: DriverApplication) {
    const state = this.load();
    const profile = this.requireProfile(state);
    const invite = this.inviteForMe(state, profile, token);
    if (profile.role !== "customer") throw new BackendError("has_other_role");
    this.requireDrivers(state);
    if (this.fleetsOf(state).find((f) => f.managerId === invite.managerId)?.status !== "approved") throw new BackendError("invite_not_found");
    if (this.customerThingsOpen(state, profile.id, profile.phone)) throw new BackendError("invite_account_not_empty");
    if ((state.fleetLinks ?? []).some((l) => l.driverId === profile.id)) throw new BackendError("already_in_fleet");
    const existing = (state.drivers ?? []).find((d) => d.userId === profile.id);
    let drivers = state.drivers ?? [];
    if (!existing || existing.status === "rejected") {
      const text = (v: string | undefined, min: number, max: number) => {
        const t = (v ?? "").trim();
        if (t.length < min || t.length > max) throw new BackendError("unknown", "bad_request");
        return t;
      };
      const a = application;
      if (!a || !FLEET_VEHICLE_TYPES.includes(a.wantedType)) throw new BackendError("unknown", "bad_request");
      const fields = { fullName: text(a.fullName, 2, 80), idNumber: text(a.idNumber, 3, 40), licenseNumber: text(a.licenseNumber, 3, 40), wantedType: a.wantedType };
      const driver: DemoDriver = existing
        ? { ...existing, ...fields, status: "pending" }
        : { userId: profile.id, status: "pending", phone: profile.phone, documents: {}, vehicleId: null, code: newDriverCode(), createdAt: new Date().toISOString(), reviewedAt: null, ...fields };
      drivers = [driver, ...drivers.filter((d) => d.userId !== profile.id)];
    }
    const now = new Date().toISOString();
    const invites = this.invitesOf(state).map((i) =>
      i.id === invite.id
        ? { ...i, status: "accepted" as const, decidedAt: now, userId: profile.id }
        : i.phone === invite.phone && i.status === "pending"
          ? { ...i, status: "expired" as const, decidedAt: now }
          : i,
    );
    let next = withAudit(
      { ...this.withRole(state, profile.id, "driver"), drivers, fleetInvites: invites, fleetLinks: [...(state.fleetLinks ?? []), { driverId: profile.id, managerId: invite.managerId }] },
      { table: "fleet_invites", action: "update", rowId: invite.id, userId: profile.id, changes: { status: ["pending", "accepted"] } },
    );
    next = withAudit(next, { table: "fleet_manager_drivers", action: "insert", rowId: profile.id, userId: profile.id, changes: { manager_id: invite.managerId, invite: invite.id } });
    this.save(withAudit(next, { table: "profiles", action: "update", rowId: profile.id, userId: profile.id, changes: { role: ["customer", "driver"] } }));
  }

  async declineFleetInvite(token: string) {
    const state = this.load();
    const profile = this.requireProfile(state);
    const invite = this.inviteForMe(state, profile, token);
    const now = new Date().toISOString();
    this.save(
      withAudit(
        { ...state, fleetInvites: this.invitesOf(state).map((i) => (i.id === invite.id ? { ...i, status: "declined" as const, decidedAt: now, userId: profile.id } : i)) },
        { table: "fleet_invites", action: "update", rowId: invite.id, userId: profile.id, changes: { status: ["pending", "declined"] } },
      ),
    );
  }

  async adminFleets(): Promise<AdminFleet[]> {
    const state = this.load();
    this.requireAdmin(state);
    const users = state.users ?? demoUsers(new Date());
    const order = { pending: 0, approved: 1, rejected: 2 };
    const invites = this.invitesOf(state);
    return [...this.fleetsOf(state)]
      .sort((a, b) => order[a.status] - order[b.status] || b.createdAt.localeCompare(a.createdAt))
      .map((f) => {
        const u = users.find((x) => x.id === f.managerId);
        const links = (state.fleetLinks ?? []).filter((l) => l.managerId === f.managerId);
        return {
          ...this.fleetInfo(state, f),
          contact: u?.phone ?? u?.email ?? null,
          reviewedAt: f.reviewedAt,
          drivers: links
            .map((l) => (state.drivers ?? []).find((d) => d.userId === l.driverId))
            .filter((d): d is DemoDriver => !!d)
            .map((d) => ({ userId: d.userId, fullName: d.fullName, status: d.status })),
          invites: invites.filter((i) => i.managerId === f.managerId).map((i) => this.viewInvite(i)),
        };
      });
  }

  async reviewFleet(managerId: string, action: FleetDecision) {
    const state = this.load();
    this.requireAdmin(state);
    const fleets = this.fleetsOf(state);
    const fleet = fleets.find((f) => f.managerId === managerId);
    if (!fleet) throw new BackendError("unknown", "not_found");
    let status: FleetStatus;
    if (action === "approve") {
      if (fleet.status === "approved") return;
      status = "approved";
    } else if (action === "reject") {
      if (fleet.status !== "pending") throw new BackendError("forbidden");
      status = "rejected";
    } else {
      throw new BackendError("unknown", "bad_request");
    }
    this.save(
      withAudit(
        { ...state, fleets: fleets.map((f) => (f.managerId === managerId ? { ...f, status, reviewedAt: new Date().toISOString() } : f)) },
        { table: "fleets", action: "update", rowId: managerId, userId: managerId, changes: { status: [fleet.status, status] } },
      ),
    );
  }

  // Merchants (as worker/merchants.ts and worker/merchant-rules.ts) ----------------------

  private merchantsOf(state: DemoState): DemoMerchant[] {
    return state.merchants ?? seedMerchants();
  }

  private membersOf(state: DemoState): DemoMember[] {
    return state.merchantMembers ?? seedMembers();
  }

  /** Open invites whose time ran out are 'expired' (expireInvites in worker/merchants.ts). */
  private merchantInvitesOf(state: DemoState): DemoMerchantInvite[] {
    const now = new Date().toISOString();
    return (state.merchantInvites ?? []).map((i) => (i.status === "pending" && i.expiresAt <= now ? { ...i, status: "expired" as const, decidedAt: i.expiresAt } : i));
  }

  private merchantDriversOf(state: DemoState): DemoMerchantDriver[] {
    return state.merchantDrivers ?? [];
  }

  private checkinsOf(state: DemoState): DemoCheckin[] {
    return state.merchantCheckins ?? [];
  }

  /** The shop the user belongs to, with whether they are its merchant. */
  private membershipOf(state: DemoState, userId: string): { shop: DemoMerchant; isOwner: boolean } | null {
    const m = this.membersOf(state).find((x) => x.userId === userId);
    const shop = m && this.merchantsOf(state).find((x) => x.id === m.merchantId);
    return m && shop ? { shop, isOwner: m.isOwner } : null;
  }

  /** The driver's open check-in, if any. */
  private openCheckin(state: DemoState, driverId: string): DemoCheckin | null {
    return this.checkinsOf(state).find((k) => k.driverId === driverId && !k.outAt) ?? null;
  }

  /**
   * Who books a trip: a customer (null) or a member of an approved shop (the shop), as
   * bookingShop() in worker/merchant-rules.ts. Other accounts are refused (R11).
   */
  private bookingShop(state: DemoState, profile: Profile): DemoMerchant | null {
    if (profile.role !== "merchant") {
      this.refuseNonCustomer(profile);
      return null;
    }
    const member = this.membershipOf(state, profile.id);
    if (!member || member.shop.status !== "approved") throw new BackendError("merchant_not_approved");
    return member.shop;
  }

  private shopColumns(shop: DemoMerchant | null, profile: Profile): Pick<DemoJob, "merchantId" | "bookedBy"> {
    return shop ? { merchantId: shop.id, bookedBy: profile.id } : { merchantId: null, bookedBy: null };
  }

  /**
   * The driver's share of a finished trip, except for a shop trip driven while checked in
   * there at an hourly rate: the shop pays the hours, the whole fare is ours (decision A).
   */
  private earning(state: DemoState, job: DemoJob, driverId: string, stationId: string | null): DemoLedger[] {
    const at = job.assignedAt;
    const hourly =
      !!job.merchantId &&
      !!at &&
      this.checkinsOf(state).some((k) => k.driverId === driverId && k.merchantId === job.merchantId && k.payMode === "hourly" && k.inAt <= at && (!k.outAt || k.outAt >= at));
    return hourly ? [] : [this.ledgerEntry(driverId, "earning", driverEarning(job.fareFcfa, this.settingsOf(state)), job.id, stationId)];
  }

  /** Ends a check-in (an hourly one gets its amount: hours x rate), as closeCheckin() in worker/merchant-rules.ts. */
  private closeCheckin(state: DemoState, row: DemoCheckin, by: CheckoutBy, at = new Date().toISOString()): DemoState {
    const amount = row.payMode === "hourly" && row.ratePerHourFcfa ? hourlyAmount(row.inAt, at, row.ratePerHourFcfa) : null;
    return withAudit(
      { ...state, merchantCheckins: this.checkinsOf(state).map((k) => (k.id === row.id ? { ...k, outAt: at, outBy: by, amountFcfa: amount } : k)) },
      { table: "merchant_checkins", action: "update", rowId: row.id, userId: row.driverId, changes: { merchant_id: row.merchantId, out_by: by, out_at: at, amount_fcfa: amount } },
    );
  }

  /** Check-ins of an earlier day still open are ended at 23:59:59 of that day, unless the driver is on a trip. */
  private autoCheckouts(state: DemoState, jobs: DemoJob[]): DemoCheckin[] {
    const today = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
    return this.checkinsOf(state).map((k) => {
      if (k.outAt || k.inAt >= today || jobs.some((j) => j.driverId === k.driverId && BUSY_JOB_STATUSES.includes(j.status))) return k;
      const at = endOfDay(k.inAt);
      return { ...k, outAt: at, outBy: "auto" as const, amountFcfa: k.payMode === "hourly" && k.ratePerHourFcfa ? hourlyAmount(k.inAt, at, k.ratePerHourFcfa) : null };
    });
  }

  /** Employees (the merchant not counted) plus open invites: what the limit counts. */
  private merchantUsed(state: DemoState, merchantId: string): number {
    return (
      this.membersOf(state).filter((m) => m.merchantId === merchantId && !m.isOwner).length +
      this.merchantInvitesOf(state).filter((i) => i.merchantId === merchantId && i.status === "pending").length
    );
  }

  private merchantInfo(state: DemoState, m: DemoMerchant, used = this.merchantUsed(state, m.id)): MerchantInfo {
    return {
      id: m.id,
      name: m.name,
      phone: m.phone,
      address: m.address,
      lat: m.lat,
      lng: m.lng,
      status: m.status,
      tier: m.tier,
      employeeLimit: employeeLimit(m.tier),
      used,
      ownerId: m.ownerId,
      createdAt: m.createdAt,
    };
  }

  private viewMerchantInvite(i: DemoMerchantInvite): MerchantInvite {
    return { id: i.id, phone: i.phone, status: i.status, token: i.token, createdAt: i.createdAt, expiresAt: i.expiresAt, decidedAt: i.decidedAt };
  }

  private viewMember(state: DemoState, m: DemoMember): MerchantMember {
    const u = (state.users ?? demoUsers(new Date())).find((x) => x.id === m.userId);
    return { userId: m.userId, fullName: u?.fullName ?? null, phone: u?.phone ?? null, email: u?.email ?? null, isOwner: m.isOwner, since: m.createdAt };
  }

  private viewMerchantDriver(state: DemoState, md: DemoMerchantDriver): MerchantDriver {
    const d = (state.drivers ?? []).find((x) => x.userId === md.driverId);
    const u = (state.users ?? demoUsers(new Date())).find((x) => x.id === md.driverId);
    const v = (state.fleet ?? seedFleet()).find((x) => x.id === d?.vehicleId);
    const here = this.checkinsOf(state).find((k) => k.driverId === md.driverId && k.merchantId === md.merchantId && !k.outAt);
    return {
      id: md.id,
      merchantId: md.merchantId,
      driverId: md.driverId,
      driverName: d?.fullName ?? "",
      driverPhone: u?.phone ?? d?.phone ?? null,
      vehicle: v ? { type: v.type, plate: v.plate } : null,
      kind: md.kind,
      status: md.status,
      payMode: md.payMode,
      ratePerHourFcfa: md.ratePerHourFcfa,
      createdAt: md.createdAt,
      approvedAt: md.approvedAt,
      approvedAs: md.approvedAs,
      endedAt: md.endedAt,
      checkedInSince: md.kind === "assigned" ? (here?.inAt ?? null) : null,
    };
  }

  private viewCheckin(state: DemoState, k: DemoCheckin): MerchantCheckin {
    return {
      id: k.id,
      merchantId: k.merchantId,
      merchantName: this.merchantsOf(state).find((m) => m.id === k.merchantId)?.name ?? "",
      driverId: k.driverId,
      driverName: (state.drivers ?? []).find((d) => d.userId === k.driverId)?.fullName ?? "",
      payMode: k.payMode,
      ratePerHourFcfa: k.ratePerHourFcfa,
      inAt: k.inAt,
      outAt: k.outAt,
      outBy: k.outBy,
      amountFcfa: k.amountFcfa,
      receivedAt: k.receivedAt,
      position: k.outAt ? null : freshPosition(state.driverPositions?.[k.driverId]),
    };
  }

  /** A shop's trip with who of the shop booked it. */
  private viewMerchantJob(state: DemoState, j: DemoJob): MerchantJob {
    const u = j.bookedBy ? (state.users ?? demoUsers(new Date())).find((x) => x.id === j.bookedBy) : null;
    return {
      ...this.viewJob(state, j),
      ...(j.kind === "courier" && j.handoverCode && (j.status === "picked_up" || j.status === "at_door") ? { handoverCode: j.handoverCode } : {}),
      bookedBy: j.bookedBy ? { userId: j.bookedBy, name: u?.fullName ?? u?.phone ?? u?.email ?? null } : null,
    };
  }

  private requireMember(state: DemoState): { profile: Profile; shop: DemoMerchant; isOwner: boolean } {
    const profile = this.requireProfile(state);
    if (profile.role !== "merchant") throw new BackendError("forbidden");
    const member = this.membershipOf(state, profile.id);
    if (!member) throw new BackendError("forbidden");
    return { profile, ...member };
  }

  /** Until an admin approves the shop (and while it is suspended), its functions answer merchant_not_approved. */
  private requireApprovedMember(state: DemoState) {
    const m = this.requireMember(state);
    if (m.shop.status !== "approved") throw new BackendError("merchant_not_approved");
    return m;
  }

  /** The backoffice is the merchant's only (not the employees'). */
  private requireOwner(state: DemoState) {
    const m = this.requireApprovedMember(state);
    if (!m.isOwner) throw new BackendError("forbidden");
    return m;
  }

  /** The shop's details as stored, checked (cleanShop in worker/merchant-rules.ts). */
  private cleanShop(input: Partial<MerchantShopInput> | null | undefined): MerchantShopInput {
    const name = cleanMerchantName(input?.name);
    if (!name) throw new BackendError("unknown", "bad_request");
    const phone = normalizeTogoPhone(String(input?.phone ?? ""));
    if (!phone) throw new BackendError("phone_not_allowed");
    const address = String(input?.address ?? "").trim().replace(/\s+/g, " ");
    if (address.length < 2 || address.length > MERCHANT_ADDRESS_MAX) throw new BackendError("unknown", "bad_request");
    const point = { lat: Number(input?.lat), lng: Number(input?.lng) };
    if (!validPoint(point)) throw new BackendError("unknown", "bad_request");
    if (!inServiceArea(point)) throw new BackendError("outside_area");
    return { name, phone, address, lat: point.lat, lng: point.lng };
  }

  private updateMerchant(state: DemoState, id: string, patch: Partial<DemoMerchant>): DemoState {
    return { ...state, merchants: this.merchantsOf(state).map((m) => (m.id === id ? { ...m, ...patch } : m)) };
  }

  async registerMerchant(contact: string, code: string, pin: string, input: MerchantShopInput): Promise<Profile> {
    if (HOSTED_DEMO) throw new BackendError("forbidden");
    const shop = this.cleanShop(input);
    if (!validPinFormat(pin)) throw new BackendError("bad_pin");
    if (weakPin(pin)) throw new BackendError("weak_pin");
    const state = this.load();
    const users = state.users ?? demoUsers(new Date());
    const isEmail = contact.includes("@");
    if (state.pins?.[contact] !== undefined || users.some((u) => (isEmail ? u.email : u.phone) === contact)) throw new BackendError("account_exists");
    if (code.trim() !== DEMO_CODE) throw new BackendError("invalid_code");
    const now = new Date().toISOString();
    const stamp = Date.now().toString(36);
    const profile: Profile = {
      id: `demo-merchant-${stamp}`,
      phone: isEmail ? null : contact,
      email: isEmail ? contact : null,
      fullName: shop.name,
      role: "merchant",
      ownerOf: [],
    };
    const merchant: DemoMerchant = { id: `merchant-${stamp}`, ownerId: profile.id, ...shop, status: "pending", tier: "standard", createdAt: now, reviewedAt: null };
    let next = withAudit(
      {
        ...state,
        profile,
        pins: { ...state.pins, [contact]: pin },
        users: [{ ...profile, createdAt: now, lastSignInAt: now }, ...users],
        merchants: [merchant, ...this.merchantsOf(state)],
        merchantMembers: [...this.membersOf(state), { userId: profile.id, merchantId: merchant.id, isOwner: true, createdAt: now }],
      },
      { table: "profiles", action: "insert", rowId: profile.id, userId: profile.id, changes: { [isEmail ? "email" : "phone"]: contact, role: "merchant" } },
    );
    next = withAudit(next, { table: "merchants", action: "insert", rowId: merchant.id, userId: profile.id, changes: { merchant_id: merchant.id, name: shop.name, status: "pending", tier: "standard" } });
    this.save(next);
    return this.profileOf(this.load())!;
  }

  async merchantView(): Promise<MerchantView> {
    this.dispatch();
    const state = this.load();
    const { shop, isOwner } = this.requireMember(state);
    const settings = this.settingsOf(state);
    const today: MerchantToday = { booked: 0, running: 0, done: 0, failed: 0, cancelled: 0 };
    const empty = { live: [], members: [], invites: [], drivers: [], checkins: [], unpaid: [], addresses: [] };
    if (shop.status !== "approved") return { merchant: this.merchantInfo(state, shop, 0), isOwner, today, settings, ...empty };
    const jobs = (state.jobs ?? []).filter((j) => j.merchantId === shop.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const running: JobStatus[] = ["open", ...BUSY_JOB_STATUSES];
    const dayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
    for (const j of jobs.filter((x) => x.createdAt >= dayStart)) {
      today.booked++;
      if (j.status === "done") today.done++;
      else if (j.status === "failed") today.failed++;
      else if (j.status === "cancelled") today.cancelled++;
      else today.running++;
    }
    const base = {
      merchant: this.merchantInfo(state, shop),
      isOwner,
      today,
      settings,
      live: jobs.filter((j) => running.includes(j.status)).slice(0, 100).map((j) => this.viewMerchantJob(state, j)),
      addresses: (state.merchantAddresses ?? [])
        .filter((a) => a.merchantId === shop.id)
        .map((a) => ({ id: a.id, label: a.label, address: a.address, phone: a.phone, lat: a.lat, lng: a.lng, createdAt: a.createdAt })),
    };
    if (!isOwner) return { ...base, members: [], invites: [], drivers: [], checkins: [], unpaid: [] };
    const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const checkins = this.checkinsOf(state).filter((k) => k.merchantId === shop.id);
    return {
      ...base,
      members: this.membersOf(state)
        .filter((m) => m.merchantId === shop.id)
        .sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || a.createdAt.localeCompare(b.createdAt))
        .map((m) => this.viewMember(state, m)),
      invites: this.merchantInvitesOf(state)
        .filter((i) => i.merchantId === shop.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 30)
        .map((i) => this.viewMerchantInvite(i)),
      drivers: this.merchantDriversOf(state)
        .filter((md) => md.merchantId === shop.id && (md.status === "pending" || md.status === "active" || md.createdAt > monthAgo))
        .sort((a, b) => a.kind.localeCompare(b.kind) || b.createdAt.localeCompare(a.createdAt))
        .map((md) => this.viewMerchantDriver(state, md)),
      checkins: checkins.filter((k) => !k.outAt).sort((a, b) => a.inAt.localeCompare(b.inAt)).map((k) => this.viewCheckin(state, k)),
      unpaid: checkins
        .filter((k) => k.payMode === "hourly" && k.outAt && !k.receivedAt)
        .sort((a, b) => a.inAt.localeCompare(b.inAt))
        .map((k) => this.viewCheckin(state, k)),
    };
  }

  async merchantBookings(query: MerchantBookingsQuery): Promise<MerchantJob[]> {
    const state = this.load();
    const { shop } = this.requireApprovedMember(state);
    const from = String(query?.from ?? "");
    const to = String(query?.to ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new BackendError("unknown", "bad_request");
    const end = new Date(`${to}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    const start = `${from}T00:00:00.000Z`;
    return (state.jobs ?? [])
      .filter(
        (j) =>
          j.merchantId === shop.id &&
          j.createdAt >= start &&
          j.createdAt < end.toISOString() &&
          (!query.status || j.status === query.status) &&
          (!query.bookedBy || j.bookedBy === query.bookedBy),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 2000)
      .map((j) => this.viewMerchantJob(state, j));
  }

  async merchantStats(query: MerchantStatsQuery): Promise<MerchantStats> {
    const state = this.load();
    const { shop } = this.requireOwner(state);
    if (!hasStatistics(shop.tier)) throw new BackendError("merchant_locked");
    if (!validStatsQuery(query)) throw new BackendError("unknown", "bad_request");
    const start = `${query.from}T00:00:00.000Z`;
    const end = new Date(`${query.to}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    const users = state.users ?? demoUsers(new Date());
    const trips = (state.jobs ?? [])
      .filter((j) => j.merchantId === shop.id && j.createdAt >= start && j.createdAt < end.toISOString())
      .map((j) => {
        const u = j.bookedBy ? users.find((x) => x.id === j.bookedBy) : null;
        return {
          status: j.status,
          fareFcfa: j.fareFcfa,
          createdAt: j.createdAt,
          pickedUpAt: j.pickedUpAt,
          doneAt: j.doneAt,
          bookedBy: j.bookedBy ? { userId: j.bookedBy, name: u?.fullName ?? u?.phone ?? u?.email ?? null } : null,
          driverId: j.driverId,
        };
      });
    const checkins = this.checkinsOf(state)
      .filter((k) => k.merchantId === shop.id && k.outAt && k.outAt >= start && k.outAt < end.toISOString())
      .map((k) => ({
        driverId: k.driverId,
        driverName: (state.drivers ?? []).find((d) => d.userId === k.driverId)?.fullName ?? "",
        payMode: k.payMode,
        inAt: k.inAt,
        outAt: k.outAt!,
        amountFcfa: k.amountFcfa,
      }));
    return merchantStats(query, trips, checkins);
  }

  async addMerchantAddress(input: MerchantAddressInput): Promise<MerchantAddress> {
    const state = this.load();
    const { shop } = this.requireOwner(state);
    const label = cleanAddressLabel(input?.label);
    if (!label) throw new BackendError("unknown", "bad_request");
    const place = this.cleanShop({ ...input, name: label });
    const mine = (state.merchantAddresses ?? []).filter((a) => a.merchantId === shop.id);
    if (mine.length >= MAX_MERCHANT_ADDRESSES) throw new BackendError("address_limit");
    const address: MerchantAddress = {
      id: `address-${Date.now().toString(36)}`,
      label,
      address: place.address,
      phone: place.phone,
      lat: place.lat,
      lng: place.lng,
      createdAt: new Date().toISOString(),
    };
    this.save(
      withAudit(
        { ...state, merchantAddresses: [...(state.merchantAddresses ?? []), { ...address, merchantId: shop.id }] },
        { table: "merchant_addresses", action: "insert", rowId: address.id, changes: { merchant_id: shop.id, label, address: place.address } },
      ),
    );
    return address;
  }

  async removeMerchantAddress(addressId: string) {
    const state = this.load();
    const { shop } = this.requireOwner(state);
    const row = (state.merchantAddresses ?? []).find((a) => a.id === addressId && a.merchantId === shop.id);
    if (!row) throw new BackendError("unknown", "not_found");
    this.save(
      withAudit(
        { ...state, merchantAddresses: (state.merchantAddresses ?? []).filter((a) => a.id !== row.id) },
        { table: "merchant_addresses", action: "delete", rowId: row.id, changes: { merchant_id: shop.id, label: row.label, address: row.address } },
      ),
    );
  }

  /** As receiveShopReturn() in worker/drivers.ts: back at the shop, failed, the driver keeps their share. */
  async confirmShopReturn(jobId: string) {
    const state = this.load();
    const { shop } = this.requireMember(state);
    const job = (state.jobs ?? []).find((j) => j.id === jobId && j.merchantId === shop.id);
    if (!job) throw new BackendError("job_not_found");
    if (job.kind !== "courier" || job.status !== "returning" || !job.driverId) throw new BackendError("job_wrong_status");
    const jobs = this.updateJob(state, job.id, ["returning"], { status: "failed", doneAt: new Date().toISOString() });
    this.saveJobs(
      state,
      jobs,
      { table: "delivery_jobs", action: "update", rowId: job.id, userId: job.driverId, changes: { status: ["returning", "failed"], merchant_id: shop.id, reason: "returned_to_shop" } },
      { ledger: [...this.earning(state, job, job.driverId, null), ...(state.ledger ?? [])] },
    );
  }

  async merchantActivity(): Promise<MerchantActivity[]> {
    const state = this.load();
    const { shop } = this.requireOwner(state);
    const jobIds = new Set((state.jobs ?? []).filter((j) => j.merchantId === shop.id).map((j) => j.id));
    const users = state.users ?? demoUsers(new Date());
    return (state.audit ?? [])
      .filter((a) => a.changes?.merchant_id === shop.id || (a.table === "delivery_jobs" && a.rowId.split(",").some((id) => jobIds.has(id))))
      .slice(0, 300)
      .map((a) => {
        const u = users.find((x) => x.id === a.actorId);
        return { id: a.id, at: a.at, actorName: u?.fullName ?? u?.phone ?? u?.email ?? null, table: a.table, action: a.action, changes: a.changes };
      });
  }

  async updateMerchantShop(input: MerchantShopInput) {
    const state = this.load();
    const { shop } = this.requireOwner(state);
    const next = this.cleanShop(input);
    const changes: Record<string, unknown> = {};
    for (const key of ["name", "phone", "address", "lat", "lng"] as const) {
      if (shop[key] !== next[key]) changes[key] = [shop[key], next[key]];
    }
    if (!Object.keys(changes).length) return;
    this.save(withAudit(this.updateMerchant(state, shop.id, next), { table: "merchants", action: "update", rowId: shop.id, changes: { merchant_id: shop.id, ...changes } }));
  }

  /** R12: a number without an account, or an empty customer account, may be invited (checkInvitable in worker/merchants.ts). */
  private checkMerchantInvitable(state: DemoState, phone: string) {
    const account = (state.users ?? demoUsers(new Date())).find((u) => u.phone === phone);
    if (!account) return;
    const role = this.roleOf(state, account.id);
    if (role === "merchant") throw new BackendError("already_in_merchant");
    if (role !== "customer") throw new BackendError("invite_number_taken");
    if (this.customerThingsOpen(state, account.id, phone)) throw new BackendError("invite_account_not_empty");
  }

  async inviteMerchantEmployee(rawPhone: string): Promise<MerchantInvite> {
    const state = this.load();
    const { shop } = this.requireOwner(state);
    const phone = normalizeTogoPhone(rawPhone ?? "");
    if (!phone) throw new BackendError("phone_not_allowed");
    this.checkMerchantInvitable(state, phone);
    const invites = this.merchantInvitesOf(state);
    if (invites.some((i) => i.merchantId === shop.id && i.phone === phone && i.status === "pending")) throw new BackendError("invite_pending");
    // Decision B: a standard shop has at most 3 employees, open invites included; unlocked: no limit.
    if (shop.tier !== "unlocked" && this.merchantUsed(state, shop.id) >= STANDARD_EMPLOYEE_LIMIT) throw new BackendError("merchant_limit");
    const now = new Date();
    const invite: DemoMerchantInvite = {
      id: crypto.randomUUID(),
      merchantId: shop.id,
      phone,
      status: "pending",
      token: newDriverCode(),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + MERCHANT_INVITE_DAYS * 86_400_000).toISOString(),
      decidedAt: null,
      userId: null,
    };
    this.save(
      withAudit({ ...state, merchantInvites: [invite, ...invites] }, { table: "merchant_invites", action: "insert", rowId: invite.id, changes: { merchant_id: shop.id, phone } }),
    );
    return this.viewMerchantInvite(invite);
  }

  async revokeMerchantInvite(inviteId: string) {
    const state = this.load();
    const { shop } = this.requireOwner(state);
    const invites = this.merchantInvitesOf(state);
    const invite = invites.find((i) => i.id === inviteId);
    if (!invite || invite.status !== "pending" || invite.merchantId !== shop.id) throw new BackendError("invite_not_found");
    const now = new Date().toISOString();
    this.save(
      withAudit(
        { ...state, merchantInvites: invites.map((i) => (i.id === inviteId ? { ...i, status: "revoked" as const, decidedAt: now } : i)) },
        { table: "merchant_invites", action: "update", rowId: inviteId, changes: { merchant_id: shop.id, status: ["pending", "revoked"] } },
      ),
    );
  }

  /** Takes an employee out of a shop: the account becomes a customer account again (releaseMember in worker/merchants.ts). */
  private releaseMember(state: DemoState, memberId: string, merchantId: string): DemoState {
    let next: DemoState = { ...state, merchantMembers: this.membersOf(state).filter((m) => !(m.userId === memberId && m.merchantId === merchantId && !m.isOwner)) };
    if (this.roleOf(next, memberId) === "merchant") next = this.withRole(next, memberId, "customer");
    next = withAudit(next, { table: "merchant_members", action: "delete", rowId: memberId, userId: memberId, changes: { merchant_id: merchantId } });
    return withAudit(next, { table: "profiles", action: "update", rowId: memberId, userId: memberId, changes: { role: ["merchant", "customer"] } });
  }

  async removeMerchantEmployee(userId: string) {
    const state = this.load();
    const { shop } = this.requireOwner(state);
    const member = this.membersOf(state).find((m) => m.userId === userId && m.merchantId === shop.id);
    if (!member) throw new BackendError("unknown", "not_found");
    if (member.isOwner) throw new BackendError("forbidden");
    this.save(this.releaseMember(state, userId, shop.id));
  }

  /** An active driver by driver code (under their QR code) or phone number. */
  private findMerchantDriverAccount(state: DemoState, raw: unknown): DemoDriver {
    const text = String(raw ?? "");
    const phone = normalizeTogoPhone(text);
    const code = phone ? null : parseDriverBadge(text);
    const users = state.users ?? demoUsers(new Date());
    const d = (state.drivers ?? []).find((x) =>
      phone ? (users.find((u) => u.id === x.userId)?.phone ?? x.phone) === phone : !!code && x.code === code,
    );
    if (!this.drives(state, d)) throw new BackendError("driver_not_found");
    return d;
  }

  private cleanPay(payMode: unknown, ratePerHourFcfa: unknown): { mode: MerchantPayMode; rate: number | null } {
    const mode = payMode as MerchantPayMode;
    if (!MERCHANT_PAY_MODES.includes(mode)) throw new BackendError("unknown", "bad_request");
    const rate = cleanRate(mode, ratePerHourFcfa);
    if (rate === undefined) throw new BackendError("unknown", "bad_request");
    return { mode, rate };
  }

  private merchantDriverRow(state: DemoState, id: string): DemoMerchantDriver {
    const row = this.merchantDriversOf(state).find((m) => m.id === id);
    if (!row) throw new BackendError("assignment_not_found");
    return row;
  }

  private withMerchantDriver(state: DemoState, id: string, patch: Partial<DemoMerchantDriver>): DemoState {
    return { ...state, merchantDrivers: this.merchantDriversOf(state).map((m) => (m.id === id ? { ...m, ...patch } : m)) };
  }

  async addMerchantDriver(input: MerchantDriverInput): Promise<MerchantDriver> {
    const state = this.load();
    const { shop } = this.requireOwner(state);
    this.requireDrivers(state);
    const kind = input?.kind;
    if (kind !== "favorite" && kind !== "assigned") throw new BackendError("unknown", "bad_request");
    const pay = kind === "assigned" ? this.cleanPay(input.payMode, input.ratePerHourFcfa) : null;
    const driver = this.findMerchantDriverAccount(state, input.driver);
    const rows = this.merchantDriversOf(state);
    if (rows.some((m) => m.merchantId === shop.id && m.driverId === driver.userId && m.kind === kind && (m.status === "pending" || m.status === "active"))) {
      throw new BackendError("merchant_driver_exists");
    }
    const row: DemoMerchantDriver = {
      id: crypto.randomUUID(),
      merchantId: shop.id,
      driverId: driver.userId,
      kind,
      // Favorites are only told (decision 8); an assignment waits for approval (decision 9).
      status: kind === "favorite" ? "active" : "pending",
      payMode: pay?.mode ?? null,
      ratePerHourFcfa: pay?.rate ?? null,
      createdAt: new Date().toISOString(),
      approvedAt: null,
      approvedAs: null,
      endedAt: null,
    };
    const next = withAudit(
      { ...state, merchantDrivers: [row, ...rows] },
      {
        table: "merchant_drivers",
        action: "insert",
        rowId: row.id,
        userId: driver.userId,
        changes: { merchant_id: shop.id, kind, driver: driver.userId, pay_mode: row.payMode, rate_per_hour_fcfa: row.ratePerHourFcfa },
      },
    );
    this.save(next);
    return this.viewMerchantDriver(next, row);
  }

  async changeMerchantPay(assignmentId: string, payMode: MerchantPayMode, ratePerHourFcfa: number | null) {
    const state = this.load();
    const { shop } = this.requireOwner(state);
    const row = this.merchantDriverRow(state, assignmentId);
    if (row.merchantId !== shop.id || row.kind !== "assigned" || !["pending", "active"].includes(row.status)) throw new BackendError("assignment_not_found");
    const pay = this.cleanPay(payMode, ratePerHourFcfa);
    if (this.openCheckin(state, row.driverId)?.merchantId === shop.id) throw new BackendError("driver_checked_in_here");
    if (pay.mode === row.payMode && pay.rate === row.ratePerHourFcfa) return;
    this.save(
      withAudit(this.withMerchantDriver(state, row.id, { payMode: pay.mode, ratePerHourFcfa: pay.rate, status: "pending", approvedAt: null, approvedAs: null }), {
        table: "merchant_drivers",
        action: "update",
        rowId: row.id,
        userId: row.driverId,
        changes: { merchant_id: shop.id, pay_mode: [row.payMode, pay.mode], rate_per_hour_fcfa: [row.ratePerHourFcfa, pay.rate], status: [row.status, "pending"] },
      }),
    );
  }

  async endMerchantDriver(assignmentId: string) {
    const state = this.load();
    const profile = this.requireProfile(state);
    if (profile.role !== "admin" && profile.role !== "driver" && profile.role !== "merchant") throw new BackendError("forbidden");
    const row = this.merchantDriverRow(state, assignmentId);
    if (!["pending", "active"].includes(row.status)) throw new BackendError("assignment_not_found");
    let by: "merchant" | "driver" | "admin";
    if (profile.role === "admin") by = "admin";
    else if (profile.role === "driver" && profile.id === row.driverId) by = "driver";
    else {
      const { shop } = this.requireOwner(state);
      if (shop.id !== row.merchantId) throw new BackendError("assignment_not_found");
      by = "merchant";
    }
    const checkin = row.kind === "assigned" ? this.openCheckin(state, row.driverId) : null;
    const here = checkin && checkin.merchantId === row.merchantId ? checkin : null;
    if (here && this.busyJob(state, row.driverId)) throw new BackendError("driver_busy");
    const now = new Date().toISOString();
    let next = withAudit(this.withMerchantDriver(state, row.id, { status: "ended", endedAt: now }), {
      table: "merchant_drivers",
      action: "update",
      rowId: row.id,
      userId: row.driverId,
      changes: { merchant_id: row.merchantId, status: [row.status, "ended"], by },
    });
    if (here) next = this.closeCheckin(next, here, by, now);
    this.save(next);
  }

  async merchantCheckout(driverId: string) {
    const state = this.load();
    const { shop } = this.requireOwner(state);
    const checkin = this.openCheckin(state, driverId);
    if (!checkin || checkin.merchantId !== shop.id) throw new BackendError("not_assigned");
    if (this.busyJob(state, driverId)) throw new BackendError("driver_busy");
    this.save(this.closeCheckin(state, checkin, "merchant"));
  }

  async myMerchantInvites(): Promise<MyMerchantInvite[]> {
    const state = this.load();
    const profile = state.profile;
    if (!profile?.phone || profile.role !== "customer") return [];
    const shops = this.merchantsOf(state);
    return this.merchantInvitesOf(state)
      .filter((i) => i.phone === profile.phone && i.status === "pending" && shops.find((m) => m.id === i.merchantId)?.status === "approved")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((i) => ({ token: i.token, merchantName: shops.find((m) => m.id === i.merchantId)!.name, expiresAt: i.expiresAt }));
  }

  private merchantInviteForMe(state: DemoState, profile: Profile, token: string): DemoMerchantInvite {
    const invite = this.merchantInvitesOf(state).find((i) => i.token === String(token ?? "").trim().toUpperCase());
    if (!invite || invite.status !== "pending" || !profile.phone || invite.phone !== profile.phone) throw new BackendError("invite_not_found");
    return invite;
  }

  async acceptMerchantInvite(token: string) {
    const state = this.load();
    const profile = this.requireProfile(state);
    const invite = this.merchantInviteForMe(state, profile, token);
    if (profile.role !== "customer") throw new BackendError("has_other_role");
    const shop = this.merchantsOf(state).find((m) => m.id === invite.merchantId);
    if (!shop || shop.status !== "approved") throw new BackendError("invite_not_found");
    if (this.customerThingsOpen(state, profile.id, profile.phone)) throw new BackendError("invite_account_not_empty");
    if (this.membershipOf(state, profile.id)) throw new BackendError("already_in_merchant");
    const now = new Date().toISOString();
    const invites = this.merchantInvitesOf(state).map((i) =>
      i.id === invite.id
        ? { ...i, status: "accepted" as const, decidedAt: now, userId: profile.id }
        : i.phone === invite.phone && i.status === "pending"
          ? { ...i, status: "expired" as const, decidedAt: now }
          : i,
    );
    let next = withAudit(
      {
        ...this.withRole(state, profile.id, "merchant"),
        merchantInvites: invites,
        merchantMembers: [...this.membersOf(state), { userId: profile.id, merchantId: shop.id, isOwner: false, createdAt: now }],
      },
      { table: "merchant_invites", action: "update", rowId: invite.id, userId: profile.id, changes: { merchant_id: shop.id, status: ["pending", "accepted"] } },
    );
    next = withAudit(next, { table: "merchant_members", action: "insert", rowId: profile.id, userId: profile.id, changes: { merchant_id: shop.id, invite: invite.id } });
    this.save(withAudit(next, { table: "profiles", action: "update", rowId: profile.id, userId: profile.id, changes: { role: ["customer", "merchant"] } }));
  }

  async declineMerchantInvite(token: string) {
    const state = this.load();
    const profile = this.requireProfile(state);
    const invite = this.merchantInviteForMe(state, profile, token);
    const now = new Date().toISOString();
    this.save(
      withAudit(
        { ...state, merchantInvites: this.merchantInvitesOf(state).map((i) => (i.id === invite.id ? { ...i, status: "declined" as const, decidedAt: now, userId: profile.id } : i)) },
        { table: "merchant_invites", action: "update", rowId: invite.id, userId: profile.id, changes: { merchant_id: invite.merchantId, status: ["pending", "declined"] } },
      ),
    );
  }

  async merchantAssignmentRequests(): Promise<MerchantAssignmentRequest[]> {
    const state = this.load();
    const profile = this.requireProfile(state);
    let mine: (md: DemoMerchantDriver) => boolean;
    if (profile.role === "admin") mine = () => true;
    else if (profile.role === "driver") mine = (md) => md.driverId === profile.id;
    else if (profile.role === "fleet_manager") {
      const drivers = new Set((state.fleetLinks ?? []).filter((l) => l.managerId === profile.id).map((l) => l.driverId));
      mine = (md) => drivers.has(md.driverId);
    } else throw new BackendError("forbidden");
    const shops = this.merchantsOf(state);
    return this.merchantDriversOf(state)
      .filter((md) => md.kind === "assigned" && md.status === "pending" && shops.find((m) => m.id === md.merchantId)?.status === "approved" && mine(md))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((md) => {
        const shop = shops.find((m) => m.id === md.merchantId)!;
        return {
          id: md.id,
          merchantId: shop.id,
          merchantName: shop.name,
          merchantAddress: shop.address,
          driverId: md.driverId,
          driverName: (state.drivers ?? []).find((d) => d.userId === md.driverId)?.fullName ?? "",
          payMode: md.payMode!,
          ratePerHourFcfa: md.ratePerHourFcfa,
          createdAt: md.createdAt,
        };
      });
  }

  async decideMerchantAssignment(assignmentId: string, approve: boolean) {
    const state = this.load();
    const profile = this.requireProfile(state);
    if (profile.role !== "admin" && profile.role !== "driver" && profile.role !== "fleet_manager") throw new BackendError("forbidden");
    const row = this.merchantDriverRow(state, assignmentId);
    if (row.kind !== "assigned" || row.status !== "pending") throw new BackendError("assignment_not_found");
    let as: MerchantApprover;
    if (profile.role === "admin") as = "admin";
    else if (profile.role === "driver" && profile.id === row.driverId) as = "driver";
    else if (profile.role === "fleet_manager" && (state.fleetLinks ?? []).some((l) => l.driverId === row.driverId && l.managerId === profile.id)) as = "fleet_manager";
    else throw new BackendError("assignment_not_found");
    if (this.merchantsOf(state).find((m) => m.id === row.merchantId)?.status !== "approved") throw new BackendError("merchant_not_approved");
    const status: MerchantDriverStatus = approve ? "active" : "declined";
    this.save(
      withAudit(this.withMerchantDriver(state, row.id, { status, approvedAt: new Date().toISOString(), approvedAs: as }), {
        table: "merchant_drivers",
        action: "update",
        rowId: row.id,
        userId: row.driverId,
        changes: { merchant_id: row.merchantId, status: ["pending", status], as, pay_mode: row.payMode, rate_per_hour_fcfa: row.ratePerHourFcfa },
      }),
    );
  }

  async driverShops(): Promise<DriverShops> {
    this.dispatch();
    const state = this.load();
    const { profile } = this.demoDriver(state);
    const shops = this.merchantsOf(state);
    const approved = (id: string) => shops.find((m) => m.id === id && m.status === "approved");
    const mine = this.merchantDriversOf(state).filter((md) => md.driverId === profile.id && approved(md.merchantId));
    const checkins = this.checkinsOf(state).filter((k) => k.driverId === profile.id);
    const open = checkins.find((k) => !k.outAt);
    return {
      assignments: mine
        .filter((md) => md.kind === "assigned" && (md.status === "pending" || md.status === "active"))
        .map((md) => {
          const shop = approved(md.merchantId)!;
          return { ...this.viewMerchantDriver(state, md), merchantName: shop.name, merchantAddress: shop.address, merchantLat: shop.lat, merchantLng: shop.lng };
        })
        .sort((a, b) => a.merchantName.localeCompare(b.merchantName)),
      favoriteOf: mine
        .filter((md) => md.kind === "favorite" && md.status === "active")
        .map((md) => ({ merchantId: md.merchantId, merchantName: approved(md.merchantId)!.name }))
        .sort((a, b) => a.merchantName.localeCompare(b.merchantName)),
      checkin: open ? this.viewCheckin(state, open) : null,
      unpaid: checkins
        .filter((k) => k.payMode === "hourly" && k.outAt && !k.receivedAt)
        .sort((a, b) => a.inAt.localeCompare(b.inAt))
        .map((k) => this.viewCheckin(state, k)),
    };
  }

  /**
   * "Je suis chez <shop>": with an approved assignment, close to the shop (decision 12), not on a
   * trip and below the cash limit. The driver leaves any station queue. One check-in at a time.
   */
  async checkInAtShop(merchantId: string, position: LatLng) {
    const state = this.load();
    const { driver } = this.demoDriver(state);
    this.requireDrivers(state);
    const vehicle = (state.fleet ?? seedFleet()).find((v) => v.id === driver.vehicleId);
    if (!vehicle?.isActive) throw new BackendError("no_vehicle");
    const link = this.merchantDriversOf(state).find((md) => md.merchantId === merchantId && md.driverId === driver.userId && md.kind === "assigned" && md.status === "active");
    const shop = this.merchantsOf(state).find((m) => m.id === merchantId);
    if (!link || !shop) throw new BackendError("not_assigned");
    if (shop.status !== "approved") throw new BackendError("merchant_not_approved");
    if (this.openCheckin(state, driver.userId)) throw new BackendError("checked_in_at_shop");
    if (this.busyJob(state, driver.userId)) throw new BackendError("driver_busy");
    if (this.balanceOfDriver(state, driver.userId) >= this.settingsOf(state).cashLimitFcfa) throw new BackendError("cash_limit");
    if (!position || typeof position.lat !== "number" || typeof position.lng !== "number" || !nearShop(position, shop)) throw new BackendError("too_far");
    const checkin: DemoCheckin = {
      id: crypto.randomUUID(),
      merchantId: shop.id,
      driverId: driver.userId,
      assignmentId: link.id,
      payMode: link.payMode ?? "per_trip",
      ratePerHourFcfa: link.ratePerHourFcfa,
      inAt: new Date().toISOString(),
      outAt: null,
      outBy: null,
      amountFcfa: null,
      receivedAt: null,
    };
    this.save(
      withAudit(
        { ...state, merchantCheckins: [checkin, ...this.checkinsOf(state)], driverQueue: (state.driverQueue ?? []).filter((q) => q.driverId !== driver.userId) },
        {
          table: "merchant_checkins",
          action: "insert",
          rowId: checkin.id,
          userId: driver.userId,
          changes: { merchant_id: shop.id, pay_mode: checkin.payMode, rate_per_hour_fcfa: checkin.ratePerHourFcfa },
        },
      ),
    );
    this.dispatch();
  }

  async checkOutOfShop() {
    const state = this.load();
    const { driver } = this.demoDriver(state);
    const checkin = this.openCheckin(state, driver.userId);
    if (!checkin) return;
    if (this.busyJob(state, driver.userId)) throw new BackendError("driver_busy");
    this.save(this.closeCheckin(state, checkin, "driver"));
  }

  async confirmShopHoursReceived(checkinId: string) {
    const state = this.load();
    const { driver } = this.demoDriver(state);
    const row = this.checkinsOf(state).find((k) => k.id === checkinId);
    if (!row || row.driverId !== driver.userId || row.payMode !== "hourly" || !row.outAt || row.receivedAt) throw new BackendError("unknown", "not_found");
    this.save(
      withAudit(
        { ...state, merchantCheckins: this.checkinsOf(state).map((k) => (k.id === row.id ? { ...k, receivedAt: new Date().toISOString() } : k)) },
        { table: "merchant_checkins", action: "update", rowId: row.id, userId: driver.userId, changes: { merchant_id: row.merchantId, received: row.amountFcfa } },
      ),
    );
  }

  async adminMerchants(): Promise<AdminMerchant[]> {
    const state = this.load();
    this.requireAdmin(state);
    const users = state.users ?? demoUsers(new Date());
    const order: Record<MerchantStatus, number> = { pending: 0, approved: 1, suspended: 2, rejected: 3 };
    const invites = this.merchantInvitesOf(state);
    return [...this.merchantsOf(state)]
      .sort((a, b) => order[a.status] - order[b.status] || b.createdAt.localeCompare(a.createdAt))
      .map((m) => {
        const owner = users.find((u) => u.id === m.ownerId);
        return {
          ...this.merchantInfo(state, m),
          contact: owner?.phone ?? owner?.email ?? null,
          reviewedAt: m.reviewedAt,
          members: this.membersOf(state)
            .filter((x) => x.merchantId === m.id)
            .sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || a.createdAt.localeCompare(b.createdAt))
            .map((x) => this.viewMember(state, x)),
          invites: invites.filter((i) => i.merchantId === m.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((i) => this.viewMerchantInvite(i)),
          drivers: this.merchantDriversOf(state)
            .filter((md) => md.merchantId === m.id && (md.status === "pending" || md.status === "active"))
            .sort((a, b) => a.kind.localeCompare(b.kind) || b.createdAt.localeCompare(a.createdAt))
            .map((md) => this.viewMerchantDriver(state, md)),
        };
      });
  }

  /**
   * Approves, rejects (pending only), suspends or reactivates a shop. Suspending checks its
   * drivers out and calls off its trips whose driver has nothing yet; trips under way finish.
   */
  async reviewMerchant(merchantId: string, action: MerchantDecision) {
    const state = this.load();
    this.requireAdmin(state);
    const shop = this.merchantsOf(state).find((m) => m.id === merchantId);
    if (!shop) throw new BackendError("unknown", "not_found");
    const allowed: Record<MerchantDecision, MerchantStatus[]> = {
      approve: ["pending", "rejected"],
      reject: ["pending"],
      suspend: ["approved"],
      reactivate: ["suspended"],
    };
    const target: Record<MerchantDecision, MerchantStatus> = { approve: "approved", reject: "rejected", suspend: "suspended", reactivate: "approved" };
    if (!allowed[action]) throw new BackendError("unknown", "bad_request");
    if (!allowed[action].includes(shop.status)) throw new BackendError("forbidden");
    const status = target[action];
    const now = new Date().toISOString();
    let next = withAudit(this.updateMerchant(state, shop.id, { status, reviewedAt: now }), {
      table: "merchants",
      action: "update",
      rowId: shop.id,
      userId: shop.ownerId,
      changes: { merchant_id: shop.id, status: [shop.status, status] },
    });
    if (action === "suspend") {
      for (const k of this.checkinsOf(next).filter((x) => x.merchantId === shop.id && !x.outAt)) next = this.closeCheckin(next, k, "admin", now);
    }
    this.save(next);
    if (action === "suspend") this.cancelJobs(this.load(), (j) => j.merchantId === shop.id);
  }

  async setMerchantTier(merchantId: string, tier: MerchantTier) {
    const state = this.load();
    this.requireAdmin(state);
    if (!MERCHANT_TIERS.includes(tier)) throw new BackendError("unknown", "bad_request");
    const shop = this.merchantsOf(state).find((m) => m.id === merchantId);
    if (!shop) throw new BackendError("unknown", "not_found");
    if (shop.tier === tier) return;
    this.save(
      withAudit(this.updateMerchant(state, shop.id, { tier }), {
        table: "merchants",
        action: "update",
        rowId: shop.id,
        userId: shop.ownerId,
        changes: { merchant_id: shop.id, tier: [shop.tier, tier] },
      }),
    );
  }

  /** An admin makes another member of the shop its merchant (the former merchant stays as an employee). */
  async setMerchantOwner(merchantId: string, userId: string) {
    const state = this.load();
    this.requireAdmin(state);
    const shop = this.merchantsOf(state).find((m) => m.id === merchantId);
    if (!shop) throw new BackendError("unknown", "not_found");
    if (shop.ownerId === userId) return;
    const members = this.membersOf(state);
    if (!members.some((m) => m.userId === userId && m.merchantId === shop.id)) throw new BackendError("unknown", "not_found");
    this.save(
      withAudit(
        {
          ...this.updateMerchant(state, shop.id, { ownerId: userId }),
          merchantMembers: members.map((m) => (m.merchantId === shop.id ? { ...m, isOwner: m.userId === userId } : m)),
        },
        { table: "merchants", action: "update", rowId: shop.id, userId, changes: { merchant_id: shop.id, owner_id: [shop.ownerId, userId] } },
      ),
    );
  }

  async adminRemoveMerchantEmployee(merchantId: string, userId: string) {
    const state = this.load();
    this.requireAdmin(state);
    const member = this.membersOf(state).find((m) => m.userId === userId && m.merchantId === merchantId);
    if (!member) throw new BackendError("unknown", "not_found");
    if (member.isOwner) throw new BackendError("forbidden");
    this.save(this.releaseMember(state, userId, merchantId));
  }

  async setFleetTier(managerId: string, tier: FleetTier) {
    const state = this.load();
    this.requireAdmin(state);
    if (!FLEET_TIERS.includes(tier)) throw new BackendError("unknown", "bad_request");
    const fleets = this.fleetsOf(state);
    const fleet = fleets.find((f) => f.managerId === managerId);
    if (!fleet) throw new BackendError("unknown", "not_found");
    if (fleet.tier === tier) return;
    this.save(
      withAudit(
        { ...state, fleets: fleets.map((f) => (f.managerId === managerId ? { ...f, tier } : f)) },
        { table: "fleets", action: "update", rowId: managerId, userId: managerId, changes: { tier: [fleet.tier, tier] } },
      ),
    );
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
    this.refuseNonCustomer(profile);
    if (!demoFeatures(state).wallet || (!this.wallet(state).enabled && profile.role !== "admin")) throw new BackendError("wallet_disabled");
    return profile;
  }

  private findWalletUser(state: DemoState, contact: string): AdminUser {
    const parsed = parseContact(contact);
    if (!parsed) throw new BackendError(contact.includes("@") ? "invalid_contact" : "phone_not_allowed");
    const user = (state.users ?? demoUsers(new Date())).find((u) => (parsed.kind === "phone" ? u.phone : u.email) === parsed.value);
    if (!user) throw new BackendError("recipient_not_found");
    return user;
  }

  /** A wallet transfer goes to a customer only: driver and fleet manager accounts have no wallet (R11). */
  private findWalletRecipientUser(state: DemoState, contact: string): AdminUser {
    const user = this.findWalletUser(state, contact);
    if (user.role === "driver" || user.role === "fleet_manager") throw new BackendError("not_a_customer");
    return user;
  }

  private creditStations(state: DemoState): string[] {
    return this.wallet(state).creditStations ?? state.stations.map((x) => x.id);
  }

  /** As isCreditStation() in worker/wallet.ts. */
  isDemoCreditStation(state: DemoState, stationId: string): boolean {
    return this.creditStations(state).includes(stationId);
  }

  private creditMax(state: DemoState): number {
    return this.wallet(state).maxXof ?? DEMO_CREDIT_MAX;
  }

  async myWallet(): Promise<WalletView> {
    const state = this.load();
    const profile = this.walletAccess(state);
    const w = this.wallet(state);
    const ids = new Set(this.creditStations(state));
    return {
      enabled: w.enabled,
      testMode: !w.enabled,
      balanceXof: this.balance(w, profile.id),
      frozen: w.frozen.includes(profile.id),
      maxXof: this.creditMax(state),
      stations: state.stations.filter((x) => ids.has(x.id)).map((x) => ({ id: x.id, name: x.name })),
      transactions: w.transactions.filter((t) => t.userId === profile.id).slice(0, 50),
    };
  }

  /** As createCreditCode() in worker/wallet.ts; the demo PIN is any valid one. */
  async createCreditCode(pin: string): Promise<CreditCode> {
    const state = this.load();
    const profile = this.walletAccess(state);
    if (!/^\d{4}$/.test(pin)) throw new BackendError("invalid_pin");
    const w = this.wallet(state);
    const code = String(Math.floor(Math.random() * 100_000_000)).padStart(8, "0");
    const expiresAt = new Date(Date.now() + CREDIT_CODE_MINUTES * 60_000).toISOString();
    const codes = [...(w.codes ?? []).filter((c) => c.userId !== profile.id && c.expiresAt > new Date().toISOString()), { code, userId: profile.id, expiresAt, used: false }];
    this.save({ ...state, wallet: { ...w, codes } });
    return { code, expiresAt };
  }

  private creditCodeOwner(state: DemoState, raw: string): AdminUser {
    const code = parseCreditCode(raw);
    const found = code && (this.wallet(state).codes ?? []).find((c) => c.code === code && !c.used && c.expiresAt > new Date().toISOString());
    const user = found && (state.users ?? demoUsers(new Date())).find((u) => u.id === found.userId);
    if (!user) throw new BackendError("credit_code_invalid");
    if (this.wallet(state).frozen.includes(user.id)) throw new BackendError("wallet_frozen");
    return user;
  }

  private useCreditCode(w: DemoWallet, raw: string): DemoWallet {
    const code = parseCreditCode(raw);
    return { ...w, codes: (w.codes ?? []).map((c) => (c.code === code ? { ...c, used: true } : c)) };
  }

  async checkCreditCode(stationId: string, code: string): Promise<CounterCredit> {
    const state = this.load();
    this.stationActor(state, stationId);
    if (!this.isDemoCreditStation(state, stationId)) throw new BackendError("credit_not_accepted");
    const user = this.creditCodeOwner(state, code);
    const balance = this.balance(this.wallet(state), user.id);
    return { customer: personLabel(user), balanceXof: balance, maxTopupXof: maxTopup(balance, this.creditMax(state)) };
  }

  /** As topUpCredit() in worker/wallet.ts: the cash goes into the station's takings. */
  async topUpCredit(stationId: string, input: CreditTopupInput): Promise<CreditTopupResult> {
    const state = this.load();
    const actor = this.stationActor(state, stationId);
    if (!this.isDemoCreditStation(state, stationId)) throw new BackendError("credit_not_accepted");
    const amount = parseAmount(input.amountXof);
    if (amount === null || amount < CREDIT_TOPUP_MIN_XOF) throw new BackendError("invalid_amount");
    const user = this.creditCodeOwner(state, input.code);
    if (user.id === actor.profile.id) throw new BackendError("own_reservation");
    const w = this.wallet(state);
    const before = this.balance(w, user.id);
    const limit = maxTopup(before, this.creditMax(state));
    if (limit !== null && amount > limit) throw new BackendError("credit_limit_reached");
    const station = state.stations.find((x) => x.id === stationId);
    const tx: DemoWallet["transactions"][number] = {
      id: crypto.randomUUID(),
      trxId: newTrxId("topup"),
      type: "topup",
      attribute: "received",
      status: "success",
      amountXof: amount,
      feeXof: 0,
      totalXof: amount,
      balanceAfterXof: before + amount,
      counterparty: station?.name ?? null,
      remark: null,
      createdAt: new Date().toISOString(),
      userId: user.id,
      userLabel: [user.fullName, user.phone ?? user.email].filter(Boolean).join(" · "),
      adminId: null,
      stationId,
      staffId: actor.profile.id,
    };
    const used = this.useCreditCode(w, input.code);
    this.save({ ...state, wallet: { ...used, balances: { ...w.balances, [user.id]: before + amount }, transactions: [tx, ...w.transactions].slice(0, 500) } });
    return { customer: personLabel(user), amountXof: amount, balanceXof: before + amount };
  }

  async adminWallet(filter: { type?: string; userId?: string } = {}): Promise<AdminWallet> {
    const state = this.load();
    this.requireAdmin(state);
    const w = this.wallet(state);
    const users = state.users ?? demoUsers(new Date());
    const ids = new Set([...users.map((u) => u.id), ...Object.keys(w.balances)]);
    const credit = new Set(this.creditStations(state));
    return {
      enabled: w.enabled,
      maxXof: this.creditMax(state),
      stations: state.stations.map((x) => ({ id: x.id, name: x.name, greenCredit: credit.has(x.id) })),
      totals: {
        balancesXof: [...ids].reduce((n, id) => n + this.balance(w, id), 0),
        wallets: ids.size,
        toppedUpXof: w.transactions.filter((t) => t.type === "topup" && t.stationId).reduce((n, t) => n + t.amountXof, 0),
        transactions: new Set(w.transactions.map((t) => t.trxId)).size,
      },
      transactions: w.transactions
        .filter((t) => (!filter.type || t.type === filter.type) && (!filter.userId || t.userId === filter.userId))
        .map((t) => {
          const copy = { ...t };
          delete copy.key;
          delete copy.stationId;
          return copy;
        }),
    };
  }

  async features(): Promise<Features> {
    return demoFeatures(this.load());
  }

  async setDriversEnabled(enabled: boolean) {
    const state = this.load();
    this.requireAdmin(state);
    this.save(withAudit({ ...state, driversEnabled: enabled }, { table: "drivers", action: "update", rowId: "drivers_enabled", changes: { enabled } }));
  }

  private requireDrivers(state: DemoState) {
    if (!demoFeatures(state).drivers) throw new BackendError("drivers_soon");
  }

  async setParcelsEnabled(enabled: boolean) {
    const state = this.load();
    this.requireAdmin(state);
    this.save(withAudit({ ...state, parcelsEnabled: enabled }, { table: "parcels", action: "update", rowId: "parcels_enabled", changes: { enabled } }));
  }

  async setLiteEnabled(enabled: boolean) {
    const state = this.load();
    this.requireAdmin(state);
    this.save(withAudit({ ...state, liteEnabled: enabled }, { table: "settings", action: "update", rowId: "lite_mode", changes: { enabled } }));
  }

  async setWalletEnabled(enabled: boolean) {
    const state = this.load();
    this.requireAdmin(state);
    this.save(
      withAudit({ ...state, wallet: { ...this.wallet(state), enabled } }, { table: "wallets", action: "update", rowId: "wallet_enabled", changes: { enabled } }),
    );
  }

  async setCreditMax(maxXof: number) {
    const state = this.load();
    this.requireAdmin(state);
    if (!Number.isInteger(maxXof) || maxXof < 0 || maxXof > 10_000_000) throw new BackendError("unknown", "bad_request");
    this.save(withAudit({ ...state, wallet: { ...this.wallet(state), maxXof } }, { table: "wallets", action: "update", rowId: "green_credit_max_xof", changes: { maxXof } }));
  }

  async setStationGreenCredit(stationId: string, enabled: boolean) {
    const state = this.load();
    this.requireAdmin(state);
    if (!state.stations.some((x) => x.id === stationId)) throw new BackendError("unknown", "not_found");
    const list = this.creditStations(state).filter((id) => id !== stationId);
    this.save(
      withAudit(
        { ...state, wallet: { ...this.wallet(state), creditStations: enabled ? [...list, stationId] : list } },
        { table: "stations", action: "update", rowId: stationId, stationId, changes: { green_credit: enabled } },
      ),
    );
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
      // W10: a driver earns no greenpoints; the CO2 counts for the fleet.
      points: 0,
      vehicle: null,
      stationName: state.stations.find((s) => s.id === stationId)?.name ?? null,
      rewardTitle: null,
      createdAt: new Date().toISOString(),
    };
    return { ...g, ledger: [entry, ...g.ledger].slice(0, 500) };
  }

  /** Adds a swap or charge to the ledger, only for an app customer at a solar station below the daily limit (as earnStatement in the Worker). */
  private earn(
    state: DemoState,
    input: { userId: string; type: ReservationType; stationId: string; reservationId: string | null; vehicle?: VehicleType },
  ): DemoState {
    if (!state.stations.find((s) => s.id === input.stationId)?.isSolar) return state;
    // Only customers who have the app (signed in at least once), as hasApp in the Worker.
    const account = (state.users ?? demoUsers(new Date())).find((u) => u.id === input.userId);
    if (state.profile?.id !== input.userId && !account?.lastSignInAt) return state;
    const g = this.gp(state);
    const today = dayStart();
    const earnedToday = g.ledger.filter((l) => l.userId === input.userId && l.points > 0 && l.kind !== "admin_adjust" && l.createdAt >= today).length;
    if (earnedToday >= MAX_EARNINGS_PER_DAY) return state;
    // W10: driver accounts earn no greenpoints, nor fleet managers (W5).
    if (this.roleOf(state, input.userId) === "driver" || this.roleOf(state, input.userId) === "fleet_manager") return state;
    // Station staff have no greenpoints.
    if (this.isStationStaff(state, input.userId)) return state;
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

  private isStationStaff(state: DemoState, userId: string): boolean {
    const user = state.profile?.id === userId ? state.profile : (state.users ?? []).find((u) => u.id === userId);
    return user?.role === "operator";
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
    if (profile.role === "operator" || profile.role === "driver" || profile.role === "fleet_manager") throw new BackendError("forbidden");
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
    if (profile.role === "operator" || profile.role === "driver" || profile.role === "fleet_manager") throw new BackendError("forbidden");
    const g = this.gp(state);
    this.save({ ...state, greenpoint: { ...g, vehicles: { ...g.vehicles, [profile.id]: vehicle } } });
  }

  async startRedemption(rewardId: string): Promise<GreenpointRedemption> {
    const state = this.load();
    const profile = this.requireProfile(state);
    if (profile.role === "operator" || profile.role === "driver" || profile.role === "fleet_manager") throw new BackendError("forbidden");
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

  async confirmRedemption(stationId: string, code: string): Promise<GreenpointReceipt> {
    const state = this.load();
    const profile = this.stationActor(state, stationId).profile;
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

  // Charging at a socket ----------------------------------------------------------------

  private chargeTariffOf(state: DemoState, stationId: string, ev = false): ChargeTariff {
    const base = ev ? (state.evTariff ?? DEFAULT_EV_TARIFF) : (state.chargeTariff ?? DEFAULT_CHARGE_TARIFF);
    const own = (ev ? state.stationEvTariffs : state.stationTariffs)?.[stationId];
    return { kwhXof: own?.kwhXof ?? base.kwhXof, minXof: own?.minXof ?? base.minXof };
  }

  /** As EV_OF_POINT in worker/charging.ts: the active car charger this outlet switches, if any. */
  private evOfPoint(state: DemoState, pointId: string): EvCharger | undefined {
    return (state.evChargers ?? DEMO_EV_CHARGERS).find((c) => c.pointId === pointId && c.isActive);
  }

  /** A running demo charge gains energy with time; the price follows. */
  private chargeView(c: DemoCharge, now = Date.now()): ChargeSession {
    const { userId: _userId, pointId: _pointId, startedBy: _startedBy, partnerId: _partnerId, ...rest } = c;
    const view: ChargeSession = c.userId && c.startedBy === c.userId ? { ...rest, selfStarted: true } : rest;
    if (c.status !== "charging") return view;
    const energyWh = Math.round(((now - new Date(c.startedAt).getTime()) / 3_600_000) * DEMO_CHARGE_WATTS);
    const amountXof = chargePrice(energyWh, c.tariff);
    return { ...view, energyWh, powerWatts: DEMO_CHARGE_WATTS, amountXof: c.creditLimitXof !== undefined ? Math.min(amountXof, c.creditLimitXof) : amountXof };
  }

  /**
   * As creditStops() and settlePrepaidCharges() in worker/charging.ts: a Green Credit charge stops
   * once it cost the credit it started with, and an ended one is taken from the credit at once.
   */
  private settleDemoCredit() {
    let state = this.load();
    const now = Date.now();
    let changed = false;
    for (const c of state.charges ?? []) {
      if (c.creditLimitXof === undefined || !c.userId) continue;
      let next: DemoCharge = c;
      if (c.status === "charging") {
        const energyWh = Math.round(((now - new Date(c.startedAt).getTime()) / 3_600_000) * DEMO_CHARGE_WATTS);
        if (chargePrice(energyWh, c.tariff) < c.creditLimitXof) continue;
        next = { ...c, status: "stopped", energyWh, amountXof: c.creditLimitXof, powerWatts: 0, stoppedAt: new Date(now).toISOString(), endedByDevice: true };
      }
      if (next.status !== "stopped") continue;
      changed = true;
      state = { ...state, charges: (state.charges ?? []).map((x) => (x.id === c.id ? next : x)) };
      if (next.energyWh <= 0) {
        state = { ...state, charges: state.charges!.map((x) => (x.id === c.id ? { ...x, status: "cancelled" as const } : x)) };
        continue;
      }
      const w = this.wallet(state);
      const before = this.balance(w, c.userId);
      const amount = Math.max(0, Math.min(next.amountXof, before));
      state = this.payCharge(state, c.id, "wallet");
      state = { ...state, charges: state.charges!.map((x) => (x.id === c.id ? { ...x, amountXof: amount } : x)) };
      const user = (state.users ?? demoUsers(new Date())).find((u) => u.id === c.userId) ?? state.profile;
      const tx: DemoWallet["transactions"][number] = {
        id: crypto.randomUUID(),
        trxId: newTrxId("charge"),
        type: "charge",
        attribute: "send",
        status: "success",
        amountXof: amount,
        feeXof: 0,
        totalXof: amount,
        balanceAfterXof: before - amount,
        counterparty: c.stationName,
        remark: null,
        createdAt: new Date(now).toISOString(),
        userId: c.userId,
        userLabel: user ? [user.fullName, user.phone ?? user.email].filter(Boolean).join(" · ") : null,
        adminId: null,
        stationId: c.stationId,
      };
      state = { ...state, wallet: { ...w, balances: { ...w.balances, [c.userId]: before - amount }, transactions: [tx, ...w.transactions].slice(0, 500) } };
    }
    if (changed) this.save(state);
  }

  private updateCharge(state: DemoState, id: string, change: (c: DemoCharge) => DemoCharge): ChargeSession {
    let found: DemoCharge | null = null;
    const charges = (state.charges ?? []).map((c) => (c.id === id ? (found = change(c)) : c));
    if (!found) throw new BackendError("unknown", "not_found");
    this.save({ ...state, charges });
    return this.chargeView(found);
  }

  async stationCharging(stationId: string): Promise<StationCharging> {
    const state = this.load();
    this.stationReader(state, stationId);
    const all = (state.charges ?? []).filter((c) => c.stationId === stationId).map((c) => this.chargeView(c));
    const day = dayStart();
    const paid = all.filter((c) => c.status === "paid" && (c.paidAt ?? "") >= day);
    return {
      tariff: this.chargeTariffOf(state, stationId),
      evTariff: this.chargeTariffOf(state, stationId, true),
      open: all.filter((c) => c.status === "charging" || c.status === "stopped"),
      today: all.filter((c) => (c.status === "paid" || c.status === "cancelled") && c.startedAt >= day),
      takings: {
        cashXof:
          paid.filter((c) => c.paymentMethod === "cash").reduce((n, c) => n + c.amountXof, 0) +
          (state.cardTopups ?? []).filter((t) => t.stationId === stationId && t.at >= day).reduce((n, t) => n + t.amountXof, 0),
        appXof: paid.filter((c) => c.paymentMethod !== "cash" && c.paymentMethod !== "card").reduce((n, c) => n + c.amountXof, 0),
        count: paid.length,
      },
    };
  }

  /** As startCharge() in worker/charging.ts: from an outlet reservation, its code is checked and starting completes it. */
  async startCharge(stationId: string, input: StartChargeInput): Promise<ChargeSession> {
    const state = this.load();
    const staff = this.stationActor(state, stationId).profile;
    const station = state.stations.find((s) => s.id === stationId);
    const point = (state.devices ?? seedDevices()).flatMap((d) => d.points).find((p) => p.id === input.pointId && p.stationId === stationId);
    if (!station || !point) throw new BackendError("unknown", "not_found");
    // A car charger's outlet is the "ev" service, at the car price, under the charger's name.
    const ev = this.evOfPoint(state, point.id);
    if (!serviceActive(state, stationId, ev ? "ev" : "charging")) throw new BackendError("service_not_offered");
    if ((state.charges ?? []).some((c) => c.pointId === point.id && c.status === "charging")) throw new BackendError("charge_busy");
    let reservation: Reservation | null = null;
    if (input.reservationId) {
      reservation = state.reservations.find((r) => r.id === input.reservationId) ?? null;
      if (
        !reservation ||
        reservation.stationId !== stationId ||
        reservationKind(reservation) !== "charging_point" ||
        (reservation.targetKind === "ev" ? reservation.target !== ev?.id : !!ev)
      ) {
        throw new BackendError("forbidden");
      }
      if (reservation.userId === staff.id) throw new BackendError("own_reservation");
      if (!isHolding(reservation)) throw new BackendError("reservation_not_active");
      this.checkPickupCode(state, reservation, input.pickupCode);
    }
    const users = state.users ?? demoUsers(new Date());
    // Without a reservation only the customer's one-time Green Credit code names them; without it, an anonymous cash charge.
    const code = (input.creditCode ?? "").trim();
    const customer = reservation
      ? (users.find((u) => u.id === reservation.userId) ?? (state.profile?.id === reservation.userId ? state.profile : null))
      : code
        ? this.creditCodeOwner(state, code)
        : null;
    if (customer?.id === staff.id) throw new BackendError("own_reservation");
    // The reservation used now: the one named, else the customer's outlet reservation here (this outlet
    // first, never a car charger's), or for a car charger, their reservation of that charger.
    const used =
      reservation ??
      (customer ? this.reservationToUse(state, customer.id, stationId, point.id, ev) : null);
    const reservations = used ? state.reservations.map((r) => (r.id === used.id ? { ...r, status: "completed" as const } : r)) : state.reservations;
    const charge: DemoCharge = {
      id: crypto.randomUUID(),
      stationId,
      stationName: station.name,
      pointLabel: ev?.name ?? point.label,
      pointId: point.id,
      partnerId: this.partnerOfPoint(state, point.id),
      startedBy: staff.id,
      status: "charging",
      userId: customer?.id ?? null,
      customer: customer ? personLabel(customer) : null,
      powerWatts: 0,
      energyWh: 0,
      tariff: this.chargeTariffOf(state, stationId, !!ev),
      amountXof: 0,
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      endedByDevice: false,
      paymentMethod: null,
      paidAt: null,
      greenpoints: 0,
    };
    // The code is used once, by this start.
    const wallet = !reservation && code ? this.useCreditCode(this.wallet(state), code) : state.wallet;
    this.save({ ...state, wallet, reservations, charges: [charge, ...(state.charges ?? [])].slice(0, 200) });
    return this.chargeView(charge);
  }

  /** The customer's reservation a charge on this outlet completes (as openCharge() in worker/charging.ts). */
  private reservationToUse(state: DemoState, userId: string, stationId: string, pointId: string, ev: EvCharger | undefined): Reservation | null {
    return (
      state.reservations
        .filter(
          (r) =>
            r.userId === userId &&
            r.stationId === stationId &&
            r.status === "active" &&
            reservationKind(r) === "charging_point" &&
            (ev ? r.targetKind === "ev" && r.target === ev.id : r.targetKind !== "ev"),
        )
        .sort((a, b) => Number(b.target === pointId) - Number(a.target === pointId) || a.createdAt.localeCompare(b.createdAt))[0] ?? null
    );
  }

  async stopCharge(stationId: string, id: string): Promise<ChargeSession> {
    const state = this.load();
    this.stationActor(state, stationId);
    return this.updateCharge(state, id, (c) => {
      if (c.status !== "charging") return c;
      const live = this.chargeView(c);
      return { ...c, status: "stopped", energyWh: live.energyWh, amountXof: live.amountXof, powerWatts: 0, stoppedAt: new Date().toISOString() };
    });
  }

  async cancelCharge(stationId: string, id: string): Promise<ChargeSession> {
    const state = this.load();
    this.stationActor(state, stationId);
    return this.updateCharge(state, id, (c) => {
      if (c.status !== "stopped" || c.energyWh > 0) throw new BackendError("charge_wrong_status");
      return { ...c, status: "cancelled" };
    });
  }

  /** Paid: the greenpoints follow the kWh for an app customer at a solar station (as chargeEarnStatement). */
  private payCharge(state: DemoState, id: string, method: ChargeSession["paymentMethod"]): DemoState {
    const c = (state.charges ?? []).find((x) => x.id === id);
    if (!c || c.status !== "stopped" || c.amountXof <= 0) throw new BackendError("charge_wrong_status");
    let next = state;
    let points = 0;
    const g = this.gp(state);
    const solar = state.stations.find((s) => s.id === c.stationId)?.isSolar;
    const account = (state.users ?? demoUsers(new Date())).find((u) => u.id === c.userId);
    const hasApp = state.profile?.id === c.userId || !!account?.lastSignInAt;
    if (c.userId && solar && hasApp) {
      const grams = Math.round((c.energyWh / 1000) * g.factors.kwhGrams);
      points = pointsFor(grams);
      if (points > 0) {
        const entry = {
          id: crypto.randomUUID(),
          userId: c.userId,
          reservationId: null,
          kind: "charge" as const,
          co2Grams: grams,
          points,
          vehicle: g.vehicles[c.userId] ?? "scooter",
          stationName: c.stationName,
          rewardTitle: null,
          createdAt: new Date().toISOString(),
        };
        next = { ...next, greenpoint: { ...g, ledger: [entry, ...g.ledger].slice(0, 500) } };
      }
    }
    const charges = (next.charges ?? []).map((x) =>
      x.id === id ? { ...x, status: "paid" as const, paymentMethod: method, paidAt: new Date().toISOString(), greenpoints: points } : x,
    );
    return { ...next, charges };
  }

  async payChargeCash(stationId: string, id: string): Promise<ChargeSession> {
    const state = this.load();
    this.stationActor(state, stationId);
    const next = this.payCharge(state, id, "cash");
    this.save(next);
    return this.chargeView(next.charges!.find((c) => c.id === id)!);
  }

  async myCharges(): Promise<ChargeSession[]> {
    this.settleDemoCredit();
    const state = this.load();
    const profile = this.requireProfile(state);
    const walletOn = demoFeatures(state).wallet && (this.wallet(state).enabled || profile.role === "admin");
    return (state.charges ?? [])
      .filter((c) => c.userId === profile.id)
      .map((c) => {
        // The money follows the socket's owner (worker/charging.ts payOptions): ours, at any station.
        const open = c.status === "stopped" && !c.partnerId && c.creditLimitXof === undefined;
        return { ...this.chargeView(c), payOptions: { wallet: open && walletOn && this.isDemoCreditStation(state, c.stationId), mobile: open }, pendingPaymentId: null };
      });
  }

  /** One outlet as qrPointState() in worker/charging.ts sees it; demo sockets are always online. */
  private async chargePoint(
    pointId: string,
  ): Promise<{ stationId: string; stationName: string; label: string; state: ChargePointState; tariff: ChargeTariff; ev?: EvCharger }> {
    const state = this.load();
    const point = (state.devices ?? seedDevices()).flatMap((d) => d.points).find((p) => p.id === pointId);
    const station = point && state.stations.find((s) => s.id === point.stationId);
    if (!point || !station) throw new BackendError("unknown", "not_found");
    const busy = point.status === "charging" || (state.charges ?? []).some((c) => c.pointId === point.id && c.status === "charging");
    const ev = this.evOfPoint(state, point.id);
    return {
      ...(ev ? { ev } : {}),
      label: ev?.name ?? point.label,
      stationId: station.id,
      stationName: station.name,
      state: !point.qrStart || !this.demoCreditAccepted(state, pointId) ? "disabled" : point.status === "fault" ? "fault" : busy ? "busy" : "free",
      tariff: this.chargeTariffOf(state, station.id, !!ev),
    };
  }

  /** As outletInfo() in worker/charging.ts. */
  async chargeOutlet(token: string): Promise<ChargeOutletInfo> {
    const state = this.load();
    const device = (state.devices ?? seedDevices()).find((d) => boxToken(d) === token);
    const station = device && state.stations.find((s) => s.id === device.stationId);
    if (!device || !station) throw new BackendError("unknown", "not_found");
    const me = state.profile?.id ?? null;
    const now = new Date().toISOString();
    const outlets = await Promise.all(
      [...device.points]
        .filter((p) => p.outlet)
        .sort((a, b) => a.outlet! - b.outlet!)
        .map(async (p) => {
          const info = await this.chargePoint(p.id);
          const { ev, label } = info;
          let pointState = info.state;
          const held = state.reservations.filter((r) => (r.target === p.id || (!!ev && r.target === ev.id)) && r.status === "active" && r.expiresAt > now);
          if (pointState === "free" && held.some((r) => r.userId !== me)) pointState = "reserved";
          const yours = pointState === "free" && !!me && held.some((r) => r.userId === me);
          return {
            pointId: p.id,
            label,
            outlet: p.outlet!,
            state: pointState,
            ...(yours ? { yours: true } : {}),
            ...(ev ? { ev: { name: ev.name, connector: ev.connector, powerKw: ev.powerKw } } : {}),
          };
        }),
    );
    const first = device.points.find((p) => p.outlet);
    return {
      label: device.externalId.slice(-4),
      stationId: station.id,
      stationName: station.name,
      tariff: this.chargeTariffOf(state, station.id, !!first && !!this.evOfPoint(state, first.id)),
      outlets,
      creditAccepted: !!first && this.demoCreditAccepted(state, first.id),
      ...(me ? { balanceXof: this.balance(this.wallet(state), me) } : {}),
    };
  }

  /** As creditAcceptedAt() in worker/charging.ts: our socket at a Green Credit station. */
  private demoCreditAccepted(state: DemoState, pointId: string): boolean {
    const point = (state.devices ?? seedDevices()).flatMap((d) => d.points).find((p) => p.id === pointId);
    return !!point && this.isDemoCreditStation(state, point.stationId) && !this.partnerOfPoint(state, pointId);
  }

  /** As startOutletCharge() in worker/charging.ts. */
  async startOutletCharge(token: string, pointId: string, pin: string): Promise<ChargeSession> {
    const outlet = (await this.chargeOutlet(token)).outlets.find((o) => o.pointId === pointId);
    if (!outlet) throw new BackendError("unknown", "not_found");
    return this.startSelfCharge(pointId, pin);
  }

  /** As selfCharge() in worker/charging.ts: paid in advance from Green Credit, with the PIN. */
  private async startSelfCharge(pointId: string, pin: string): Promise<ChargeSession> {
    this.settleDemoCredit();
    const state = this.load();
    const info = await this.chargePoint(pointId);
    if (!serviceActive(state, info.stationId, info.ev ? "ev" : "charging")) throw new BackendError("service_not_offered");
    if (!this.demoCreditAccepted(state, pointId)) throw new BackendError("credit_not_accepted");
    const profile = this.walletAccess(state);
    const pinOf = state.pins?.[profile.phone ?? profile.email ?? ""];
    if (!/^\d{4}$/.test(pin) || (pinOf !== undefined && pinOf !== pin)) throw new BackendError("invalid_pin");
    if ((state.charges ?? []).some((c) => c.userId === profile.id && (c.status === "charging" || c.status === "stopped"))) {
      throw new BackendError("charge_unpaid");
    }
    if (info.state === "disabled") throw new BackendError("charge_qr_disabled");
    if (info.state !== "free") throw new BackendError("charge_busy");
    const now = new Date().toISOString();
    const heldBy = (r: Reservation) => r.target === pointId || (!!info.ev && r.target === info.ev.id);
    if (state.reservations.some((r) => heldBy(r) && r.status === "active" && r.expiresAt > now && r.userId !== profile.id)) {
      throw new BackendError("point_reserved");
    }
    const w = this.wallet(state);
    if (w.frozen.includes(profile.id)) throw new BackendError("wallet_frozen");
    const balance = this.balance(w, profile.id);
    if (balance < Math.max(info.tariff.minXof, 5)) throw new BackendError("insufficient_balance");
    const used = this.reservationToUse(state, profile.id, info.stationId, pointId, info.ev);
    const reservations = used ? state.reservations.map((r) => (r.id === used.id ? { ...r, status: "completed" as const } : r)) : state.reservations;
    const charge: DemoCharge = {
      id: crypto.randomUUID(),
      stationId: info.stationId,
      stationName: info.stationName,
      pointLabel: info.label,
      pointId,
      partnerId: this.partnerOfPoint(state, pointId),
      startedBy: profile.id,
      status: "charging",
      userId: profile.id,
      customer: personLabel(profile),
      powerWatts: 0,
      energyWh: 0,
      tariff: info.tariff,
      amountXof: 0,
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      endedByDevice: false,
      paymentMethod: null,
      paidAt: null,
      greenpoints: 0,
      creditLimitXof: balance,
    };
    this.save({ ...state, reservations, charges: [charge, ...(state.charges ?? [])].slice(0, 200) });
    return this.chargeView(charge);
  }

  async stopSelfCharge(id: string): Promise<ChargeSession> {
    const state = this.load();
    const profile = this.requireProfile(state);
    const c = (state.charges ?? []).find((x) => x.id === id && x.userId === profile.id);
    if (!c) throw new BackendError("unknown", "not_found");
    if (c.startedBy !== profile.id) throw new BackendError("forbidden");
    const stopped = this.updateCharge(state, id, (x) => {
      if (x.status !== "charging") return x;
      const live = this.chargeView(x);
      return { ...x, status: "stopped", energyWh: live.energyWh, amountXof: live.amountXof, powerWatts: 0, stoppedAt: new Date().toISOString() };
    });
    if (c.creditLimitXof === undefined) return stopped;
    this.settleDemoCredit();
    return this.chargeView((this.load().charges ?? []).find((x) => x.id === id)!);
  }

  async payChargeWallet(id: string, input: { pin: string; idempotencyKey: string }): Promise<ChargeSession> {
    const state = this.load();
    const profile = this.walletAccess(state);
    const c = (state.charges ?? []).find((x) => x.id === id && x.userId === profile.id);
    if (!c) throw new BackendError("unknown", "not_found");
    if (c.status === "paid") return this.chargeView(c);
    if (c.status !== "stopped" || c.partnerId || c.creditLimitXof !== undefined || !this.isDemoCreditStation(state, c.stationId)) {
      throw new BackendError("payment_not_offered");
    }
    const pinOf = state.pins?.[profile.phone ?? profile.email ?? ""];
    if (!validPinFormat(input.pin) || (pinOf !== undefined && pinOf !== input.pin)) throw new BackendError("invalid_pin");
    const w = this.wallet(state);
    const before = this.balance(w, profile.id);
    if (before < c.amountXof) throw new BackendError("insufficient_balance");
    const paid = this.payCharge(state, id, "wallet");
    const tx: DemoWallet["transactions"][number] = {
      id: crypto.randomUUID(),
      trxId: newTrxId("charge"),
      type: "charge",
      attribute: "send",
      status: "success",
      amountXof: c.amountXof,
      feeXof: 0,
      totalXof: c.amountXof,
      balanceAfterXof: before - c.amountXof,
      counterparty: c.stationName,
      remark: null,
      createdAt: new Date().toISOString(),
      userId: profile.id,
      userLabel: [profile.fullName, profile.phone ?? profile.email].filter(Boolean).join(" · "),
      adminId: null,
      key: input.idempotencyKey,
    };
    const wallet = { ...w, balances: { ...w.balances, [profile.id]: before - c.amountXof }, transactions: [tx, ...w.transactions] };
    this.save({ ...paid, wallet });
    return this.chargeView(paid.charges!.find((x) => x.id === id)!);
  }

  /** The demo has no Flooz/T-Money: the payment is confirmed at once. */
  async payChargeMobile(id: string): Promise<void> {
    const state = this.load();
    const profile = this.requireProfile(state);
    const c = (state.charges ?? []).find((x) => x.id === id && x.userId === profile.id);
    if (!c) throw new BackendError("unknown", "not_found");
    this.save(this.payCharge(state, id, "tmoney"));
  }

  async refreshChargePayment(): Promise<void> {}

  async adminCharging(): Promise<AdminCharging> {
    const state = this.load();
    this.requireAdmin(state);
    const charges = (state.charges ?? []).map((c) => this.chargeView(c));
    const paid = charges.filter((c) => c.status === "paid");
    const points = (state.devices ?? seedDevices()).flatMap((d) => d.points);
    return {
      defaultTariff: state.chargeTariff ?? DEFAULT_CHARGE_TARIFF,
      evTariff: state.evTariff ?? DEFAULT_EV_TARIFF,
      stations: state.stations
        .map((s) => {
          const evs = (state.evChargers ?? DEMO_EV_CHARGERS).filter((c) => c.stationId === s.id && c.isActive && c.pointId);
          const evPoints = new Set(evs.map((c) => c.pointId));
          return {
            id: s.id,
            name: s.name,
            kwhXof: state.stationTariffs?.[s.id]?.kwhXof ?? null,
            minXof: state.stationTariffs?.[s.id]?.minXof ?? null,
            outlets: points.filter((p) => p.stationId === s.id && p.deviceId && !evPoints.has(p.id)).length,
            evKwhXof: state.stationEvTariffs?.[s.id]?.kwhXof ?? null,
            evMinXof: state.stationEvTariffs?.[s.id]?.minXof ?? null,
            evChargers: evs.length,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
      sessions: charges,
      totals: { paidXof: paid.reduce((n, c) => n + c.amountXof, 0), energyWh: paid.reduce((n, c) => n + c.energyWh, 0), count: paid.length },
    };
  }

  async saveChargeTariff(input: ChargeTariffInput): Promise<void> {
    const state = this.load();
    this.requireAdmin(state);
    if (input.stationId === null) {
      const t = { kwhXof: input.kwhXof ?? -1, minXof: input.minXof ?? -1 };
      if (!validTariff(t)) throw new BackendError("unknown", "bad_request");
      this.save(input.ev ? { ...state, evTariff: t } : { ...state, chargeTariff: t });
      return;
    }
    const own = { [input.stationId]: { kwhXof: input.kwhXof, minXof: input.minXof } };
    this.save(input.ev ? { ...state, stationEvTariffs: { ...state.stationEvTariffs, ...own } } : { ...state, stationTariffs: { ...state.stationTariffs, ...own } });
  }
  async adminChargeCards(): Promise<ChargeCard[]> {
    const state = this.load();
    this.requireAdmin(state);
    const users = state.users ?? demoUsers(new Date());
    return sortCards(
      (state.chargeCards ?? seedChargeCards()).map((c) => {
        const u = c.userId ? users.find((x) => x.id === c.userId) : undefined;
        return {
          idTag: c.idTag,
          label: c.label,
          blocked: c.blocked,
          balanceXof: c.balanceXof ?? 0,
          customer: u ? { id: u.id, fullName: u.fullName, phone: u.phone, email: u.email } : null,
          createdAt: c.createdAt,
          lastSwipedAt: c.lastSwipedAt,
          lastDevice: c.lastDevice,
        };
      }),
    );
  }

  async saveChargeCard(input: ChargeCardInput): Promise<void> {
    const state = this.load();
    this.requireAdmin(state);
    const clean = cleanCardTag(input.idTag);
    if (!clean) throw new BackendError("card_invalid");
    const contact = input.contact?.trim() ?? "";
    // Every card belongs to an account (saveChargeCard in worker/charge-cards.ts).
    if (!contact) throw new BackendError("card_needs_account");
    const userId = this.findWalletUser(state, contact).id;
    const label = input.label?.trim().slice(0, 60) || null;
    const cards = state.chargeCards ?? seedChargeCards();
    const idTag = cardTagVariants(clean).find((v) => cards.some((c) => c.idTag === v)) ?? clean;
    const known = cards.some((c) => c.idTag === idTag);
    const chargeCards = known
      ? cards.map((c) => (c.idTag === idTag ? { ...c, userId, label } : c))
      : [...cards, { idTag, userId, label, blocked: false, balanceXof: 0, createdAt: new Date().toISOString(), lastSwipedAt: null, lastDevice: null }];
    this.save({ ...state, chargeCards });
  }

  async adjustChargeCard(idTag: string, amountXof: number, reason: string): Promise<void> {
    const state = this.load();
    this.requireAdmin(state);
    if (!validAdjustment(amountXof) || !reason.trim()) throw new BackendError("unknown", "bad_request");
    const cards = state.chargeCards ?? seedChargeCards();
    if (!cards.some((c) => c.idTag === idTag)) throw new BackendError("card_unknown");
    this.save({ ...state, chargeCards: cards.map((c) => (c.idTag === idTag ? { ...c, balanceXof: (c.balanceXof ?? 0) + amountXof } : c)) });
  }

  /** As counterCardInfo() in worker/charge-cards.ts. */
  async counterCard(stationId: string, idTag: string): Promise<CounterCard> {
    const state = this.load();
    this.stationActor(state, stationId);
    return this.counterCardView(state, demoCard(state, idTag));
  }

  /** As counterCardInfo() in worker/charge-cards.ts: a linked card shows the account's Green Credit. */
  private counterCardView(state: DemoState, card: DemoChargeCard): CounterCard {
    const owner = card.userId ? this.cardOwner(state, card.userId) : null;
    if (!owner) return counterView(card);
    const balance = this.balance(this.wallet(state), owner.id);
    return { ...counterView(card), linked: true, customer: personLabel(owner), balanceXof: balance };
  }

  private cardOwner(state: DemoState, userId: string): Profile | null {
    return (state.users ?? demoUsers(new Date())).find((u) => u.id === userId) ?? (state.profile?.id === userId ? state.profile : null);
  }

  async setChargeCardBlocked(idTag: string, blocked: boolean): Promise<void> {
    const state = this.load();
    this.requireAdmin(state);
    const cards = state.chargeCards ?? seedChargeCards();
    if (!cards.some((c) => c.idTag === idTag)) throw new BackendError("unknown", "not_found");
    this.save({ ...state, chargeCards: cards.map((c) => (c.idTag === idTag ? { ...c, blocked } : c)) });
  }

  async deleteChargeCard(idTag: string): Promise<void> {
    const state = this.load();
    this.requireAdmin(state);
    if ((state.chargeCards ?? seedChargeCards()).some((c) => c.idTag === idTag && (c.balanceXof ?? 0) !== 0)) throw new BackendError("card_has_balance");
    this.save({ ...state, chargeCards: (state.chargeCards ?? seedChargeCards()).filter((c) => c.idTag !== idTag) });
  }

}

interface DemoChargeCard {
  idTag: string;
  userId: string | null;
  label: string | null;
  blocked: boolean;
  /** Missing on cards saved before balances existed. */
  balanceXof?: number;
  createdAt: string;
  lastSwipedAt: string | null;
  lastDevice: string | null;
}

function demoCard(state: DemoState, rawTag: string): DemoChargeCard {
  const tag = cleanCardTag(rawTag);
  const cards = state.chargeCards ?? seedChargeCards();
  const card = tag ? cardTagVariants(tag).map((v) => cards.find((c) => c.idTag === v)).find(Boolean) : undefined;
  if (!card) throw new BackendError("card_unknown");
  return card;
}

function counterView(c: DemoChargeCard): CounterCard {
  return { idTag: c.idTag, label: c.label, blocked: c.blocked, balanceXof: c.balanceXof ?? 0 };
}

/** A card someone swiped at a socket a few minutes ago, with no credit yet, and one linked to Yao's account. */
function seedChargeCards(): DemoChargeCard[] {
  const swiped = new Date(Date.now() - 4 * 60_000).toISOString();
  return [
    { idTag: "2745839105", userId: null, label: null, blocked: false, balanceXof: 0, createdAt: swiped, lastSwipedAt: swiped, lastDevice: "820008" },
    { idTag: "1592637480", userId: "demo-u1", label: null, blocked: false, balanceXof: 0, createdAt: swiped, lastSwipedAt: null, lastDevice: null },
  ];
}

/** What the app sees of a stored counter event (without request id, station and person id). */
function eventView(e: NonNullable<DemoState["batteryEvents"]>[number]): BatteryEventView {
  return {
    id: e.id,
    type: e.type,
    batteryTypeId: e.batteryTypeId,
    delta: e.delta,
    fullAfter: e.fullAfter,
    emptyAfter: e.emptyAfter,
    reason: e.reason,
    swapId: e.swapId,
    person: e.person,
    role: e.role,
    createdAt: e.createdAt,
  };
}

/** What the app sees of a stored swap (without request id, staff and customer id). */
function swapView(x: NonNullable<DemoState["swaps"]>[number]): SwapEntry {
  return {
    id: x.id,
    stationId: x.stationId,
    batteryTypeId: x.batteryTypeId,
    batteryTypeLabel: x.batteryTypeLabel,
    batteryIn: x.batteryIn,
    batteryOut: x.batteryOut,
    customerType: x.customerType,
    customer: x.customer,
    driver: x.driver,
    payment: x.payment,
    amountXof: x.amountXof,
    reservationId: x.reservationId,
    person: x.person,
    role: x.role,
    createdAt: x.createdAt,
  };
}

/** The demo's swap price at our own stations, so the wallet payment can be tried. */
const DEMO_SWAP_PRICE = 500;

function swapPrice(state: DemoState, station: Station): number | null {
  const set = state.swapPrices?.[station.id];
  return set !== undefined ? set : station.isOwn ? DEMO_SWAP_PRICE : null;
}

/** Full batteries per type at a station; until staff count them, the total spread evenly over its types. */
function typeCounts(state: DemoState, stationId: string, total: number): Record<string, number> {
  const stored = state.typeBatteries?.[stationId];
  if (stored) return stored;
  const swapped = (state.stationBatteryTypes ?? DEMO_STATION_BATTERY_TYPES)[stationId] ?? [];
  const share = Math.floor(total / Math.max(1, swapped.length));
  return Object.fromEntries(swapped.map((id, i) => [id, share + (i === 0 ? total - share * swapped.length : 0)]));
}
