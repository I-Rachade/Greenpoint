import type { BatteryDetail, BatteryFilter, BatteryList, BatteryLookup, BatteryStatusInput, RegisterBatteriesInput, RegisterBatteriesResult } from "../batteries";
import type { BatteryType, BatteryTypeInput } from "../battery-types";
import type { AdminCharging, ChargeOutletInfo, ChargeSession, ChargeTariffInput, StationCharging } from "../charging";
import type { ChargeCard, ChargeCardInput, CounterCard } from "../charge-cards";
import type {
  Operator,
  VehicleType,
  Profile,
  Reservation,
  ReservationType,
  StationInput,
  StationStatus,
  StationView,
  UserRole,
} from "../types";
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
import type { StationService, StationServiceInfo } from "../station-services";
import type { ReservationKind } from "../reservations";
import type { BatteryEventInput, BatteryEventView, StationCounter, SwapEntry, SwapFilter, SwapInput } from "../station-work";
import type { ReviewInput, StationReview } from "../station-extras";
import type { LatLng } from "../geo";
import type { CashHandover, HandoverInput, StationCash, StationCashSettings } from "../station-cash";
import type { AdminWallet, CounterCredit, CreditCode, CreditTopupInput, CreditTopupResult, WalletAdjustInput, WalletTransaction, WalletView } from "../wallet";

/** Where a code goes: by SMS to the phone number or by e-mail. */
export type CodeChannel = "sms" | "email";

/** Open/close and free charging places. Full batteries change only through counter events (station-work.ts). */
export type StatusPatch = Partial<Pick<StationStatus, "isOpen" | "freeSlots">>;

/** Start a charge for a cash or app customer, or for the customer of an outlet reservation (with its code). */
export interface StartChargeInput {
  pointId: string;
  contact?: string;
  reservationId?: string;
  pickupCode?: string;
}

/** Error codes shared by both backends, translated in the UI (see i18n `errors`). */
export type BackendErrorCode =
  | "not_authenticated"
  | "already_reserved"
  | "station_not_found"
  | "station_closed"
  | "station_unattended"
  | "service_not_offered"
  | "none_available"
  | "daily_limit"
  | "cooldown"
  | "wrong_pickup_code"
  | "own_reservation"
  | "reservation_not_active"
  | "phone_not_allowed"
  | "invalid_contact"
  | "contact_taken"
  | "invalid_code"
  | "invalid_pin"
  | "pin_locked"
  | "bad_pin"
  | "weak_pin"
  | "image_too_large"
  | "invalid_device"
  | "device_exists"
  | "device_offline"
  | "device_not_charging"
  | "device_command_failed"
  | "device_not_configured"
  | "depot_inactive"
  | "station_without_point"
  | "battery_type_exists"
  | "same_station"
  | "parcel_too_large"
  | "parcel_not_found"
  | "parcel_wrong_status"
  | "code_locked"
  | "parcel_with_driver"
  | "parcel_not_arrived"
  | "not_a_driver"
  | "phone_required"
  | "driver_busy"
  | "driver_not_found"
  | "too_far"
  | "cash_limit"
  | "outside_area"
  | "job_not_found"
  | "job_wrong_status"
  | "wait_longer"
  | "photo_missing"
  | "ride_open"
  | "vehicle_soon"
  | "drivers_soon"
  | "vehicle_unavailable"
  | "vehicle_too_small"
  | "has_other_role"
  | "partner_suspended"
  | "already_point_partner"
  | "no_vehicle"
  | "documents_missing"
  | "balance_changed"
  | "invalid_webhook"
  | "rate_limited"
  | "payment_not_offered"
  | "payment_exists"
  | "provider_unavailable"
  | "forbidden"
  | "wallet_disabled"
  | "wallet_frozen"
  | "insufficient_balance"
  | "nothing_owed"
  | "payout_pending"
  | "payout_not_open"
  | "recipient_not_found"
  | "account_not_found"
  | "self_transfer"
  | "invalid_amount"
  | "amount_too_small"
  | "amount_too_large"
  | "daily_limit_exceeded"
  | "monthly_limit_exceeded"
  | "wallet_not_empty"
  | "topup_unavailable"
  | "credit_code_invalid"
  | "credit_not_accepted"
  | "credit_limit_reached"
  | "card_needs_account"
  | "reward_unavailable"
  | "redemption_open"
  | "not_enough_points"
  | "charge_busy"
  | "charge_wrong_status"
  | "charge_unpaid"
  | "charge_qr_disabled"
  | "card_invalid"
  | "card_unknown"
  | "card_blocked"
  | "card_has_balance"
  | "point_reserved"
  | "service_already_unlocked"
  | "service_request_pending"
  | "no_pending_request"
  | "invalid_review"
  | "active_station_required"
  | "no_full_battery"
  | "counter_full"
  | "swap_price_missing"
  | "same_battery"
  | "battery_number_required"
  | "battery_wrong_brand"
  | "battery_type_required"
  | "cash_only"
  | "wrong_fleet"
  | "not_a_customer"
  | "request_conflict"
  | "reason_required"
  | "battery_type_unavailable"
  | "battery_type_mismatch"
  | "battery_reserved"
  | "outlet_busy"
  | "outlet_required"
  | "swap_required"
  | "driver_pass_invalid"
  | "driver_pass_expired"
  | "driver_pass_required"
  | "pickup_code_required"
  | "role_change_blocked"
  | "fleet_not_approved"
  | "fleet_locked"
  | "fleet_limit"
  | "invite_number_taken"
  | "invite_account_not_empty"
  | "invite_pending"
  | "invite_not_found"
  | "already_in_fleet"
  | "account_exists"
  | "parcel_not_in_run"
  | "parcel_label_missing"
  | "run_not_found"
  | "run_wrong_status"
  | "run_unscanned"
  | "recipient_not_customer"
  | "sender_not_customer"
  | "no_origin_depot"
  | "staff_other_station"
  | "opening_hours_invalid"
  | "proof_required"
  | "merchant_not_approved"
  | "merchant_limit"
  | "already_in_merchant"
  | "checked_in_at_shop"
  | "driver_checked_in"
  | "not_assigned"
  | "assignment_not_found"
  | "merchant_driver_exists"
  | "driver_checked_in_here"
  | "merchant_locked"
  | "address_limit"
  | "cash_changed"
  | "handover_reference_required"
  | "handover_note_required"
  | "handover_decided"
  | "reject_reason_required"
  | "own_station"
  | "unknown";

