import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GHSMTA Awards Portal",
    short_name: "GHSMTA",
    description:
      "Application, scheduling, messaging, and adjudication portal for the Georgia High School Musical Theatre Awards.",
    start_url: "/",
    display: "standalone",
    background_color: "#070b17",
    theme_color: "#070b17",
    icons: [
      {
        src: "/ghsmta-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/ghsmta-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
