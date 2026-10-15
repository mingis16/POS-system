"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { pendingSalesCount, syncQueuedSales } from "@/lib/offline/queue";

/** Registers the service worker and sends queued offline sales whenever the device is back online. */
export function SyncOnReconnect() {
  const router = useRouter();

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    }

    async function sync() {
      if (!navigator.onLine || pendingSalesCount() === 0) return;
      const { sent } = await syncQueuedSales();
      if (sent > 0) router.refresh();
    }
    sync();
    window.addEventListener("online", sync);
    const timer = window.setInterval(sync, 60_000);
    return () => {
      window.removeEventListener("online", sync);
      window.clearInterval(timer);
    };
  }, [router]);

  return null;
}
