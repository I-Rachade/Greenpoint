import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fully static site (see docs/DEPLOYMENT.md): every page talks to Supabase from the browser.
  output: "export",
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
