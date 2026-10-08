import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Budget Bible",
    short_name: "Budget",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f2ea",
    theme_color: "#f5f2ea",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
