"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { CloudOff, RefreshCw, Trash2 } from "lucide-react";
import { discardQueuedSale, queueSnapshot, subscribeQueue, syncQueuedSales, type QueuedSale } from "@/lib/offline/queue";
import { formatDateTime, formatMoney } from "@/lib/format";
import { buttonSecondary, buttonSmall } from "@/components/ui/styles";

/** Sales saved on this device while offline, with any the server refused. */
export function QueuedSalesPanel() {
  const raw = useSyncExternalStore(subscribeQueue, queueSnapshot, () => "[]");
  const list = useMemo<QueuedSale[]>(() => {
    try {
      return JSON.parse(raw) as QueuedSale[];
    } catch {
      return [];
    }
  }, [raw]);
  const [busy, setBusy] = useState(false);

  if (!list.length) return null;
  return (
    <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/40">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
          <CloudOff className="h-4 w-4" /> {list.length} sale(s) on this device waiting to be sent
        </p>
        <button
          className={`${buttonSecondary} ${buttonSmall}`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await syncQueuedSales();
            setBusy(false);
          }}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Send now
        </button>
      </div>
      <ul className="mt-3 flex flex-col gap-1.5">
        {list.map((s) => (
          <li key={s.payload.client_ref} className="flex items-center justify-between gap-2">
            <span>
              {formatDateTime(s.queuedAt)} · {formatMoney(s.total)} · {s.payload.items.length} line(s)
              {s.error && <span className="ml-2 text-red-700 dark:text-red-400">Refused: {s.error}</span>}
            </span>
            {s.error && (
              <button
                onClick={() => window.confirm("Remove this refused sale from the device? Re-enter it on the till if it really happened.") && discardQueuedSale(s.payload.client_ref)}
                className="p-1 text-zinc-500 hover:text-red-600"
                aria-label="Discard"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
