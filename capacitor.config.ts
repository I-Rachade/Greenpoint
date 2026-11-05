import type { CapacitorConfig } from "@capacitor/cli";

// Mobile app (Android and iOS): wraps the static export in `out/`.
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
    // Edge to edge: the page pads itself for the status and gesture bars (globals.css --gp-safe-*).
    // "css" also hands the real sizes to the page, for Android WebViews where env() reads 0.
    SystemBars: {
      insetsHandling: "css",
      initialViewportFitValueHint: "cover",
    },
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: "#0B3B2E",
      showSpinner: false,
    },
  },
};

export default config;
