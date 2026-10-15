/**
 * Offline resilience for the POS. Power and data drop often, so a sale that
 * cannot reach the server is kept on the device and sent when the connection
 * returns. Each sale carries a client_ref (UUID) and the server stores a
 * client_ref once, so retrying is always safe.
 *
 * Browser-only. localStorage is small but synchronous and survives reloads;
 * a till's backlog of sales is a few hundred KB at most.
 */
import type { CatalogItem } from "@/lib/types";
import type { SalePayload } from "@/lib/validation";

const QUEUE_KEY = "sl:sales-queue:v1";
const CATALOG_KEY = (businessId: string) => `sl:catalog:v1:${businessId}`;
const EVENT = "sl-queue";

export interface QueuedSale {
  payload: SalePayload;
  queuedAt: string;
  attempts: number;
  /** Set when the server refused the sale (not a network error); needs a person to look at it. */
  error?: string;
  total: number;
}

function read(): QueuedSale[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as QueuedSale[];
  } catch {
    return [];
  }
}

function write(list: QueuedSale[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked: nothing more we can do on the device.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function queuedSales(): QueuedSale[] {
  return typeof window === "undefined" ? [] : read();
}

export function pendingSalesCount(): number {
  return typeof window === "undefined" ? 0 : read().length;
}

export function enqueueSale(payload: SalePayload, total: number) {
  const list = read().filter((s) => s.payload.client_ref !== payload.client_ref);
  list.push({ payload: { ...payload, offline: true }, queuedAt: new Date().toISOString(), attempts: 0, total });
  write(list);
}

export function discardQueuedSale(clientRef: string) {
  write(read().filter((s) => s.payload.client_ref !== clientRef));
}

export function subscribeQueue(cb: () => void): () => void {
  const handler = (e: Event) => {
    if (e.type === EVENT || (e as StorageEvent).key === QUEUE_KEY) cb();
  };
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

let syncing = false;

/**
 * Sends queued sales in order. Stops at the first network failure (still
 * offline); a sale the server rejects is kept with its error for review.
 */
export async function syncQueuedSales(): Promise<{ sent: number; failed: number }> {
  if (syncing || typeof window === "undefined") return { sent: 0, failed: 0 };
  syncing = true;
  let sent = 0;
  let failed = 0;
  try {
    for (const item of read()) {
      if (item.error) {
        failed++;
        continue;
      }
      let res: Response;
      try {
        res = await fetch("/api/sales", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item.payload),
        });
      } catch {
        break; // still offline
      }
      const list = read();
      const idx = list.findIndex((s) => s.payload.client_ref === item.payload.client_ref);
      if (res.ok) {
        if (idx >= 0) list.splice(idx, 1);
        sent++;
      } else if (res.status === 401 || res.status >= 500) {
        // Signed out or server trouble: try again later.
        if (idx >= 0) list[idx] = { ...list[idx], attempts: list[idx].attempts + 1 };
        write(list);
        break;
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (idx >= 0) list[idx] = { ...list[idx], attempts: list[idx].attempts + 1, error: body.error ?? "Rejected" };
        failed++;
      }
      write(list);
    }
  } finally {
    syncing = false;
  }
  return { sent, failed };
}

export function cacheCatalog(businessId: string, items: CatalogItem[]) {
  try {
    localStorage.setItem(CATALOG_KEY(businessId), JSON.stringify({ at: Date.now(), items }));
  } catch {
    // ignore quota errors
  }
}

export function cachedCatalog(businessId: string): { at: number; items: CatalogItem[] } | null {
  try {
    const raw = localStorage.getItem(CATALOG_KEY(businessId));
    return raw ? (JSON.parse(raw) as { at: number; items: CatalogItem[] }) : null;
  } catch {
    return null;
  }
}
