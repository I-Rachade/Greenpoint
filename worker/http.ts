import type { BackendErrorCode } from "../src/lib/backend/backend";

/** An error the app understands; the code is translated in the UI. */
export class ApiError extends Error {
  constructor(
    public code: BackendErrorCode | "rate_limited" | "not_found" | "bad_request",
    public status = 400,
  ) {
    super(code);
  }
}

/** Origins allowed to call the API: the web app and the Android/iOS app (Capacitor). */
const ALLOWED_ORIGINS = [
  "https://app.poinderecharge.com",
  "https://localhost",
  "capacitor://localhost",
  "http://localhost",
  "http://localhost:3000",
  "http://localhost:8787",
];

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ApiError("bad_request");
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function uuid(): string {
  return crypto.randomUUID();
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomDigits(n: number): string {
  const bytes = crypto.getRandomValues(new Uint32Array(n));
  return [...bytes].map((b) => String(b % 10)).join("");
}
