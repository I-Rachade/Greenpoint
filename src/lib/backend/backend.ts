import type {
  Operator,
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
import type { Promotion, PromotionInput } from "../promo";
import type { AdminWallet, SendMoneyInput, TopupInput, WalletAdjustInput, WalletFeeSetting, WalletRecipient, WalletTopup, WalletTransaction, WalletView } from "../wallet";

/** Where a code goes: by SMS to the phone number or by e-mail. */
export type CodeChannel = "sms" | "email";

export type StatusPatch = Partial<Pick<StationStatus, "isOpen" | "freeSlots" | "fullBatteries">>;

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
  | "same_station"
  | "parcel_too_large"
  | "parcel_not_found"
  | "parcel_wrong_status"
  | "code_locked"
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
  | "self_transfer"
  | "invalid_amount"
  | "amount_too_small"
  | "amount_too_large"
  | "daily_limit_exceeded"
  | "monthly_limit_exceeded"
  | "wallet_not_empty"
  | "topup_unavailable"
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

  // Rider
  myReservations(): Promise<Reservation[]>;
  reserve(stationId: string, type: ReservationType): Promise<Reservation>;
  cancelReservation(id: string): Promise<void>;

  // Station staff
  staffStations(): Promise<StationView[]>;
  updateStatus(stationId: string, patch: StatusPatch): Promise<void>;
  stationReservations(stationId: string): Promise<Reservation[]>;
  /** Needs the rider's pickup code; also takes the battery or slot off the station's counter. */
  completeReservation(id: string, pickupCode: string): Promise<void>;

  // Admin
  listOperators(): Promise<Operator[]>;
  saveStation(id: string | null, input: StationInput): Promise<void>;

  // Backoffice (admins only; see src/lib/admin)
  adminSnapshot(): Promise<AdminSnapshot>;
  auditLog(filter: AuditFilter): Promise<AuditEntry[]>;
  setUserRole(userId: string, role: UserRole): Promise<void>;
  assignStaff(stationId: string, userId: string): Promise<void>;
  unassignStaff(stationId: string, userId: string): Promise<void>;
  setStationActive(stationId: string, active: boolean): Promise<void>;

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
}
