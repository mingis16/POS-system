"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { CloudUpload, WifiOff } from "lucide-react";
import { pendingSalesCount, subscribeQueue } from "@/lib/offline/queue";

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** Shows when the device is offline and how many sales are waiting to sync. */
export function OfflineIndicator() {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    setPending(pendingSalesCount());
    return subscribeQueue(() => setPending(pendingSalesCount()));
  }, []);

  if (online && pending === 0) return null;
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
    >
      {online ? <CloudUpload aria-hidden className="h-3.5 w-3.5" /> : <WifiOff aria-hidden className="h-3.5 w-3.5" />}
      {online ? `Syncing ${pending}` : pending ? `Offline · ${pending} to sync` : "Offline"}
    </span>
  );
}
