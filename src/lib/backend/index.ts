import type { Backend } from "./backend";
import { CloudflareBackend } from "./cloudflare";
import { DemoBackend } from "./demo";

export * from "./backend";
export { DEMO_CODE, HOSTED_DEMO } from "./demo-flags";

let instance: Backend | null = null;

/**
 * Picks the Cloudflare API, or the in-browser demo when NEXT_PUBLIC_BACKEND is
 * "demo" (the default for `npm run dev`; see next.config.ts). Client-side only.
 */
export function getBackend(): Backend {
  instance ??=
    process.env.NEXT_PUBLIC_BACKEND === "demo"
      ? new DemoBackend()
      : new CloudflareBackend(process.env.NEXT_PUBLIC_API_URL ?? "");
  return instance;
}
