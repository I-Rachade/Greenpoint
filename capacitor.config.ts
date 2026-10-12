import type { CapacitorConfig } from "@capacitor/cli";

// Mobile app (Android now, iOS later): wraps the static export in `out/`.
// See docs/MOBILE.md.
const config: CapacitorConfig = {
  appId: "com.poinderecharge.app",
  appName: "poinderecharge",
  webDir: "out",
  android: {
    // The app ships its own files; only Supabase and map tiles come from the network.
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: "#0B3B2E",
      showSpinner: false,
    },
  },
};

export default config;
