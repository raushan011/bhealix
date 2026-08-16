import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ConnectionStatus } from "@/components/pwa/connection-status";
import { ServiceWorker } from "@/components/pwa/service-worker";
import { THEME_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "BHEALIX CRM",
  description: "Doctor discovery, call scheduling and field visit management for BHEALIX",
  applicationName: "BHEALIX CRM",
  appleWebApp: { capable: true, title: "BHEALIX", statusBarStyle: "default" },
  icons: {
    // The logo is raster artwork, so there is no SVG variant to offer here.
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }
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
  // The browser paints its own chrome with this before the page has loaded, so
  // a dark device gets a dark bar rather than a walnut one over a dark page.
  // Only until the app is up: these know nothing of an overruled device or of
  // the monochrome palette, so `paintBrowserChrome` replaces them on mount with
  // the colour the page is actually painted in.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#73461f" },
    { media: "(prefers-color-scheme: dark)", color: "#15110d" }
  ]
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  /*
   * `suppressHydrationWarning` on <html>: the script below stamps `data-theme`
   * and `data-palette` on it before React arrives, so the served markup and the
   * live element differ by exactly those attributes. It suppresses nothing else
   * — the warning is scoped to this element's own attributes.
   */
  return <html lang="en" suppressHydrationWarning>
    <head>
      {/*
        Blocking, and before anything paints. Restoring the theme in an effect
        instead would show a cream flash on every fresh document to anybody who
        chose dark, which is the whole of what people notice about dark mode.
      */}
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
    </head>
    <body>
      <ConnectionStatus />
      <ServiceWorker />
      {children}
    </body>
  </html>;
}
