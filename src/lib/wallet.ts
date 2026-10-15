// Wallet (Cashplus phase 1): a balance in FCFA per user, sending money to another
// user, fees and limits per product, and admin corrections. Shared by the app,
// the demo backend and the Worker. Plan: planung/cashplus-plan.md.
//
// Amounts are whole francs (XOF has no subunit), so every amount is an integer.

export type WalletTxType =
  | "transfer" // user -> user (spec: TRANSFER-MONEY)
  | "admin_adjust" // correction by an admin (spec: ADD-SUBTRACT-BALANCE)
  | "topup" // paid in from Flooz or T-Money (spec: ADD-MONEY)
  | "charge"; // a charge at a socket paid from the balance (worker/charging.ts)

/** Direction from the owner's point of view; a transfer has one row per side with the same trxId. */
export type WalletTxAttribute = "send" | "received";

/** Phase 1 only books final transactions; pending/rejected come with cash-in and cash-out. */
export type WalletTxStatus = "success" | "pending" | "rejected";

/** Products with their own fee and limits (spec: transaction_settings). */
export type WalletProduct = "transfer";
export const WALLET_PRODUCTS: WalletProduct[] = ["transfer"];

/** Fee and limits of one product. Limits of 0 mean "no limit". */
export interface WalletFeeSetting {
  product: WalletProduct;
  fixedXof: number;
  /** Percent of the amount, e.g. 1.5 for 1.5 %. */
  percent: number;
  minXof: number;
  maxXof: number;
  dailyXof: number;
  monthlyXof: number;
  isActive: boolean;
}

/** Starting values; admins change them in the backoffice. */
export const DEFAULT_FEE_SETTINGS: WalletFeeSetting[] = [
  { product: "transfer", fixedXof: 0, percent: 0, minXof: 100, maxXof: 500_000, dailyXof: 1_000_000, monthlyXof: 5_000_000, isActive: true },
];

/** Highest single amount anywhere in the wallet, as a sanity bound. */
export const WALLET_MAX_AMOUNT = 100_000_000;
export const WALLET_REMARK_MAX = 120;

/** Prefix of the transaction number per type (spec 1.3.1). */
const TRX_PREFIX: Record<WalletTxType, string> = { transfer: "SM", admin_adjust: "AB", topup: "AM", charge: "RC" };

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

export interface WalletUsage {
  todayXof: number;
  monthXof: number;
}

/** What the signed-in user sees on the wallet page. */
export interface WalletView {
  /** False while the module is switched off; admins can still use it for testing. */
  enabled: boolean;
  /** True when the module is off but this user may test it (admins). */
  testMode: boolean;
  balanceXof: number;
  frozen: boolean;
  transfer: WalletFeeSetting;
  usage: WalletUsage;
  /** What to put into a QR code so others can send to this user. */
  receiveCode: string | null;
  /** False while no real Flooz/T-Money provider is set up (admins can still test with the simulation). */
  topupAvailable: boolean;
  /** The same for top-ups by bank card. */
  cardTopupAvailable: boolean;
  transactions: WalletTransaction[];
}

export interface WalletRecipient {
  /** Name, or masked phone/e-mail when the person has no name. */
  label: string;
}

export interface SendMoneyInput {
  contact: string;
  amountXof: number;
  pin: string;
  /** Same key on a retry, so a double tap never pays twice. */
  idempotencyKey: string;
  remark?: string | null;
}

/** Bounds of one top-up from Flooz or T-Money. */
export const TOPUP_MIN_XOF = 100;
export const TOPUP_MAX_XOF = 500_000;

export type TopupNetwork = "flooz" | "tmoney" | "card";
export type TopupStatus = "pending" | "succeeded" | "failed" | "expired" | "cancelled";

/** A top-up from the user's Flooz or T-Money account. The wallet is credited once the provider confirms it. */
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

export interface TopupInput {
  amountXof: number;
  network: TopupNetwork;
  /** The Flooz/T-Money number that pays, +228…; not needed for a card. */
  phone?: string;
}

/**
 * Pre-selects the network from a +228 number (same prefixes as worker/payment-providers.ts):
 * Togocom T-Money 70–73, 90–93; Moov Africa Flooz 78, 79, 96–99. The person can always change it.
 */