export class BackendError extends Error {
  constructor(public code: BackendErrorCode, message?: string) {
    super(message ?? code);
  }
}

/**
 * Everything the app needs from its data source. Two implementations exist:
 * `DemoBackend` (browser storage, no setup) and `CloudflareBackend` (production, see worker/).
 */
export interface Backend {
  readonly mode: "demo" | "cloudflare";

  // Stations (public)
  listStations(): Promise<StationView[]>;
  /** Active repair workshops away from stations, shown on the map (repair-centers.ts). */
  listRepairCenters(): Promise<RepairCenter[]>;
  /** Calls `onChange` whenever station data may have changed. Returns an unsubscribe function. */
  subscribe(onChange: () => void): () => void;

  // Auth
  getProfile(): Promise<Profile | null>;
  onAuthChange(callback: (profile: Profile | null) => void): () => void;
  /**
   * Sends a code by SMS (phone number) or by e-mail (address), needed to register
   * and to set a new PIN when it is forgotten. `contact` is normalised (see lib/contact.ts).
   */
  sendCode(contact: string): Promise<void>;
  /**
   * Checks the code, sets the 4-digit PIN and signs in (new account or new PIN).
   * `demoRole` is only honoured by the demo backend, so testers can try every view.
   */
  register(contact: string, code: string, pin: string, demoRole?: UserRole): Promise<Profile>;
  /** Everyday login with phone number or e-mail address, and PIN. */
  signIn(contact: string, pin: string, demoRole?: UserRole): Promise<Profile>;
  signOut(): Promise<void>;
  /** Sends a code to a phone number or e-mail address the signed-in user wants to add. */
  sendContactCode(contact: string): Promise<void>;
  /** Adds that phone number or e-mail address to the account once its code is right. */
  addContact(contact: string, code: string): Promise<Profile>;
  /** Sends the code that confirms account deletion, by SMS or e-mail to the account's own contact. */
  sendDeleteCode(channel: CodeChannel): Promise<void>;
  /** Deletes the signed-in user's account for good, after checking the code. */
  deleteAccount(channel: CodeChannel, code: string): Promise<void>;

  // Reviews and photos (see src/lib/station-extras.ts)
  /** Customer reviews of a station, newest first. Public; `isMine` marks the signed-in user's own. */
  stationReviews(stationId: string): Promise<StationReview[]>;
  /** Rates a station 1 to 5 stars with an optional comment; one review per customer and station (a new one replaces the old). */
  saveReview(stationId: string, input: ReviewInput): Promise<void>;
  /** The author deletes their review, or an admin removes one. */
  deleteReview(id: string): Promise<void>;
  /** Stores a station photo and returns its public URL (admins only). */
  uploadStationPhoto(file: File): Promise<string>;

  // Customer
  myReservations(): Promise<Reservation[]>;
  /**
   * Reserves at a station (riders only, src/lib/reservations.ts): `kind` "swap" with the
   * battery type as `target`, or "charging_point" with an outlet or car charger (none at a
   * station without connected outlets). The older "battery" / "slot" still work.
   */
  reserve(stationId: string, kind: ReservationKind | ReservationType, target?: string | null): Promise<Reservation>;
  cancelReservation(id: string): Promise<void>;

  // Station staff
  staffStations(): Promise<StationView[]>;
  /** Closing cancels the reservations still holding (R17) and answers how many. */
  updateStatus(stationId: string, patch: StatusPatch): Promise<{ cancelled: number }>;
  stationReservations(stationId: string): Promise<Reservation[]>;
  /**
   * Completes a charging reservation (car charger, counted place, or an outlet that cannot be
   * started) with the customer's pickup code; a counted place comes off the free places.
   * A swap reservation is completed by its swap (recordSwap with `reservationId`), an outlet
   * reservation by starting the charge (startCharge with `reservationId`). 5 wrong codes lock it.
   */
  completeReservation(id: string, pickupCode: string): Promise<void>;

