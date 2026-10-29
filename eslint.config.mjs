import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Native app projects (Capacitor), including the web files copied into them.
    "android/**",
    "ios/**",
    // Local Cloudflare Worker state and bundles.
    ".wrangler/**",
  ]),
  // Three parts that stay apart (docs/ARCHITEKTUR.md): the app in src/, the API in worker/
  // and the contract both use in shared/. The app reaches the API only over /api.
  {
    files: ["shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(@/|react|next)|(^|/)(src|worker)(/|$)",
              message: "shared/ runs in the app and in the Worker: it imports only from shared/.",
            },
          ],
        },
      ],
      "no-restricted-globals": ["error", "window", "document", "localStorage", "sessionStorage", "navigator"],
    },
  },
  {
    files: ["worker/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^@/|(^|/)src(/|$)",
              message: "The Worker never imports the app: code both need lives in shared/.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(^|/)worker(/|$)",
              message: "The app reaches the Worker only over /api (src/lib/backend/cloudflare.ts).",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