export function guessTopupNetwork(phone: string | null | undefined): TopupNetwork {
  const prefix = /^\+228(\d{2})\d{6}$/.exec(phone ?? "")?.[1];
  return prefix && ["78", "79", "96", "97", "98", "99"].includes(prefix) ? "flooz" : "tmoney";
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
  settings: WalletFeeSetting[];
  totals: {
    /** Sum of all balances: what the platform owes its users. */
    balancesXof: number;
    wallets: number;
    /** Fees earned on successful transactions (spec: profit logs). */
    feesXof: number;
    transactions: number;
  };
  transactions: AdminWalletTransaction[];
}

export interface WalletAdjustInput {
  contact: string;
  direction: "add" | "subtract";
  amountXof: number;
  remark: string;
}

export interface FeeQuote {
  fixedXof: number;
  percentXof: number;
  feeXof: number;
  /** What leaves the sender's wallet: amount + fee. */
  payableXof: number;
}

/** Spec 1.3.3 for one currency: fee = fixed + amount × percent; the sender pays amount + fee. */
export function quoteFee(amountXof: number, s: Pick<WalletFeeSetting, "fixedXof" | "percent">): FeeQuote {
  const percentXof = Math.round((amountXof * s.percent) / 100);
  const feeXof = s.fixedXof + percentXof;
  return { fixedXof: s.fixedXof, percentXof, feeXof, payableXof: amountXof + feeXof };
}

export type LimitProblem = "amount_too_small" | "amount_too_large" | "daily_limit_exceeded" | "monthly_limit_exceeded";

/** Spec 1.3.4: single amount between min and max, today's and this month's successful sends within their limits. */
export function checkLimits(amountXof: number, s: WalletFeeSetting, usage: WalletUsage): LimitProblem | null {
  if (s.minXof > 0 && amountXof < s.minXof) return "amount_too_small";
  if (s.maxXof > 0 && amountXof > s.maxXof) return "amount_too_large";
  if (s.dailyXof > 0 && usage.todayXof + amountXof > s.dailyXof) return "daily_limit_exceeded";
  if (s.monthlyXof > 0 && usage.monthXof + amountXof > s.monthlyXof) return "monthly_limit_exceeded";
  return null;
}

/** How much more may still be sent today and this month (null = no limit). */
export function remaining(s: WalletFeeSetting, usage: WalletUsage): { todayXof: number | null; monthXof: number | null } {
  return {
    todayXof: s.dailyXof > 0 ? Math.max(0, s.dailyXof - usage.todayXof) : null,
    monthXof: s.monthlyXof > 0 ? Math.max(0, s.monthlyXof - usage.monthXof) : null,
  };
}

/** A positive whole number of francs within the sanity bound, or null. */
export function parseAmount(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value.replace(/[\s.]/g, "")) : Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > WALLET_MAX_AMOUNT) return null;
  return n;
}

/** Checks a fee setting from the backoffice; returns it cleaned up or null. */
export function validFeeSetting(s: WalletFeeSetting): WalletFeeSetting | null {
  const ints = [s.fixedXof, s.minXof, s.maxXof, s.dailyXof, s.monthlyXof];
  if (!WALLET_PRODUCTS.includes(s.product)) return null;
  if (ints.some((n) => !Number.isInteger(n) || n < 0 || n > WALLET_MAX_AMOUNT)) return null;
  if (!Number.isFinite(s.percent) || s.percent < 0 || s.percent > 50) return null;
  if (s.maxXof > 0 && s.minXof > s.maxXof) return null;
  return { ...s, percent: Math.round(s.percent * 100) / 100, isActive: !!s.isActive };
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

/** Label of a person for the other side of a transfer. */
export function personLabel(p: { fullName: string | null; phone: string | null; email: string | null }): string {
  if (p.fullName?.trim()) return shortName(p.fullName);
  return maskContact(p.phone ?? p.email ?? "?");
}

const RECEIVE_PREFIX = "poinderecharge:pay:";

/** QR payload for receiving money: the contact the sender types otherwise. */
export function receivePayload(contact: string): string {
  return `${RECEIVE_PREFIX}${contact}`;
}

/** The contact in a scanned receive QR code, or the text itself when someone typed a contact. */
export function parseReceivePayload(text: string): string {
  const t = text.trim();
  return t.startsWith(RECEIVE_PREFIX) ? t.slice(RECEIVE_PREFIX.length) : t;
}

/** Start of today and of this month in Lomé (UTC, no daylight saving), as ISO strings. */
export function periodStarts(now: Date = new Date()): { day: string; month: string } {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  return { day, month };
}