  // Station work (src/lib/station-work.ts): every action is sent with the active station.
  /** Counters, today's changes and whether the viewer may correct. Needs the swap service. */
  stationCounter(stationId: string): Promise<StationCounter>;
  /** "Marked full" +1, "issue" −1, or a correction with reason (owner, admin). Same request id twice = one change. */
  batteryEvent(stationId: string, input: BatteryEventInput): Promise<BatteryEventView>;
  /** One swap: battery out (counter −1) and battery in (empty stock +1), logged with payment. */
  recordSwap(stationId: string, input: SwapInput): Promise<SwapEntry>;
  /** Today's swaps at the station, newest first (staff: their own); owners and admins any report period (`days`). */
  stationSwaps(stationId: string, filter?: SwapFilter): Promise<SwapEntry[]>;
  /** Counter history of a report period, newest first: owners and admins only (backoffice). */
  stationBatteryEvents(stationId: string, days: ReportPeriod): Promise<BatteryEventView[]>;

  // Operator accounts (see src/lib/operators.ts)
  /** The operators the signed-in person runs, their stations and staff. */
  ownerView(): Promise<OwnerView>;
  /** Makes the account with this phone number or e-mail address staff of one of the operator's stations. */
  ownerAddStaff(stationId: string, contact: string): Promise<void>;
  ownerRemoveStaff(stationId: string, userId: string): Promise<void>;
  ownerSaveStation(stationId: string, input: OwnerStationInput): Promise<void>;
  /** Moves a staff member to another station of the owner (staff work at one station only, W2). */
  ownerMoveStaff(userId: string, stationId: string): Promise<void>;
  /** An entry of the list to re-staff (migration 0033) is dealt with. */
  resolveReassignment(id: string): Promise<void>;

  // Owner backoffice (see src/lib/owner-backoffice.ts): one station or all (`null`)
  ownerLive(stationId: string | null): Promise<OwnerLive>;
  // Station cash (see src/lib/station-cash.ts): partner stations only
  /** The balance, what is due now and the handovers of the owner's partner stations (admins: all of them). */
  ownerCash(stationId: string | null): Promise<StationCash[]>;
  /** Closes the open period and records what was handed over (pending until an admin confirms it). */
  closeCashDay(input: HandoverInput): Promise<CashHandover>;
  /** Admins: the money of a handover arrived (confirm) or not (reject, with a reason). */
  decideHandover(id: string, confirm: boolean, reason?: string): Promise<CashHandover>;
  /** Admins: operator station or shop station, and the host's commission. */
  saveStationCashSettings(stationId: string, settings: StationCashSettings): Promise<void>;
  ownerReport(stationId: string | null, days: ReportPeriod): Promise<OwnerReport>;

  // Service unlock per station (see src/lib/station-services.ts)
  /** Every service of the owner's stations, or of all stations for an admin. */
  stationServices(): Promise<StationServiceInfo[]>;
  /** The station's owner asks an admin to unlock a service. */
  requestStationService(stationId: string, service: StationService): Promise<void>;
  /** An admin approves (unlocks) or rejects a pending request. */
  decideStationService(stationId: string, service: StationService, approve: boolean): Promise<void>;
  /** An admin switches a service on or off at a station directly. */
  setStationService(stationId: string, service: StationService, unlocked: boolean): Promise<void>;

  // Admin
  listOperators(): Promise<Operator[]>;
  saveStation(id: string | null, input: StationInput): Promise<void>;
  /** Battery types of the motorbike brands, including switched-off ones (admins only). */
  listBatteryTypes(): Promise<BatteryType[]>;
  saveBatteryType(id: string | null, input: BatteryTypeInput): Promise<void>;
  // Battery register (src/lib/batteries.ts): admins; owners read the batteries of their stations.
  /** Batteries per brand, last swapped first, with the brands and their counts. */
  listBatteries(filter?: BatteryFilter): Promise<BatteryList>;
  /** One battery with its history, newest first. */
  batteryDetail(id: string): Promise<BatteryDetail>;
  /** Registers numbers for a battery type in advance (admins); known ones stay as they are. */
  registerBatteries(input: RegisterBatteriesInput): Promise<RegisterBatteriesResult>;
  /** In service, repair, lost or retired, with an optional reason (admins). */
  setBatteryStatus(id: string, input: BatteryStatusInput): Promise<void>;
  /** The swap form: is this number known at this battery type, new, or of another brand? */
  lookupBattery(stationId: string, serial: string, batteryTypeId: string | null): Promise<BatteryLookup>;
  /** Electric car chargers, assigned or not, including switched-off ones (admins only). */
  listEvChargers(): Promise<EvCharger[]>;
  /** Adds a charger (`id` null) or changes one, including the station it is assigned to. */
  saveEvCharger(id: string | null, input: EvChargerInput): Promise<void>;
  deleteEvCharger(id: string): Promise<void>;
  /** Every repair workshop, including switched-off ones (admins only). */
  adminRepairCenters(): Promise<RepairCenter[]>;
  /** Adds a workshop (`id` null) or changes one. */
  saveRepairCenter(id: string | null, input: RepairCenterInput): Promise<void>;
  deleteRepairCenter(id: string): Promise<void>;

