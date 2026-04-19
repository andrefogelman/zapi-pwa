import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "falabem",
    short_name: "falabem",
    description: "Transcrição automática de áudios do WhatsApp",
    start_url: "/app",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#075e54",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
