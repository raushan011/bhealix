import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ConnectionStatus } from "@/components/pwa/connection-status";
import { ServiceWorker } from "@/components/pwa/service-worker";

export const metadata: Metadata = {
  title: "BHEALIX CRM",
  description: "Doctor discovery, call scheduling and field visit management for BHEALIX",
  applicationName: "BHEALIX CRM",
  appleWebApp: { capable: true, title: "BHEALIX", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon.svg", type: "image/svg+xml" }
    ],
    apple: { url: "/icons/apple-touch-icon.png", sizes: "180x180" }
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The shells pad with env(safe-area-inset-*), and those only resolve to real
  // values once the viewport covers the notch and home indicator.
  viewportFit: "cover",
  themeColor: "#73461f"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>
    <ConnectionStatus />
    <ServiceWorker />
    {children}
  </body></html>;
}