  // Backoffice (admins only; see src/lib/admin)
  adminSnapshot(): Promise<AdminSnapshot>;
  /** One page of the reservations table (last ADMIN_HISTORY_DAYS days) and how many match. */
  adminReservations(query: AdminReservationQuery): Promise<AdminReservationPage>;
  auditLog(filter: AuditFilter): Promise<AuditEntry[]>;
  setUserRole(userId: string, role: UserRole): Promise<void>;
  assignStaff(stationId: string, userId: string): Promise<void>;
  unassignStaff(stationId: string, userId: string): Promise<void>;
  setStationActive(stationId: string, active: boolean): Promise<void>;
  /** Operators with their stations count and the accounts that run them. */
  adminOperators(): Promise<AdminOperator[]>;
  /** Creates a partner operator (`id` null) or renames one. */
  saveOperator(id: string | null, input: OperatorInput): Promise<void>;
  /** Lets the account with this phone number or e-mail address run the operator. */
  addOperatorOwner(operatorId: string, contact: string): Promise<void>;
  removeOperatorOwner(operatorId: string, userId: string): Promise<void>;

  // Connected sockets (admins only; see src/lib/iot/devices.ts)
  listDevices(): Promise<Device[]>;
  /** Registers a socket and creates one charging point per outlet. */
  /** Registers a socket; an OCPP charge point gets its password (only now). */
  createDevice(input: DeviceInput): Promise<{ ocppKey?: string }>;
  /** Removes a socket and its charging points. */
  deleteDevice(externalId: string): Promise<void>;
  /** Switches an outlet on (until full) or off; only where `canSwitch`. */
  switchOutlet(externalId: string, outlet: number, on: boolean): Promise<void>;
  /** Allows or forbids customers to start a charge at this outlet by scanning its QR code. */
  setQrStart(pointId: string, enabled: boolean): Promise<void>;
  /** A new QR code for the box; the old sticker stops working. Returns the new token. */
  renewBoxQr(externalId: string): Promise<string>;
  /** Gives the socket to a point partner, or back to poinderecharge (`null`). */
  setDevicePartner(externalId: string, partnerId: string | null): Promise<void>;

  // Point partners, who own sockets (see src/lib/point-partners.ts)
  /** Admins: every partner with its accounts and sockets. */
  adminPointPartners(): Promise<AdminPointPartner[]>;
  /** Creates a partner (`id` null, active at once) or edits one. */
  savePointPartner(id: string | null, input: PointPartnerInput): Promise<void>;
  /** Suspends a partner (its accounts lose the dashboard) or makes it active again. */
  setPointPartnerActive(id: string, active: boolean): Promise<void>;
  /** Links the account with this phone number or e-mail address to the partner. */
  addPointPartnerAccount(partnerId: string, contact: string): Promise<void>;
  removePointPartnerAccount(partnerId: string, userId: string): Promise<void>;
  /** The signed-in partner account's sockets and earnings of the period. */
  pointPartnerDashboard(days: ReportPeriod): Promise<PointPartnerDashboard>;

  // Modules (see src/lib/features.ts)
  /** Which modules are switched on. Public. */
  features(): Promise<Features>;
  /** Backoffice: switches the parcel module on or off for everyone (admins only). */
  setParcelsEnabled(enabled: boolean): Promise<void>;
  /** Backoffice: switches everything that needs a driver (courses, express, pickups, home deliveries) on or off (admins only). */
  setDriversEnabled(enabled: boolean): Promise<void>;
  /** Backoffice: switches the Lite version on or off for everyone (admins only). */
  setLiteEnabled(enabled: boolean): Promise<void>;

