import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  /*
   * `lucide-react` has no deep entry points — every icon in the app is a named
   * import off the package root, and the root re-exports about a thousand of
   * them. Left alone, touching any file that imports an icon makes the compiler
   * walk that barrel, which is most of why a dev rebuild takes as long as it
   * does, and it is the one dependency here big enough on disk to matter.
   *
   * This rewrites those imports to the individual modules at build time, so
   * only the icons actually used are ever read. Production output was already
   * tree-shaken; what changes is the work done to produce it, and the dev
   * server's compile time on nearly every file in the project.
   */
  experimental: {
    optimizePackageImports: ["lucide-react"]
  },
  async headers() {
    // Both files are unfingerprinted, and a cached service worker would pin the
    // browser to an old caching policy, so make them revalidate every time.
    const revalidate = { key: "Cache-Control", value: "public, max-age=0, must-revalidate" };
    /*
     * The app icons, which are the one set of images the browser fetches
     * without going through `next/image` — a favicon, an apple-touch-icon and
     * the four the manifest names are asked for by the browser and the OS,
     * which know nothing of the optimiser. Unheadered they come back
     * `max-age=0`, so an installed phone re-downloads a 51KB icon on every
     * cold start.
     *
     * A day held outright and a week of serving the old one while a new one is
     * fetched behind it. Not `immutable`, deliberately: these names are not
     * fingerprinted, so a rebrand would otherwise be pinned in every installed
     * app until somebody cleared their storage.
     */
    const artwork = { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" };
    return [
      { source: "/sw.js", headers: [revalidate, { key: "Content-Type", value: "text/javascript; charset=utf-8" }] },
      { source: "/offline.html", headers: [revalidate] },
      { source: "/icons/:file*", headers: [artwork] },
      { source: "/brand/:file*", headers: [artwork] }
    ];
  }
};
export default nextConfig;
