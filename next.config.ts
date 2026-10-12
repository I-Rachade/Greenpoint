import type { NextConfig } from "next";

// Cloudflare sets WORKERS_CI (Workers Builds) or CF_PAGES (Pages) while building.
const hostedBuild = Boolean(process.env.WORKERS_CI || process.env.CF_PAGES);
const hasSupabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
if (hostedBuild && !hasSupabase) {
  console.warn(
    "\n⚠ NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are missing: the live site runs as a labelled demo.\n",
  );
}

const nextConfig: NextConfig = {
  // Fully static site (see docs/DEPLOYMENT.md): every page talks to Supabase from the browser.
  output: "export",
  env: {
    // Lets the demo know it is on the public site, where it must not offer staff or admin logins.
    NEXT_PUBLIC_HOSTED_BUILD: hostedBuild ? "1" : "",
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
