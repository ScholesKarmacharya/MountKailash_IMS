import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mount Kailash Driver",
    short_name: "Kailash",
    start_url: "/driver/home",
    scope: "/",
    display: "standalone",
    background_color: "#f4f7fb",
    theme_color: "#0d7280",
    icons: [
      {
        src: "/offline-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
