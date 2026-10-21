// Flooz / T-Money payment providers. Dependency-free (no D1, no Worker types) so
// the app's tests can run it in Node with a fake fetch. The Worker routes that
// use it are in worker/payments.ts. See docs/ZAHLUNGEN.md.

export type PaymentNetwork = "flooz" | "tmoney";
export type PaymentStatus = "pending" | "succeeded" | "failed" | "expired" | "cancelled";
export const PAYMENT_NETWORKS: PaymentNetwork[] = ["flooz", "tmoney"];

/**
 * Mobile prefixes in Togo (first two of the eight digits after +228).
 * Togocom (T-Money): 70–73, 90–93. Moov Africa (Flooz): 78, 79, 96–99.
 * Numbers can be ported or new ranges opened, so the app only pre-selects the
 * network; the customer can always change it.
 */
const NETWORK_PREFIXES: Record<PaymentNetwork, string[]> = {
  tmoney: ["70", "71", "72", "73", "90", "91", "92", "93"],
  flooz: ["78", "79", "96", "97", "98", "99"],
};

/** Guesses the wallet from a +228 number, or null if the prefix is unknown. */
export function detectNetwork(phoneE164: string): PaymentNetwork | null {
  const match = /^\+228(\d{2})\d{6}$/.exec(phoneE164);
  if (!match) return null;
  for (const network of PAYMENT_NETWORKS) {
    if (NETWORK_PREFIXES[network].includes(match[1])) return network;
  }
  return null;
}

export interface StartRequest {
  /** Our order reference, unique per payment (payments.identifier). */
  identifier: string;
  amountXof: number;
  /** E.164, +228XXXXXXXX. */
  phone: string;
  network: PaymentNetwork;
  description: string;
}

export interface ProviderStatus {
  status: PaymentStatus;
  providerReference?: string;
  failureReason?: string;
}

/** What every payment provider (PayGate Global, later CinetPay, Semoa …) must offer. */
export interface PaymentProvider {
  readonly name: string;
  /** Asks the provider to send the payment request to the customer's phone. */
  start(request: StartRequest): Promise<{ providerReference?: string }>;
  /** Asks the provider for the current status. Callbacks are only a hint to call this. */
  fetchStatus(identifier: string): Promise<ProviderStatus>;
}

export class ProviderError extends Error {}

type Fetch = typeof fetch;

// PayGate Global ----------------------------------------------------------------
// Togolese aggregator for Flooz and T-Money (paygateglobal.com). Field names
// follow PayGate's integration guide; confirm them against the guide in the
// merchant dashboard once the account is active.

const PAYGATE_BASE = "https://paygateglobal.com";

/** Status codes of PayGate's status endpoint. */
const PAYGATE_STATUS: Record<number, PaymentStatus> = {
  0: "succeeded",
  2: "pending",
  4: "expired",
  6: "cancelled",
};

/** Error codes of PayGate's payment request. */
const PAYGATE_START_ERRORS: Record<number, string> = {
  2: "invalid_auth_token",
  4: "invalid_parameters",
  6: "duplicate_identifier",
};

