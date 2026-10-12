import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { AppProvider } from "@/components/app-provider";
import { Header } from "@/components/header";
import { I18nProvider } from "@/components/i18n-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Greenpoint",
  description: "Trouvez la station de recharge ou d'échange de batterie la plus proche à Lomé.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Greenpoint", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#1DB954",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${geistSans.variable} h-full antialiased`}>
      <body className="flex h-full flex-col">
        <I18nProvider>
          <AppProvider>
            <Header />
            <main className="flex min-h-0 flex-1 flex-col">{children}</main>
          </AppProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
