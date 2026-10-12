import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { AppProvider } from "@/components/app-provider";
import { Header } from "@/components/header";
import { I18nProvider } from "@/components/i18n-provider";
import { NativeShell } from "@/components/native-shell";
import { PromoPopup } from "@/components/promo-popup";
import "./globals.css";

// Fonts are bundled with the app so the build never has to reach Google Fonts.
const inter = localFont({
  variable: "--font-inter",
  src: [
    { path: "./fonts/inter-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/inter-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
});
const poppins = localFont({
  variable: "--font-poppins",
  src: [
    { path: "./fonts/poppins-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/poppins-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://app.poinderecharge.com"),
  title: "poinderecharge",
  description: "Trouvez la station de recharge ou d'échange de batterie la plus proche à Lomé.",
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    url: "https://app.poinderecharge.com",
    siteName: "poinderecharge",
    locale: "fr_TG",
    images: ["/icon-512.png"],
  },
  appleWebApp: { capable: true, title: "poinderecharge", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#1DB954",
  width: "device-width",
  initialScale: 1,
  // Edge to edge in the iOS/Android app; globals.css keeps content clear of the notch and home bar.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${inter.variable} ${poppins.variable} h-full antialiased`}>
      <body className="flex h-full flex-col">
        <I18nProvider>
          <AppProvider>
            <NativeShell />
            <Header />
            <main className="flex min-h-0 flex-1 flex-col">{children}</main>
            <PromoPopup />
          </AppProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
