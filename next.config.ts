import { copyFileSync, writeFileSync } from "node:fs";
import type { NextConfig } from "next";
import { version } from "./package.json";

// MapLibre 6 draws the map in a Web Worker it finds next to its own file (import.meta.url),
// which the bundled app no longer has: without this file every map stays empty (no streets,
// no route). It is copied into public/ on each dev and build; src/components/station-map.tsx
// points MapLibre at it. Not committed (.gitignore): it always matches the installed version.
copyFileSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "public/maplibre-gl-worker.mjs");

// One id per build, also served as /version.txt (not committed): an app left open in the
// background asks for it when it comes back and reloads when a newer version went online
// meanwhile (src/components/resume-guard.tsx). Kept in the environment so that every
// process of the same build agrees on it.
process.env.GP_BUILD_ID ??= process.env.WORKERS_CI_COMMIT_SHA || Date.now().toString(36);
writeFileSync("public/version.txt", process.env.GP_BUILD_ID);

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
    NEXT_PUBLIC_BUILD_ID: process.env.GP_BUILD_ID,
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