  // Parcel depot (see src/lib/parcels.ts)
  /** Stations that take parcels, and the prices. Public. */
  parcelInfo(): Promise<ParcelInfo>;
  /** Parcels the signed-in customer sent or is to receive; the pickup code only for the recipient. */
  myParcels(): Promise<Parcel[]>;
  /** Parcels handed in at or coming to this station (its staff; never with pickup codes). */
  stationParcels(stationId: string): Promise<Parcel[]>;
  /** Staff at the sending station register a parcel paid in cash; creates accounts for unknown phone numbers. */
  createParcel(stationId: string, input: ParcelInput): Promise<Parcel>;
  /** Staff confirm the shipping label is printed and stuck on (first time or reprint); only then can the parcel go on a run. */
  markParcelLabel(stationId: string, parcelId: string): Promise<Parcel>;
  /** Collection runs leaving this station: being loaded, under way, and those of the last days (its staff). */
  stationRuns(stationId: string): Promise<ParcelRun[]>;
  /** Staff choose the parcels a driver takes on a collection run and record the driver (QR or typed code). */
  startRun(stationId: string, badge: string, parcelIds: string[]): Promise<ParcelRun>;
  /** Staff scan one parcel into the driver's hands; a parcel not on the run is refused, a second scan changes nothing. */
  scanRunParcel(stationId: string, runId: string, code: string): Promise<ParcelRun>;
  /** Takes a parcel off a run that is still being loaded. */
  removeRunParcel(stationId: string, runId: string, parcelId: string): Promise<ParcelRun>;
  /** The run leaves, only once every parcel on it was scanned; its parcels go on the road. */
  departRun(stationId: string, runId: string): Promise<ParcelRun>;
  /** Calls off a run that has not left; its parcels wait for the next one. */
  cancelRun(stationId: string, runId: string): Promise<void>;
  /** Staff at the destination scan a parcel in from a collection run: it gets its pickup code and the recipient is told. */
  receiveParcel(stationId: string, code: string): Promise<Parcel>;
  /**
   * Staff at the destination hand out a parcel, only for the recipient's code or scanned QR
   * code. `trackingNo`: the parcel number staff found it by (then wrong codes lock only that
   * parcel). The number alone never hands it over: pickup_code_required.
   */
  pickUpParcel(stationId: string, codeOrQr: string, trackingNo?: string): Promise<Parcel>;
  /** Cancels a parcel that has not left the sending station. */
  cancelParcel(id: string): Promise<void>;
  /** Tells the recipient again that the parcel is waiting. */
  resendPickupCode(id: string): Promise<void>;
  /** Backoffice: all parcels, depots and prices (admins only). */
  adminParcels(): Promise<AdminParcels>;
  saveParcelDepot(stationId: string, input: ParcelDepotInput): Promise<void>;
  saveParcelSizes(sizes: ParcelSizeTier[]): Promise<void>;
  /** A parcel in storage was handed out after all, or auctioned. */
  closeStoredParcel(id: string, outcome: "released" | "auctioned"): Promise<void>;

  // Drivers (see src/lib/drivers.ts)
  /** The signed-in user's driver page: application, current trip, history and cash. */
  driverHome(): Promise<DriverHome>;
  /** The signed QR code a driver shows at a station; valid DRIVER_PASS_MINUTES (R10). */
  driverPass(): Promise<DriverPass>;
  /** Converted drivers (0031): sends a code to the number or address for their waiting customer account. */
  sendFormerAccountCode(contact: string): Promise<void>;
  /** With that code and a new PIN, the waiting customer account becomes the person's. */
  claimFormerAccount(contact: string, code: string, pin: string): Promise<FormerAccount>;
  /** Applies to drive one of our vehicles (again, after a refusal). */
  applyDriver(input: DriverApplication): Promise<void>;
  /** A photo of the ID card, the licence or the applicant (shrunk in the app first). */
  uploadDriverDocument(kind: DriverDocument, image: Blob): Promise<void>;
  /** Joins the line at a station; the position proves the driver is there. */
  joinDriverQueue(stationId: string, position: LatLng | null): Promise<void>;
  leaveDriverQueue(): Promise<void>;
  /** The driver app's position while on duty (driver phase 2); kept: false when off duty. */
  /** Signs this phone up for push notices of the signed-in account (planung/fahrer.md phase 2). */
  registerPushToken(token: string, platform: "android" | "ios"): Promise<void>;
  reportDriverPosition(position: { lat: number; lng: number; accuracyM?: number | null }): Promise<{ kept: boolean }>;
  acceptJob(id: string): Promise<void>;
  /** The trip goes to the next in line; the driver goes to the back. */
  declineJob(id: string): Promise<void>;
  /** Gives back an accepted trip before the pickup, with the reason; the driver goes to the back of the line. */
  abandonJob(id: string, reason: AbandonReason): Promise<void>;
  /** Pickup at home: measured and paid; the parcel gets its tracking number. */
  collectPickup(id: string, measures: ParcelMeasures): Promise<DeliveryJob>;
  arriveAtDoor(id: string): Promise<void>;
  uploadDeliveryPhoto(id: string, image: Blob): Promise<void>;
  /** Hands the parcel over at the door for the recipient's pickup code. */
  deliverJob(id: string, code: string): Promise<void>;
  /** Nobody there after the waiting time: back to the station. */
  failDelivery(id: string): Promise<void>;
  /** Ride: the customer got on. */
  boardRide(id: string): Promise<void>;
  /** Ride: the customer got off and paid the fare. Courier: handed over for the recipient's code, or after a photo (no code). */
  finishRide(id: string, code?: string): Promise<void>;
  /** Trips the signed-in customer booked. */
  myJobs(): Promise<DeliveryJob[]>;
  bookPickup(input: PickupBooking): Promise<DeliveryJob>;
  /** A driver takes the customer from A to B; one open ride at a time. */
  bookRide(input: RideBooking): Promise<DeliveryJob>;
  /** Express parcel: a driver takes it at the sender's door straight to the recipient's door. */
  bookCourier(input: CourierBooking): Promise<DeliveryJob>;
  /** The recipient has a waiting parcel brought home; the driver gets the pickup right. */
  bookDelivery(parcelId: string, home: HomePoint, payWith?: TripPayment): Promise<DeliveryJob>;
  /** Customer (before the driver has the parcel) or admin. */
  cancelJob(id: string): Promise<void>;
  /** The sender (or the shop) confirms a courier handed over by photo arrived: the driver's held share is booked. */
  confirmCourierReceipt(jobId: string): Promise<void>;
  /** Station staff: drivers in line and parcels drivers take or bring. */
  stationDrivers(stationId: string): Promise<StationDrivers>;
  /** Station staff scanned a driver's QR code (or typed the code). */
  driverAtStation(stationId: string, badge: string): Promise<DriverAtStation>;
  /** Staff scan the trip's parcel into the driver's hands (another parcel is refused). */
  handToDriver(stationId: string, badge: string, jobId: string, parcelCode: string): Promise<void>;
  /** Staff scan in the parcel a driver brings. */
  receiveFromDriver(stationId: string, badge: string, jobId: string, parcelCode: string): Promise<void>;
  /** Daily settlement for the balance staff saw. */
  settleDriver(stationId: string, badge: string, amountFcfa: number): Promise<void>;
  /** Phase 2: the driver asks for what we owe them on Flooz or T-Money. */
  requestDriverPayout(network: PayoutNetwork, phone: string): Promise<DriverPayout>;
  /** Backoffice: payout requests of drivers, open ones first. */
  adminDriverPayouts(): Promise<AdminDriverPayout[]>;
  /** Backoffice: the money was sent (with the provider's reference), or the request is refused. */
  decideDriverPayout(id: string, status: "paid" | "rejected", reference?: string): Promise<void>;
  /** Backoffice: drivers, vehicles, trips and prices (admins only). */
  adminDrivers(): Promise<AdminDrivers>;
  reviewDriver(userId: string, decision: DriverDecision): Promise<void>;
  saveFleetVehicle(id: string | null, input: FleetVehicleInput): Promise<void>;
  saveDriverSettings(settings: DriverSettings): Promise<void>;
  assignJob(jobId: string, driverId: string): Promise<void>;
  /** Backoffice: the photo of a courier handed over without the code is fine: the driver's held share is booked. */
  approveCourierProof(jobId: string): Promise<void>;
  /** A displayable URL for a private photo (documents, door photos); admins only. */
  driverFileUrl(key: string): Promise<string>;
  /** Backoffice: links a driver to a fleet manager by phone or e-mail; null unlinks. */
  setDriverManager(driverId: string, contact: string | null): Promise<void>;

