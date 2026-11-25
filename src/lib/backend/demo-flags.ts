// The few demo settings the rest of the app reads. Kept apart from demo.ts so that a
// production build (NEXT_PUBLIC_BACKEND=cloudflare) leaves the whole demo backend out.

/** Every demo registration accepts this SMS code. */
export const DEMO_CODE = "123456";
/**
 * True when this build was made by Cloudflare (see next.config.ts) but set to the
 * demo backend. Visitors then see a clear notice and can only try the customer view.
 */
export const HOSTED_DEMO = process.env.NEXT_PUBLIC_HOSTED_BUILD === "1" && process.env.NEXT_PUBLIC_BACKEND === "demo";