export function paygateProvider(authToken: string, fetchImpl: Fetch = fetch): PaymentProvider {
  async function post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetchImpl(`${PAYGATE_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth_token: authToken, ...body }),
    });
    if (!response.ok) throw new ProviderError(`paygate_http_${response.status}`);
    const json = (await response.json()) as unknown;
    if (typeof json !== "object" || json === null) throw new ProviderError("paygate_bad_response");
    return json as Record<string, unknown>;
  }

  return {
    name: "paygate",
    async start(request) {
      const json = await post("/api/v1/pay", {
        // PayGate expects the eight local digits without +228.
        phone_number: request.phone.replace(/^\+228/, ""),
        amount: request.amountXof,
        description: request.description,
        identifier: request.identifier,
        network: request.network === "flooz" ? "FLOOZ" : "TMONEY",
      });
      const code = Number(json.status);
      if (code !== 0) throw new ProviderError(PAYGATE_START_ERRORS[code] ?? `paygate_status_${json.status}`);
      return { providerReference: json.tx_reference == null ? undefined : String(json.tx_reference) };
    },
    async fetchStatus(identifier) {
      const json = await post("/api/v2/status", { identifier });
      const status = PAYGATE_STATUS[Number(json.status)];
      if (!status) throw new ProviderError(`paygate_unknown_status_${json.status}`);
      return {
        status,
        providerReference: json.tx_reference == null ? undefined : String(json.tx_reference),
      };
    },
  };
}

// Simulated provider ------------------------------------------------------------
// Used whenever no real credentials are configured. Charges nobody and keeps no
// state, because each Worker request may run in a fresh isolate. A number
// ending in 0 simulates a request the wallet rejects; any other payment counts
// as confirmed on the phone as soon as the app asks for its status.

export function mockProvider(): PaymentProvider {
  return {
    name: "mock",
    async start(request) {
      if (request.phone.endsWith("0")) throw new ProviderError("mock_declined");
      return { providerReference: `mock_${request.identifier}` };
    },
    async fetchStatus(identifier) {
      return { status: "succeeded", providerReference: `mock_${identifier}` };
    },
  };
}

/**
 * Picks the provider from the Worker's settings. Anything other than an explicit
 * `PAYMENTS_PROVIDER=paygate` with a token runs the simulation, so a missing or
 * mistyped secret can never send a real payment request.
 */
export function providerFromEnv(env: (key: string) => string | undefined, fetchImpl: Fetch = fetch): PaymentProvider {
  const token = env("PAYGATE_AUTH_TOKEN");
  if (env("PAYMENTS_PROVIDER") === "paygate" && token) return paygateProvider(token, fetchImpl);
  return mockProvider();
}

/** Compares two secrets without leaking how many leading characters match. */
export function safeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// Card payments (Visa / Mastercard) -------------------------------------------------
// Cards need a page of the provider where the person types the card details, so
// the provider gives back a checkout URL the app opens; the status is then
// fetched like for mobile money. CinetPay (cinetpay.com) takes cards in Togo.
// Field names follow CinetPay's API v2 documentation; check them against the
// merchant dashboard once the account is active.

export interface CheckoutRequest {
  /** Our order reference (wallet_topups.identifier). */
  identifier: string;
  /** Whole francs; CinetPay wants a multiple of 5. */
  amountXof: number;
  description: string;
  /** Where the provider sends the person back after paying. */
  returnUrl: string;
  /** Where the provider reports the result (our callback). */
  notifyUrl: string;
  customer: { name: string | null; email: string | null; phone: string | null };
}

export interface CheckoutProvider {
  readonly name: string;
  startCheckout(request: CheckoutRequest): Promise<{ checkoutUrl: string; providerReference?: string }>;
  fetchStatus(identifier: string): Promise<ProviderStatus>;
}

const CINETPAY_BASE = "https://api-checkout.cinetpay.com/v2";

/** Transaction statuses of CinetPay's check endpoint; anything else is still open. */
const CINETPAY_STATUS: Record<string, PaymentStatus> = {
  ACCEPTED: "succeeded",
  REFUSED: "failed",
  CANCELED: "cancelled",
  CANCELLED: "cancelled",
};

export function cinetpayProvider(apiKey: string, siteId: string, fetchImpl: Fetch = fetch): CheckoutProvider {
  async function post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetchImpl(`${CINETPAY_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey: apiKey, site_id: siteId, ...body }),
    });
    const json = (await response.json().catch(() => null)) as unknown;
    if (typeof json !== "object" || json === null) throw new ProviderError(`cinetpay_http_${response.status}`);
    return json as Record<string, unknown>;
  }

  return {
    name: "cinetpay",
    async startCheckout(request) {
      const [first, ...rest] = (request.customer.name ?? "").trim().split(/\s+/);
      const json = await post("/payment", {
        transaction_id: request.identifier,
        amount: request.amountXof,
        currency: "XOF",
        description: request.description,
        notify_url: request.notifyUrl,
        return_url: request.returnUrl,
        channels: "CREDIT_CARD",
        lang: "fr",
        // Card payments require the holder's details; the bank checks them, not us.
        customer_name: first || "Client",
        customer_surname: rest.join(" ") || "poinderecharge",
        customer_email: request.customer.email ?? "noreply@poinderecharge.com",
        customer_phone_number: request.customer.phone ?? "",
        customer_address: "Lomé",
        customer_city: "Lomé",
        customer_country: "TG",
        customer_state: "TG",
        customer_zip_code: "00228",
      });
      const data = json.data as Record<string, unknown> | undefined;
      if (String(json.code) !== "201" || typeof data?.payment_url !== "string") {
        throw new ProviderError(`cinetpay_${String(json.code ?? "error")}`);
      }
      return { checkoutUrl: data.payment_url, providerReference: typeof data.payment_token === "string" ? data.payment_token : undefined };
    },
    async fetchStatus(identifier) {
      const json = await post("/payment/check", { transaction_id: identifier });
      const data = json.data as Record<string, unknown> | undefined;
      const status = CINETPAY_STATUS[String(data?.status ?? "")] ?? "pending";
      return {
        status,
        providerReference: data?.operator_id == null ? undefined : String(data.operator_id),
        failureReason: status === "failed" || status === "cancelled" ? `cinetpay_${String(data?.status).toLowerCase()}` : undefined,
      };
    },
  };
}

/** Simulated card checkout: the "checkout page" is the return URL itself, and the payment counts as done. */
export function mockCheckoutProvider(): CheckoutProvider {
  return {
    name: "mock",
    async startCheckout(request) {
      return { checkoutUrl: request.returnUrl, providerReference: `mock_${request.identifier}` };
    },
    async fetchStatus(identifier) {
      return { status: "succeeded", providerReference: `mock_${identifier}` };
    },
  };
}

/** `CARD_PROVIDER=cinetpay` with both keys switches card payments on; anything else runs the simulation. */
export function cardProviderFromEnv(env: (key: string) => string | undefined, fetchImpl: Fetch = fetch): CheckoutProvider {
  const apiKey = env("CINETPAY_API_KEY");
  const siteId = env("CINETPAY_SITE_ID");
  if (env("CARD_PROVIDER") === "cinetpay" && apiKey && siteId) return cinetpayProvider(apiKey, siteId, fetchImpl);
  return mockCheckoutProvider();
}
