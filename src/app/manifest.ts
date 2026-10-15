import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/constants";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${APP_NAME} — sales, stock & books`,
    short_name: APP_NAME,
    description: "Point of sale, inventory, bookkeeping and anti-theft controls for Sierra Leone businesses.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f6f7f5",
    theme_color: "#0e9a5a",
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "New sale", url: "/pos" },
      { name: "Receive stock", url: "/receiving/new" },
      { name: "Cash-up", url: "/cash-up" },
    ],
  };
}