  // Fleet managers (see src/lib/fleet.ts)
  /** The manager's drivers and the trips nobody has yet. */
  fleetView(): Promise<FleetView>;
  /** Trips, takings, cash and charging of the manager's drivers; days as YYYY-MM-DD. */
  fleetStats(from: string, to: string): Promise<FleetStats>;
  /** Gives an open trip to one of the manager's drivers; the driver confirms as usual. */
  fleetAssign(jobId: string, driverId: string): Promise<void>;
  /**
   * Fleet manager registration: its own path, never a customer account (W5). Makes the
   * account and its fleet (pending until an admin approves it) and signs in.
   */
  registerFleetManager(contact: string, code: string, pin: string, fleetName: string): Promise<Profile>;
  /** Battery swaps billed to the fleet in the period, with their amounts (approved fleets). */
  fleetStatement(from: string, to: string): Promise<FleetStatement>;
  /** Invites a driver by phone number (R12: free number or empty customer account; R13: tier limit). */
  inviteFleetDriver(phone: string): Promise<FleetInvite>;
  revokeFleetInvite(inviteId: string): Promise<void>;
  /** Takes a driver out of the fleet; back to customer when nothing is open (R15). */
  removeFleetDriver(driverId: string): Promise<FleetRemoval>;
  /** Open fleet invites for the signed-in customer's phone number. */
  myFleetInvites(): Promise<MyFleetInvite[]>;
  /** Accepts an invite by its code; the account becomes a driver account in the fleet. */
  acceptFleetInvite(token: string, application?: DriverApplication): Promise<void>;
  declineFleetInvite(token: string): Promise<void>;
  /** Backoffice: every fleet, pending ones first (admins only). */
  adminFleets(): Promise<AdminFleet[]>;
  reviewFleet(managerId: string, action: FleetDecision): Promise<void>;
  setFleetTier(managerId: string, tier: FleetTier): Promise<void>;

