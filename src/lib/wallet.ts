// Green Credit (formerly the Cashplus wallet): a closed prepaid credit in FCFA per user, for
// energy only. It is loaded in cash at the counter of a station an admin designated and spent
// there on what belongs to poinderecharge (a charge started by QR code, a battery swap, a
// charge with a card linked to the account), and on Share rides in the app. No transfers, no withdrawals, no online top-ups;
// every payment needs the customer's PIN, typed on their own phone. Shared by the app, the
// demo backend and the Worker. Plan: planung/credit-qr-plan.md (project folder).
//
// Amounts are whole francs (XOF has no subunit), so every amount is an integer.

export type WalletTxType =
  | "transfer" // user -> user; no longer possible, kept for the history
  | "admin_adjust" // correction or cash refund by an admin
  | "topup" // cash at a Green Credit station's counter (formerly also Flooz or T-Money)
  | "charge" // a charge or a battery swap paid from the credit (worker/charging.ts, worker/station-work.ts)
  | "trip"; // a Share ride paid from the credit (worker/share.ts); formerly a driver's trip or its refund

/** Direction from the owner's point of view; a transfer has one row per side with the same trxId. */
export type WalletTxAttribute = "send" | "received";

/** Phase 1 only books final transactions; pending/rejected come with cash-in and cash-out. */
export type WalletTxStatus = "success" | "pending" | "rejected";

/** Highest single amount anywhere in the wallet, as a sanity bound. */
export const WALLET_MAX_AMOUNT = 100_000_000;
export const WALLET_REMARK_MAX = 120;

/** Prefix of the transaction number per type (spec 1.3.1). */
const TRX_PREFIX: Record<WalletTxType, string> = { transfer: "SM", admin_adjust: "AB", topup: "AM", charge: "RC", trip: "CO" };

/** Transaction number shown to people: prefix + 8 digits 1-9 (unique per side in the database). */
export function newTrxId(type: WalletTxType, random: () => number = Math.random): string {
  let digits = "";
  for (let i = 0; i < 8; i++) digits += String(1 + Math.floor(random() * 9));
  return `${TRX_PREFIX[type]}${digits}`;
}

export interface WalletTransaction {
  id: string;
  trxId: string;
  type: WalletTxType;
  attribute: WalletTxAttribute;
  status: WalletTxStatus;
  /** Amount sent or received, without the fee. */
  amountXof: number;
  /** Fee paid by this side (0 on the receiving side). */
  feeXof: number;
  /** What left (send) or arrived in (received) the wallet. */
  totalXof: number;
  /** Balance after this booking. */
  balanceAfterXof: number;
  /** The other person, as shown to this side (name or masked contact); null for admin corrections. */
  counterparty: string | null;
  remark: string | null;
  createdAt: string;
}

/** What the signed-in user sees on the Green Credit page. */
export interface WalletView {
  /** False while the module is switched off; admins can still use it for testing. */
  enabled: boolean;
  /** True when the module is off but this user may test it (admins). */
  testMode: boolean;
  balanceXof: number;
  frozen: boolean;
  /** Highest balance allowed (0 = no limit). */
  maxXof: number;
  /** Where the credit can be loaded and spent. */
  stations: GreenCreditStation[];
  transactions: WalletTransaction[];
}

export interface GreenCreditStation {
  id: string;
  name: string;
}

/**
 * The one-time code the app shows after the customer typed their PIN on their phone. Staff
 * scan it (or type it) to load the credit or to take a swap from it. Valid a few minutes, used once.
 */
export interface CreditCode {
  code: string;
  expiresAt: string;
}

/** How long a counter code holds. */
export const CREDIT_CODE_MINUTES = 5;
const CREDIT_CODE_PREFIX = "GC-";

/** QR content of a counter code: "GC-" and 8 digits. */
export function creditCodePayload(code: string): string {
  return `${CREDIT_CODE_PREFIX}${code}`;
}

/** The 8 digits of a scanned or typed counter code ("GC-1234 5678", "12345678"), or null. */
export function parseCreditCode(text: string | null | undefined): string | null {
  const digits = String(text ?? "").trim().toUpperCase().replace(/^GC-?/, "").replace(/[\s-]/g, "");
  return /^\d{8}$/.test(digits) ? digits : null;
}

