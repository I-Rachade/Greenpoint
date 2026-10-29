import type { NextConfig } from "next";
import { version } from "./package.json";

// Cloudflare sets WORKERS_CI (Workers Builds) or CF_PAGES (Pages) while building.
const hostedBuild = Boolean(process.env.WORKERS_CI || process.env.CF_PAGES);
// Builds on Cloudflare talk to the API of the Worker (worker/); local `npm run dev`
// runs the in-browser demo unless NEXT_PUBLIC_BACKEND=cloudflare is set.
const backend = process.env.NEXT_PUBLIC_BACKEND || (hostedBuild ? "cloudflare" : "demo");
// The back office (/admin) is only in its own build for admin.poinderecharge.com, where
// Cloudflare Access stands in front: `npm run build:admin` (wrangler.admin.jsonc) or `npm run dev:admin`.
// Its pages are named page.admin.tsx / layout.admin.tsx, so every other build leaves them out.
const backOffice = ["build:admin", "dev:admin"].includes(process.env.npm_lifecycle_event ?? "");

const nextConfig: NextConfig = {
  // Fully static site (see docs/DEPLOYMENT.md): every page calls /api/* from the browser.
  output: "export",
  pageExtensions: backOffice ? ["admin.tsx", "tsx", "ts"] : ["tsx", "ts"],
  env: {
    // Lets the demo know it is on the public site, where it must not offer staff or admin logins.
    NEXT_PUBLIC_HOSTED_BUILD: hostedBuild ? "1" : "",
    NEXT_PUBLIC_BACKEND: backend,
    NEXT_PUBLIC_BACKOFFICE_BUILD: backOffice ? "1" : "",
    // Shown in Settings.
    NEXT_PUBLIC_APP_VERSION: version,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