  // Merchants (see src/lib/merchants.ts, planung/marchand.md)
  /**
   * Merchant registration: its own path, never a customer account (W5). Makes the account,
   * its shop (pending until an admin approves it) and the membership as its merchant, and signs in.
   */
  registerMerchant(contact: string, code: string, pin: string, shop: MerchantShopInput): Promise<Profile>;
  /** The signed-in member's shop: live trips, today's counts; the merchant also team and drivers. */
  merchantView(): Promise<MerchantView>;
  /** The shop's bookings in a period (YYYY-MM-DD, both days included), newest first. */
  merchantBookings(query: MerchantBookingsQuery): Promise<MerchantJob[]>;
  /** The shop's activity log (merchant only). */
  merchantActivity(): Promise<MerchantActivity[]>;
  /** The shop's statistics (merchant of an unlocked shop only). */
  merchantStats(query: MerchantStatsQuery): Promise<MerchantStats>;
  /** The merchant saves a pickup address, or removes one. */
  addMerchantAddress(input: MerchantAddressInput): Promise<MerchantAddress>;
  removeMerchantAddress(addressId: string): Promise<void>;
  /** A member confirms a courier whose recipient was absent is back at the shop. */
  confirmShopReturn(jobId: string): Promise<void>;
  updateMerchantShop(input: MerchantShopInput): Promise<void>;
  inviteMerchantEmployee(phone: string): Promise<MerchantInvite>;
  revokeMerchantInvite(inviteId: string): Promise<void>;
  /** Takes an employee out of the shop: back to a customer account (R15). */
  removeMerchantEmployee(userId: string): Promise<void>;
  /** A favorite (told only) or an assigned driver with a pay option (to approve). */
  addMerchantDriver(input: MerchantDriverInput): Promise<MerchantDriver>;
  /** A new pay option for an assigned driver: approved again. */
  changeMerchantPay(assignmentId: string, payMode: MerchantPayMode, ratePerHourFcfa: number | null): Promise<void>;
  /** Ends a favorite or an assignment (the merchant, the driver or an admin). */
  endMerchantDriver(assignmentId: string): Promise<void>;
  /** The merchant checks a driver out of the shop. */
  merchantCheckout(driverId: string): Promise<void>;
  /** Open shop invites for the signed-in customer's phone number. */
  myMerchantInvites(): Promise<MyMerchantInvite[]>;
  /** Accepts a shop invite: the account becomes an employee account of the shop. */
  acceptMerchantInvite(token: string): Promise<void>;
  declineMerchantInvite(token: string): Promise<void>;
  /** Assignments waiting for the signed-in driver, fleet manager (their drivers) or admin. */
  merchantAssignmentRequests(): Promise<MerchantAssignmentRequest[]>;
  decideMerchantAssignment(assignmentId: string, approve: boolean): Promise<void>;
  /** The driver's shops: assignments, favorites, the check-in and hours to confirm. */
  driverShops(): Promise<DriverShops>;
  /** "Je suis chez <shop>": within 500 m of the shop. */
  checkInAtShop(merchantId: string, position: LatLng): Promise<void>;
  checkOutOfShop(): Promise<void>;
  /** The driver confirms the shop paid the hours of a check-in. */
  confirmShopHoursReceived(checkinId: string): Promise<void>;
  /** Backoffice: every shop, pending ones first (admins only). */
  adminMerchants(): Promise<AdminMerchant[]>;
  reviewMerchant(merchantId: string, action: MerchantDecision): Promise<void>;
  setMerchantTier(merchantId: string, tier: MerchantTier): Promise<void>;
  setMerchantOwner(merchantId: string, userId: string): Promise<void>;
  adminRemoveMerchantEmployee(merchantId: string, userId: string): Promise<void>;

  // Partner API (see src/lib/partners.ts)
  /** Parcels other apps booked for drop-off at this station (its staff). */
  stationBookings(stationId: string): Promise<StationBooking[]>;
  /** Staff take in a booked parcel after measuring it and checking its content; it becomes a parcel. */
  acceptBooking(stationId: string, bookingId: string, measures: ParcelMeasures): Promise<Parcel>;
  /** Backoffice: partners, their keys and the latest webhook messages (admins only). */
  adminPartners(): Promise<AdminPartners>;
  savePartner(id: string | null, input: PartnerInput): Promise<void>;
  /** A new API key; the full key is only in this answer. */
  createPartnerKey(partnerId: string, label: string): Promise<PartnerKey & { key: string }>;
  revokePartnerKey(partnerId: string, keyId: string): Promise<void>;
  /** A new webhook secret; the partner must switch to it. */
  rotatePartnerSecret(partnerId: string): Promise<string>;
  /** Sends a webhook message again. */
  retryPartnerEvent(eventId: string): Promise<void>;

  // Advertising popup (see src/lib/promo.ts)
  /** The ad to show when the app opens, or null. Public. */
  currentPromotion(): Promise<Promotion | null>;
  /** All ads, newest first (admins only). */
  listPromotions(): Promise<Promotion[]>;
  savePromotion(id: string | null, input: PromotionInput): Promise<void>;
  deletePromotion(id: string): Promise<void>;
  /** Stores an image and returns its public URL (admins only). */
  uploadPromotionImage(file: File): Promise<string>;

