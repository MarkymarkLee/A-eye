import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "A-eye",
    short_name: "A-eye",
    description: "Answer AI agents' questions about places near you and enter the raffle.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0b0f",
    theme_color: "#0b0b0f",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
