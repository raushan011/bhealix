import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ConnectionStatus } from "@/components/pwa/connection-status";
import { ServiceWorker } from "@/components/pwa/service-worker";
import { NavigationProgress } from "@/components/layout/navigation-progress";
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
  viewportFit: "cover"
  /*
   * No `themeColor` here, deliberately. The browser's own chrome is painted by
   * the blocking script below and kept up to date by `paintBrowserChrome`,
   * which between them know things this export cannot — whether the device has
   * been overruled, and whether the monochrome palette is on.
   *
   * The stronger reason is that a tag rendered from here belongs to React.
   * `paintBrowserChrome` used to delete these two in order to have the last
   * word, and deleting a node React is managing left it calling `removeChild`
   * on a parent that had gone. It threw on the next navigation, the route never
   * committed, and the address bar moved while the page stayed where it was —
   * every client-side navigation in the application, for anybody whose theme
   * had been applied. One owner for that tag, and it is not React.
   */
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
      {/*
        In the root layout rather than in each shell, so it covers the panels,
        the login screens and the printable documents alike — every navigation
        in the application, including the ones between panels.

        The Suspense boundary is required: the bar reads the query string to
        know it has arrived, and `useSearchParams` opts its whole subtree into
        client rendering without one. Bounded here, the boundary contains a
        three-pixel line, and the static pages either side of it — both login
        screens and the registration form — stay static.
      */}
      <Suspense fallback={null}><NavigationProgress /></Suspense>
      <ConnectionStatus />
      <ServiceWorker />
      {children}
    </body>
  </html>;
}