  // Green Credit (see src/lib/wallet.ts)
  /** Balance, limit, Green Credit stations and history of the signed-in user. Fails with wallet_disabled while the module is off (admins may test). */
  myWallet(): Promise<WalletView>;
  /** The customer typed their PIN on their phone: the one-time code staff scan at the counter. */
  createCreditCode(pin: string): Promise<CreditCode>;
  /** Station staff: who a counter code belongs to and how much may still be loaded. */
  checkCreditCode(stationId: string, code: string): Promise<CounterCredit>;
  /** Station staff took the cash and load it on the customer's Green Credit. */
  topUpCredit(stationId: string, input: CreditTopupInput): Promise<CreditTopupResult>;
  /** Backoffice: switch, limit, stations, totals and the ledger (admins only). */
  adminWallet(filter?: { type?: string; userId?: string }): Promise<AdminWallet>;
  setWalletEnabled(enabled: boolean): Promise<void>;
  /** The highest balance a customer may hold (0 = no limit). */
  setCreditMax(maxXof: number): Promise<void>;
  /** Designates a station that loads and accepts Green Credit. */
  setStationGreenCredit(stationId: string, enabled: boolean): Promise<void>;
  adjustWallet(input: WalletAdjustInput): Promise<WalletTransaction>;
  setWalletFrozen(contact: string, frozen: boolean): Promise<void>;

  // greenpoint (see src/lib/greenpoint.ts)
  /** CO2 saved, level, greenpoints, rewards and history of the signed-in user. */
  myGreenpoint(): Promise<GreenpointView>;
  /** The vehicle that sets the CO2 of a swap or charge. */
  setGreenpointVehicle(vehicle: VehicleType): Promise<void>;
  /** A code for a reward, valid REDEEM_CODE_MINUTES; points are taken when staff enter it. */
  startRedemption(rewardId: string): Promise<GreenpointRedemption>;
  cancelRedemption(id: string): Promise<void>;
  /** Staff enter the code a rider shows for a reward. */
  confirmRedemption(stationId: string, code: string): Promise<GreenpointReceipt>;
  /** Backoffice: factors, rewards, totals and the latest movements (admins only). */
  adminGreenpoint(): Promise<AdminGreenpoint>;
  saveGreenpointFactors(factors: GreenpointFactors): Promise<void>;
  saveGreenpointReward(id: string | null, input: GreenpointRewardInput): Promise<void>;

  // Charging at a socket (see src/lib/charging.ts)
  /** Station staff: the charges running or waiting for payment, today's charges and takings. */
  stationCharging(stationId: string): Promise<StationCharging>;
  /** Staff switch an outlet on for a cash customer, or an app customer by phone, e-mail or scanned QR code. */
  startCharge(stationId: string, input: StartChargeInput): Promise<ChargeSession>;
  /** Staff switch the outlet off; the price is then final. */
  stopCharge(stationId: string, id: string): Promise<ChargeSession>;
  /** Closes a stopped charge that took no energy. */
  cancelCharge(stationId: string, id: string): Promise<ChargeSession>;
  /** Staff took the cash. */
  payChargeCash(stationId: string, id: string): Promise<ChargeSession>;
  /** The signed-in customer's charges, newest first, with the ways to pay in the app. */
  myCharges(): Promise<ChargeSession[]>;
  /** The socket box behind a scanned QR code: station, price and each outlet with whether it can start now (no sign-in needed). */
  chargeOutlet(token: string): Promise<ChargeOutletInfo>;
  /**
   * The customer starts the outlet they picked on the scanned box, paid in advance from Green
   * Credit (their PIN; only on our sockets at a Green Credit station where QR charging is on).
   */
  startOutletCharge(token: string, pointId: string, pin: string): Promise<ChargeSession>;
  /** The customer switches off a charge they started by QR code; the price is then final. */
  stopSelfCharge(id: string): Promise<ChargeSession>;
  /** Pays a stopped charge from the wallet; the PIN is checked on the server. */
  payChargeWallet(id: string, input: { pin: string; idempotencyKey: string }): Promise<ChargeSession>;
  /** Asks the customer's Flooz/T-Money account for the money; the charge is paid once the provider confirms. */
  payChargeMobile(id: string, input: { network: "flooz" | "tmoney"; phone: string }): Promise<void>;
  /** Asks the provider again while the customer confirms on the phone. */
  refreshChargePayment(paymentId: string): Promise<void>;
  /** Backoffice: tariffs and the latest charges (admins only). */
  adminCharging(): Promise<AdminCharging>;
  /** The network default (`stationId` null) or a station's own price (null values = default). */
  saveChargeTariff(input: ChargeTariffInput): Promise<void>;
  /** Backoffice: charging cards with their credit, the most recently swiped first (admins only). */
  adminChargeCards(): Promise<ChargeCard[]>;
  /** Adds a card by its number, or changes its name and the customer it belongs to (no contact: nobody). */
  saveChargeCard(input: ChargeCardInput): Promise<void>;
  /** Corrects a card's credit, either way, with a reason (admins only). */
  adjustChargeCard(idTag: string, amountXof: number, reason: string): Promise<void>;
  /** A blocked card no longer starts charges and takes no top-up; its credit stays. */
  setChargeCardBlocked(idTag: string, blocked: boolean): Promise<void>;
  /** Only a card without credit. */
  deleteChargeCard(idTag: string): Promise<void>;
  /** Station staff: whose account a card is linked to, and its Green Credit (cards are no longer topped up). */
  counterCard(stationId: string, idTag: string): Promise<CounterCard>;
}
