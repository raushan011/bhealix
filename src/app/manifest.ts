import type { MetadataRoute } from "next";

/**
 * Served at /manifest.webmanifest. `start_url` is the role-aware redirect at
 * "/", so one installed icon lands both the desk and the field panels in the
 * right place.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "BHEALIX CRM",
    short_name: "BHEALIX",
    description: "Doctor discovery, call scheduling and field visit management for BHEALIX",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: "#fff9ed",
    theme_color: "#73461f",
    categories: ["business", "medical", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ],
    // Long-press shortcuts for the three screens a rep opens between calls.
    shortcuts: [
      { name: "Today's visits", short_name: "Today", url: "/employee", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Doctors", short_name: "Doctors", url: "/employee/doctors", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Samples", short_name: "Samples", url: "/employee/samples", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] }
    ]
  };
}
