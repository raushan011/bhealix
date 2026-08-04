import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    // Both files are unfingerprinted, and a cached service worker would pin the
    // browser to an old caching policy, so make them revalidate every time.
    const revalidate = { key: "Cache-Control", value: "public, max-age=0, must-revalidate" };
    return [
      { source: "/sw.js", headers: [revalidate, { key: "Content-Type", value: "text/javascript; charset=utf-8" }] },
      { source: "/offline.html", headers: [revalidate] }
    ];
  }
};
export default nextConfig;
