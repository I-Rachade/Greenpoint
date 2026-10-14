import type { BatteryType, BatteryTypeInput } from "../battery-types";
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
import type { AdminSnapshot, AuditEntry, AuditFilter } from "../admin/types";
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
import type {
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
  StationDrivers,
} from "../drivers";
import type { FleetStats, FleetView } from "../fleet";
import type { LatLng } from "../geo";
import type { AdminWallet, SendMoneyInput, TopupInput, WalletAdjustInput, WalletFeeSetting, WalletRecipient, WalletTopup, WalletTransaction, WalletView } from "../wallet";

/** Where a code goes: by SMS to the phone number or by e-mail. */
export type CodeChannel = "sms" | "email";

export type StatusPatch = Partial<Pick<StationStatus, "isOpen" | "freeSlots" | "fullBatteries">> & {
  /** Full batteries per battery type (id → count); the station's total becomes their sum. */
  typeBatteries?: Record<string, number>;
};

/** Error codes shared by both backends, translated in the UI (see i18n `errors`). */
export type BackendErrorCode =
  | "not_authenticated"
  | "already_reserved"
  | "station_not_found"
  | "station_closed"
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
  | "vehicle_unavailable"
  | "vehicle_too_small"
  | "has_other_role"
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
  | "reward_unavailable"
  | "redemption_open"
  | "not_enough_points"
  | "greenpoint_daily_limit"
  | "greenpoint_fleet_driver"
  | "greenpoint_not_solar"
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

  // Customer
  myReservations(): Promise<Reservation[]>;
  reserve(stationId: string, type: ReservationType): Promise<Reservation>;
  cancelReservation(id: string): Promise<void>;

  // Station staff
  staffStations(): Promise<StationView[]>;
  updateStatus(stationId: string, patch: StatusPatch): Promise<void>;
  stationReservations(stationId: string): Promise<Reservation[]>;
  /** Needs the customer's pickup code; also takes the battery or slot off the station's counter. */
  completeReservation(id: string, pickupCode: string): Promise<void>;

  // Operator accounts (see src/lib/operators.ts)
  /** The operators the signed-in person runs, their stations and staff. */
  ownerView(): Promise<OwnerView>;
  /** Makes the account with this phone number or e-mail address staff of one of the operator's stations. */
  ownerAddStaff(stationId: string, contact: string): Promise<void>;
  ownerRemoveStaff(stationId: string, userId: string): Promise<void>;
  ownerSaveStation(stationId: string, input: OwnerStationInput): Promise<void>;

  // Admin
  listOperators(): Promise<Operator[]>;
  saveStation(id: string | null, input: StationInput): Promise<void>;
  /** Battery types of the motorbike brands, including switched-off ones (admins only). */
  listBatteryTypes(): Promise<BatteryType[]>;
  saveBatteryType(id: string | null, input: BatteryTypeInput): Promise<void>;

  // Backoffice (admins only; see src/lib/admin)
  adminSnapshot(): Promise<AdminSnapshot>;
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
  createDevice(input: DeviceInput): Promise<void>;
  /** Removes a socket and its charging points. */
  deleteDevice(externalId: string): Promise<void>;
  /** Switches an outlet on (until full) or off; only where `canSwitch`. */
  switchOutlet(externalId: string, outlet: number, on: boolean): Promise<void>;

  // Modules (see src/lib/features.ts)
  /** Which modules are switched on. Public. */
  features(): Promise<Features>;
  /** Backoffice: switches the parcel module on or off for everyone (admins only). */
  setParcelsEnabled(enabled: boolean): Promise<void>;

  // Parcel depot (see src/lib/parcels.ts)
  /** Stations that take parcels, and the prices. Public. */
  parcelInfo(): Promise<ParcelInfo>;
  /** Parcels the signed-in customer sent or is to receive; the pickup code only for the recipient. */
  myParcels(): Promise<Parcel[]>;
  /** Parcels handed in at or coming to this station (its staff; never with pickup codes). */
  stationParcels(stationId: string): Promise<Parcel[]>;
  /** Staff at the sending station register a parcel paid in cash; creates accounts for unknown phone numbers. */
  createParcel(stationId: string, input: ParcelInput): Promise<Parcel>;
  /** Staff at the sending station load parcels for the collection run. */
  markParcelsInTransit(stationId: string, ids: string[]): Promise<void>;
  /** Staff at the destination confirm arrival; each parcel gets its pickup code and the recipient is told. */
  markParcelsArrived(stationId: string, ids: string[]): Promise<void>;
  /** Staff at the destination hand out a parcel for its code or scanned QR code. */
  pickUpParcel(stationId: string, codeOrQr: string): Promise<Parcel>;
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
  /** Applies to drive one of our vehicles (again, after a refusal). */
  applyDriver(input: DriverApplication): Promise<void>;
  /** A photo of the ID card, the licence or the applicant (shrunk in the app first). */
  uploadDriverDocument(kind: DriverDocument, image: Blob): Promise<void>;
  /** Joins the line at a station; the position proves the driver is there. */
  joinDriverQueue(stationId: string, position: LatLng | null): Promise<void>;
  leaveDriverQueue(): Promise<void>;
  acceptJob(id: string): Promise<void>;
  /** The trip goes to the next in line; the driver goes to the back. */
  declineJob(id: string): Promise<void>;
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
  /** Ride: the customer got off and paid the fare. */
  finishRide(id: string): Promise<void>;
  /** Trips the signed-in customer booked. */
  myJobs(): Promise<DeliveryJob[]>;
  bookPickup(input: PickupBooking): Promise<DeliveryJob>;
  /** A driver takes the customer from A to B; one open ride at a time. */
  bookRide(input: RideBooking): Promise<DeliveryJob>;
  /** The recipient has a waiting parcel brought home; the driver gets the pickup right. */
  bookDelivery(parcelId: string, home: HomePoint): Promise<DeliveryJob>;
  /** Customer (before the driver has the parcel) or admin. */
  cancelJob(id: string): Promise<void>;
  /** Station staff: drivers in line and parcels drivers take or bring. */
  stationDrivers(stationId: string): Promise<StationDrivers>;
  /** Station staff scanned a driver's QR code (or typed the code). */
  driverAtStation(stationId: string, badge: string): Promise<DriverAtStation>;
  handToDriver(stationId: string, badge: string, jobId: string): Promise<void>;
  receiveFromDriver(stationId: string, badge: string, jobId: string): Promise<void>;
  /** Daily settlement for the balance staff saw. */
  settleDriver(stationId: string, badge: string, amountFcfa: number): Promise<void>;
  /** Backoffice: drivers, vehicles, trips and prices (admins only). */
  adminDrivers(): Promise<AdminDrivers>;
  reviewDriver(userId: string, decision: DriverDecision): Promise<void>;
  saveFleetVehicle(id: string | null, input: FleetVehicleInput): Promise<void>;
  saveDriverSettings(settings: DriverSettings): Promise<void>;
  assignJob(jobId: string, driverId: string): Promise<void>;
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

  // Wallet (see src/lib/wallet.ts)
  /** Balance, fees, limits and history of the signed-in user. Fails with wallet_disabled while the module is off (admins may test). */
  myWallet(): Promise<WalletView>;
  /** Who would get money sent to this phone number or e-mail address. */
  findWalletRecipient(contact: string): Promise<WalletRecipient>;
  /** Sends money; the PIN is checked on the server. */
  sendMoney(input: SendMoneyInput): Promise<WalletTransaction>;
  /** Asks the person's Flooz/T-Money account for the money; the wallet is credited once the provider confirms. */
  startTopup(input: TopupInput): Promise<WalletTopup>;
  /** Asks again for the status of a top-up while the person confirms on the phone. */
  refreshTopup(id: string): Promise<WalletTopup>;
  /** Backoffice: switch, fees, totals and the ledger (admins only). */
  adminWallet(filter?: { type?: string; userId?: string }): Promise<AdminWallet>;
  setWalletEnabled(enabled: boolean): Promise<void>;
  saveWalletFees(setting: WalletFeeSetting): Promise<void>;
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
  /** Staff enter a swap or charge without reservation by the rider's phone number or e-mail. */
  recordGreenpointVisit(stationId: string, input: { contact: string; service: "swap" | "charge"; vehicle?: VehicleType }): Promise<GreenpointReceipt>;
  /** Staff enter the code a rider shows for a reward. */
  confirmRedemption(stationId: string, code: string): Promise<GreenpointReceipt>;
  /** Backoffice: factors, rewards, totals and the latest movements (admins only). */
  adminGreenpoint(): Promise<AdminGreenpoint>;
  saveGreenpointFactors(factors: GreenpointFactors): Promise<void>;
  saveGreenpointReward(id: string | null, input: GreenpointRewardInput): Promise<void>;
}