/** "12345678" -> "1234 5678", easier to read out at the counter. */
export function formatCreditCode(code: string): string {
  return `${code.slice(0, 4)} ${code.slice(4)}`;
}

/** What staff see after scanning a customer's counter code, before taking the cash. */
export interface CounterCredit {
  customer: string;
  balanceXof: number;
  /** The most that can still be loaded (null = no limit). */
  maxTopupXof: number | null;
}

/** Smallest amount loaded at the counter. */
export const CREDIT_TOPUP_MIN_XOF = 100;

export interface CreditTopupInput {
  code: string;
  amountXof: number;
}

export interface CreditTopupResult {
  customer: string;
  amountXof: number;
  balanceXof: number;
}

/** The most a customer may still load with this balance and limit (null = no limit). */
export function maxTopup(balanceXof: number, maxXof: number): number | null {
  return maxXof > 0 ? Math.max(0, maxXof - balanceXof) : null;
}

export type TopupNetwork = "flooz" | "tmoney" | "card";
export type TopupStatus = "pending" | "succeeded" | "failed" | "expired" | "cancelled";

/** A top-up from Flooz, T-Money or a card, before Green Credit (history and late confirmations only). */
export interface WalletTopup {
  id: string;
  amountXof: number;
  network: TopupNetwork;
  status: TopupStatus;
  failureReason: string | null;
  createdAt: string;
  paidAt: string | null;
  /** Card top-ups: the provider's page where the person types the card details (only in the answer that starts it). */
  checkoutUrl?: string | null;
}

export const TOPUP_NETWORK_LABEL: Record<TopupNetwork, string> = { flooz: "Flooz", tmoney: "T-Money", card: "Carte bancaire" };

/** One line in the backoffice ledger (both sides of every booking). */
export interface AdminWalletTransaction extends WalletTransaction {
  userId: string | null;
  userLabel: string | null;
  adminId: string | null;
}

export interface AdminWallet {
  enabled: boolean;
  /** Highest balance a customer may hold (0 = no limit). */
  maxXof: number;
  /** Every active station, with whether it is a Green Credit station. */
  stations: (GreenCreditStation & { greenCredit: boolean })[];
  totals: {
    /** Sum of all balances: what poinderecharge owes in energy. */
    balancesXof: number;
    wallets: number;
    /** Loaded in cash at the counters, all time. */
    toppedUpXof: number;
    transactions: number;
  };
  transactions: AdminWalletTransaction[];
}

export interface WalletAdjustInput {
  contact: string;
  /** refund: the customer got the amount back in cash (closing an account, for example). */
  direction: "add" | "subtract" | "refund";
  amountXof: number;
  remark: string;
}

/** A positive whole number of francs within the sanity bound, or null. */
export function parseAmount(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value.replace(/[\s.]/g, "")) : Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > WALLET_MAX_AMOUNT) return null;
  return n;
}

/** "+22896123456" -> "+228 96 •• •• 56", "kofi@mail.tg" -> "ko••@mail.tg". */
export function maskContact(contact: string): string {
  if (contact.includes("@")) {
    const [name, domain] = contact.split("@");
    return `${name.slice(0, 2)}••@${domain}`;
  }
  const digits = contact.replace(/^\+228/, "");
  return `+228 ${digits.slice(0, 2)} •• •• ${digits.slice(-2)}`;
}

/** "Kofi Mensah" -> "Kofi M." so the sender can check the recipient without seeing the full name. */
export function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

/** Label of a person as others see it (staff at the counter, history). */
export function personLabel(p: { fullName: string | null; phone: string | null; email: string | null }): string {
  if (p.fullName?.trim()) return shortName(p.fullName);
  return maskContact(p.phone ?? p.email ?? "?");
}

/** Start of today and of this month in Lomé (UTC, no daylight saving), as ISO strings. */
export function periodStarts(now: Date = new Date()): { day: string; month: string } {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  return { day, month };
}
