import type { Backend } from "./backend";
import { DemoBackend } from "./demo";
import { SupabaseBackend } from "./supabase";

export * from "./backend";
export { DemoBackend, DEMO_CODE, HOSTED_DEMO } from "./demo";

let instance: Backend | null = null;

/**
 * Picks Supabase when its keys are configured (see .env.example),
 * otherwise the in-browser demo. Client-side only.
 */
export function getBackend(): Backend {
  if (instance) return instance;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  instance = url && key ? new SupabaseBackend(url, key) : new DemoBackend();
  return instance;
}
