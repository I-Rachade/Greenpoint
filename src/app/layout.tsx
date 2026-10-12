import type { Metadata, Viewport } from "next";
import { Inter, Poppins } from "next/font/google";
import { AppProvider } from "@/components/app-provider";
import { Header } from "@/components/header";
import { I18nProvider } from "@/components/i18n-provider";
import { NativeShell } from "@/components/native-shell";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], weight: ["400", "600"] });
const poppins = Poppins({ variable: "--font-poppins", subsets: ["latin"], weight: ["600", "700"] });

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
          </AppProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
