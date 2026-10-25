"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { clsx } from "clsx";
import {
  AlertOctagon,
  Camera,
  Check,
  ChevronUp,
  Loader2,
  Minus,
  Plus,
  ScanBarcode,
  Search,
  ShoppingCart,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import type { BusinessModules, CatalogItem, Currency, PaymentMethod, Terminology } from "@/lib/types";
import { PAYMENT_LABELS, formatMoney, formatOldLeones, formatQty } from "@/lib/format";
import { cacheCatalog, enqueueSale } from "@/lib/offline/queue";
import { uuid } from "@/lib/uuid";
import type { SalePayload } from "@/lib/validation";
import { buttonPrimary, buttonSecondary, inputClass, selectClass } from "@/components/ui/styles";
import { Modal } from "@/components/ui/modal";
import { CameraScanner, cameraScanSupported } from "./scanner";
import { Receipt, type ReceiptData } from "./receipt";
import { quickAddCustomer } from "@/app/(app)/customers/actions";

interface PosBusiness {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  usd_rate: number;
  payment_methods: PaymentMethod[];
  max_staff_discount_pct: number;
  modules: BusinessModules;
}
interface PosCustomer {
  id: string;
  name: string;
  phone: string | null;
  balance: number;
  credit_limit: number;
  store_credit: number;
}
interface Line {
  key: string;
  item: CatalogItem;
  qty: number;
  price: number;
  discount: number;
  serialIds: string[];
  performedBy: string | null;
}
interface PayRow {
  id: string;
  method: PaymentMethod;
  currency: Currency;
  amount: string;
  reference: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => {
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export function PosTerminal(props: {
  business: PosBusiness;
  terms: Terminology;
  isAdmin: boolean;
  cashierName: string;
  catalog: CatalogItem[];
  customers: PosCustomer[];
  staff: { id: string; name: string }[];
  locations: { id: string; name: string; is_default_sale: boolean }[];
}) {
  const { business, terms, isAdmin } = props;
  const [items, setItems] = useState<CatalogItem[]>(props.catalog);
  const [customers, setCustomers] = useState<PosCustomer[]>(props.customers);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<Line[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [orderType, setOrderType] = useState<"counter" | "table" | "takeaway" | "delivery">("counter");
  const [tableLabel, setTableLabel] = useState("");
  const [rxRef, setRxRef] = useState("");
  const [saleDiscount, setSaleDiscount] = useState("");
  const [locationId, setLocationId] = useState(props.locations.find((l) => l.is_default_sale)?.id ?? props.locations[0]?.id ?? "");
  const [checkout, setCheckout] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [payments, setPayments] = useState<PayRow[]>([]);
  const [cashGiven, setCashGiven] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [serialFor, setSerialFor] = useState<CatalogItem | null>(null);
  const [scanning, setScanning] = useState(false);
  const canScan = useSyncExternalStore(noopSubscribe, cameraScanSupported, () => false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Keep a copy of the catalogue on the device for offline selling, and refresh stock now and then.
  useEffect(() => {
    cacheCatalog(business.id, props.catalog);
    const timer = window.setInterval(async () => {
      if (!navigator.onLine) return;
      try {
        const res = await fetch("/api/pos/catalog", { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as { business_id: string; items: CatalogItem[] };
          if (body.business_id === business.id) {
            setItems(body.items);
            cacheCatalog(business.id, body.items);
          }
        }
      } catch {
        // offline; keep what we have
      }
    }, 120_000);
    return () => window.clearInterval(timer);
  }, [business.id, props.catalog]);

  const categories = useMemo(
    () => [...new Set(items.map((i) => i.category).filter((c): c is string => Boolean(c)))].sort(),
    [items],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => !category || i.category === category)
      .filter(
        (i) =>
          !q ||
          i.name.toLowerCase().includes(q) ||
          i.sku?.toLowerCase() === q ||
          i.barcode === q ||
          i.serials?.some((s) => s.serial.toLowerCase().includes(q)),
      )
      .slice(0, 120);
  }, [items, query, category]);

  // ---------------------------------------------------------------------------
  // Cart
  // ---------------------------------------------------------------------------

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((n) => (n === msg ? null : n)), 2500);
  };

  const add = useCallback(
    (item: CatalogItem, serialIds?: string[]) => {
      if (item.track_mode === "serial" && item.kind !== "service" && !serialIds) {
        setSerialFor(item);
        return;
      }
      if (item.kind !== "service" && item.stock <= 0 && navigator.onLine) {
        flash(`${item.name} shows no stock on the system. Receive it first, or ask an admin.`);
      }
      setCart((prev) => {
        if (serialIds) {
          const existing = prev.find((l) => l.item.id === item.id);
          const ids = [...new Set([...(existing?.serialIds ?? []), ...serialIds])];
          const line = existing
            ? { ...existing, serialIds: ids, qty: ids.length }
            : { key: uuid(), item, qty: ids.length, price: item.selling_price, discount: 0, serialIds: ids, performedBy: null };
          return existing ? prev.map((l) => (l.key === existing.key ? line : l)) : [...prev, line];
        }
        const existing = prev.find((l) => l.item.id === item.id);
        if (existing) return prev.map((l) => (l.key === existing.key ? { ...l, qty: l.qty + 1 } : l));
        return [...prev, { key: uuid(), item, qty: 1, price: item.selling_price, discount: 0, serialIds: [], performedBy: null }];
      });
    },
    [],
  );

  function update(key: string, patch: Partial<Line>) {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function remove(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }

  function onSearchEnter() {
    const q = query.trim();
    if (!q) return;
    const exact = items.find((i) => i.barcode === q || i.sku?.toLowerCase() === q.toLowerCase());
    const bySerial = items.find((i) => i.serials?.some((s) => s.serial === q));
    if (bySerial) {
      add(bySerial, [bySerial.serials!.find((s) => s.serial === q)!.id]);
      setQuery("");
    } else if (exact) {
      add(exact);
      setQuery("");
    } else if (visible.length === 1) {
      add(visible[0]);
      setQuery("");
    }
  }

  const onScan = useCallback(
    (code: string) => {
      setScanning(false);
      const item = items.find((i) => i.barcode === code || i.sku === code);
      const bySerial = items.find((i) => i.serials?.some((s) => s.serial === code));
      if (bySerial) add(bySerial, [bySerial.serials!.find((s) => s.serial === code)!.id]);
      else if (item) add(item);
      else flash(`No item has barcode ${code}.`);
    },
    [items, add],
  );

  // ---------------------------------------------------------------------------
  // Totals and payments
  // ---------------------------------------------------------------------------

  const subtotal = round2(cart.reduce((s, l) => s + round2(l.qty * l.price), 0));
  const lineDiscounts = round2(cart.reduce((s, l) => s + (l.discount || 0), 0));
  const saleDisc = round2(num(saleDiscount));
  const total = round2(subtotal - lineDiscounts - saleDisc);
  const discountTotal = lineDiscounts + saleDisc;
  const discountLimit = round2((subtotal * business.max_staff_discount_pct) / 100);
  const discountTooBig = !isAdmin && discountTotal > discountLimit + 0.001;
  const needsRx = cart.some((l) => l.item.requires_prescription);
  const customer = customers.find((c) => c.id === customerId) ?? null;
  const methods: PaymentMethod[] = [
    "cash",
    ...business.payment_methods.filter((m) => m !== "cash" && m !== "store_credit"),
    ...(customer && customer.store_credit > 0 ? (["store_credit"] as const) : []),
  ];

  const base = (p: PayRow) => (p.currency === "USD" ? round2(num(p.amount) * business.usd_rate) : round2(num(p.amount)));
  const paid = round2(payments.reduce((s, p) => s + base(p), 0));
  const remaining = round2(total - paid);
  const hasUsd = payments.some((p) => p.currency === "USD");
  const balanced = Math.abs(remaining) <= (hasUsd ? 1 : 0.009);
  const needsCustomer = payments.some((p) => p.method === "credit" && num(p.amount) > 0);
  const cashRow = payments.find((p) => p.method === "cash" && p.currency === "SLE");
  const change = cashRow && num(cashGiven) > 0 ? round2(num(cashGiven) - num(cashRow.amount)) : 0;
  const storeCreditUsed = round2(payments.filter((p) => p.method === "store_credit").reduce((s, p) => s + num(p.amount), 0));

  function openCheckout() {
    setError(null);
    if (!cart.length) return;
    setPayments([{ id: uuid(), method: "cash", currency: "SLE", amount: total.toFixed(2), reference: "" }]);
    setCashGiven("");
    setCheckout(true);
    setCartOpen(false);
  }

  function setPay(id: string, patch: Partial<PayRow>) {
    setPayments((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function pickMethod(m: PaymentMethod) {
    // Store credit can only cover what the customer holds; the rest stays on the other payment.
    const cap = m === "store_credit" ? Math.min(customer?.store_credit ?? 0, total) : Infinity;
    if (payments.length === 1 && num(payments[0].amount) === total) {
      if (cap >= total) return setPay(payments[0].id, { method: m, currency: "SLE" });
      return setPayments([
        { id: uuid(), method: m, currency: "SLE", amount: cap.toFixed(2), reference: "" },
        { ...payments[0], amount: round2(total - cap).toFixed(2) },
      ]);
    }
    const amount = Math.max(0, Math.min(remaining, cap));
    setPayments((rows) => [...rows, { id: uuid(), method: m, currency: "SLE", amount: amount.toFixed(2), reference: "" }]);
  }

  function fillRemaining(id: string) {
    setPayments((rows) => {
      const others = rows.filter((r) => r.id !== id).reduce((s, r) => s + base(r), 0);
      const left = Math.max(0, round2(total - others));
      return rows.map((r) =>
        r.id === id ? { ...r, amount: (r.currency === "USD" ? round2(left / business.usd_rate) : left).toFixed(2) } : r,
      );
    });
  }

  function resetSale() {
    setCart([]);
    setCustomerId("");
    setTableLabel("");
    setRxRef("");
    setSaleDiscount("");
    setPayments([]);
    setCashGiven("");
    setCheckout(false);
    setReceipt(null);
    setError(null);
    window.setTimeout(() => searchRef.current?.focus(), 50);
  }

  async function charge() {
    setError(null);
    if (discountTooBig) return setError(`Discounts above ${business.max_staff_discount_pct}% need an admin.`);
    if (needsRx && !rxRef.trim()) return setError("Enter the prescription reference.");
    if (needsCustomer && !customerId) return setError("Choose the customer buying on credit.");
    if (storeCreditUsed > 0 && !customer) return setError(`Choose the ${terms.customer.toLowerCase()} whose store credit is being used.`);
    if (customer && storeCreditUsed > customer.store_credit + 0.001) {
      return setError(`${customer.name} has only ${formatMoney(customer.store_credit)} of store credit.`);
    }
    if (!balanced) return setError(`Payments must add up to ${formatMoney(total)}.`);

    const payload: SalePayload = {
      business_id: business.id,
      client_ref: uuid(),
      location_id: locationId || undefined,
      customer_id: customerId || null,
      order_type: orderType,
      table_label: tableLabel.trim() || undefined,
      discount: saleDisc,
      prescription_ref: rxRef.trim() || undefined,
      captured_at: new Date().toISOString(),
      items: cart.map((l) => ({
        product_id: l.item.id,
        qty: l.qty,
        unit_price: l.price !== l.item.selling_price ? l.price : undefined,
        discount: l.discount || undefined,
        serial_ids: l.serialIds.length ? l.serialIds : undefined,
        performed_by: l.performedBy,
      })),
      payments: payments
        .filter((p) => num(p.amount) > 0)
        .map((p) => ({ method: p.method, amount: round2(num(p.amount)), currency: p.currency, reference: p.reference.trim() || undefined })),
    };

    setBusy(true);
    let receiptNo: number | null = null;
    let offline = false;
    try {
      if (!navigator.onLine) throw new TypeError("offline");
      const res = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { receipt_no?: number; error?: string };
      if (!res.ok) {
        if (res.status >= 500) throw new TypeError("server");
        setBusy(false);
        return setError(body.error ?? "The sale was not saved.");
      }
      receiptNo = body.receipt_no ?? null;
    } catch {
      // Store credit is checked against the live balance, so it cannot wait in the offline queue.
      if (storeCreditUsed > 0) {
        setBusy(false);
        return setError("Store credit can only be spent while online. Take another payment, or try again when the connection is back.");
      }
      enqueueSale(payload, total);
      offline = true;
    }
    setBusy(false);
    if (storeCreditUsed > 0 && customer) {
      setCustomers((list) => list.map((c) => (c.id === customer.id ? { ...c, store_credit: round2(c.store_credit - storeCreditUsed) } : c)));
    }

    // Reflect the sale in the local stock figures straight away.
    const soldSerials = new Set(cart.flatMap((l) => l.serialIds));
    setItems((prev) =>
      prev.map((i) => {
        const sold = cart.filter((l) => l.item.id === i.id).reduce((s, l) => s + l.qty, 0);
        if (!sold) return i;
        return { ...i, stock: i.stock - sold, serials: i.serials?.filter((s) => !soldSerials.has(s.id)) };
      }),
    );

    setReceipt({
      businessName: business.name,
      address: business.address,
      phone: business.phone,
      receiptNo,
      at: new Date().toISOString(),
      cashier: props.cashierName,
      customer: customer?.name ?? null,
      tableLabel: orderType === "table" ? tableLabel : undefined,
      lines: cart.map((l) => ({
        name: l.item.name,
        qty: l.qty,
        unit: l.item.unit,
        price: l.price,
        discount: l.discount,
        total: round2(l.qty * l.price - l.discount),
        serials: l.item.serials?.filter((s) => l.serialIds.includes(s.id)).map((s) => s.serial),
      })),
      subtotal,
      discount: discountTotal,
      total,
      payments: payload.payments.map((p) => ({
        method: p.method,
        currency: p.currency ?? "SLE",
        amount: p.amount,
        base: p.currency === "USD" ? round2(p.amount * business.usd_rate) : p.amount,
      })),
      change: Math.max(0, change),
      offline,
      saleLabel: terms.sale,
    });
  }

  async function addCustomer() {
    const name = window.prompt(`New ${terms.customer.toLowerCase()} name`);
    if (!name?.trim()) return;
    const phone = window.prompt("Phone (optional)") ?? "";
    const res = await quickAddCustomer(name.trim(), phone.trim());
    if (res?.ok && res.data) {
      const c = res.data as PosCustomer;
      setCustomers((list) => [...list, c].sort((a, b) => a.name.localeCompare(b.name)));
      setCustomerId(c.id);
    } else {
      setError(res?.error ?? "Could not add the customer.");
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const cartPanel = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <h2 className="font-semibold">
          Cart <span className="text-zinc-400">({cart.length})</span>
        </h2>
        {cart.length > 0 && (
          <button onClick={() => setCart([])} className="text-xs text-zinc-500 hover:text-red-600">
            Clear
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        {cart.length === 0 ? (
          <p className="py-10 text-center text-sm text-zinc-500">Tap an item or scan a barcode to start.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            <AnimatePresence initial={false}>
              {cart.map((l) => (
                <motion.li
                  key={l.key}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="py-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{l.item.name}</p>
                      <p className="text-xs text-zinc-500">
                        {formatMoney(l.price)} / {l.item.unit}
                        {l.price !== l.item.selling_price && <span className="ml-1 text-amber-600">(changed)</span>}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(l.qty * l.price - l.discount)}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {l.item.track_mode === "serial" && l.item.kind !== "service" ? (
                      <button onClick={() => setSerialFor(l.item)} className="rounded-md border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700">
                        {l.serialIds.length} × {business.modules.serialLabel ?? "serial"}
                      </button>
                    ) : (
                      <div className="flex items-center rounded-lg border border-zinc-200 dark:border-zinc-700">
                        <button
                          onClick={() => (l.qty <= 1 && !l.item.allow_fractional ? remove(l.key) : update(l.key, { qty: Math.max(0, round2(l.qty - 1)) || 1 }))}
                          className="p-1.5"
                          aria-label="Less"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <input
                          value={l.qty}
                          inputMode="decimal"
                          onChange={(e) => {
                            const v = num(e.target.value);
                            if (v > 0) update(l.key, { qty: l.item.allow_fractional ? v : Math.round(v) });
                          }}
                          className="w-12 bg-transparent text-center text-sm tabular-nums outline-none"
                          aria-label="Quantity"
                        />
                        <button onClick={() => update(l.key, { qty: l.qty + 1 })} className="p-1.5" aria-label="More">
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    {l.item.wholesale_price !== null && (
                      <button
                        onClick={() =>
                          update(l.key, { price: l.price === l.item.wholesale_price ? l.item.selling_price : l.item.wholesale_price! })
                        }
                        className={clsx(
                          "rounded-md border px-2 py-1 text-xs",
                          l.price === l.item.wholesale_price ? "border-brand-600 text-brand-700" : "border-zinc-200 dark:border-zinc-700",
                        )}
                      >
                        Wholesale
                      </button>
                    )}
                    {isAdmin && (
                      <input
                        defaultValue={l.price}
                        onBlur={(e) => update(l.key, { price: Math.max(0, num(e.target.value)) })}
                        inputMode="decimal"
                        className="w-20 rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-xs dark:border-zinc-700"
                        aria-label="Price"
                        title="Price (admin)"
                      />
                    )}
                    <input
                      placeholder="Disc."
                      defaultValue={l.discount || ""}
                      onBlur={(e) => update(l.key, { discount: Math.min(Math.max(0, num(e.target.value)), l.qty * l.price) })}
                      inputMode="decimal"
                      className="w-16 rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-xs dark:border-zinc-700"
                      aria-label="Discount"
                    />
                    {business.modules.commissions && (
                      <select
                        value={l.performedBy ?? ""}
                        onChange={(e) => update(l.key, { performedBy: e.target.value || null })}
                        className="rounded-md border border-zinc-200 bg-transparent px-1.5 py-1 text-xs dark:border-zinc-700"
                        aria-label="Done by"
                      >
                        <option value="">Done by…</option>
                        {props.staff.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <button onClick={() => remove(l.key)} className="ml-auto p-1 text-zinc-400 hover:text-red-600" aria-label="Remove">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
      <div className="border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <div className="flex flex-col gap-2 text-sm">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={clsx(selectClass, "!py-2")} aria-label={terms.customer}>
              <option value="">Walk-in {terms.customer.toLowerCase()}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.balance > 0 ? ` (owes ${formatMoney(c.balance)})` : ""}
                  {c.store_credit > 0 ? ` (credit ${formatMoney(c.store_credit)})` : ""}
                </option>
              ))}
            </select>
            <button onClick={addCustomer} className={clsx(buttonSecondary, "!py-2")}>
              <UserPlus className="h-4 w-4" /> New
            </button>
          </div>
          {business.modules.tables && (
            <div className="grid grid-cols-2 gap-2">
              <select value={orderType} onChange={(e) => setOrderType(e.target.value as typeof orderType)} className={clsx(selectClass, "!py-2")}>
                <option value="counter">Counter</option>
                <option value="table">Table</option>
                <option value="takeaway">Takeaway</option>
                <option value="delivery">Delivery</option>
              </select>
              {orderType === "table" && (
                <input value={tableLabel} onChange={(e) => setTableLabel(e.target.value)} placeholder="Table no." className={clsx(inputClass, "!py-2")} />
              )}
            </div>
          )}
          {needsRx && (
            <input value={rxRef} onChange={(e) => setRxRef(e.target.value)} placeholder="Prescription reference (required)" className={clsx(inputClass, "!py-2")} />
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-zinc-500">Discount on sale</span>
            <input value={saleDiscount} onChange={(e) => setSaleDiscount(e.target.value)} inputMode="decimal" placeholder="0" className="w-28 rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-right text-sm tabular-nums dark:border-zinc-700" />
          </div>
          {discountTotal > 0 && (
            <div className="flex justify-between text-zinc-500">
              <span>Subtotal · discounts</span>
              <span className="tabular-nums">
                {formatMoney(subtotal)} · −{formatMoney(discountTotal)}
              </span>
            </div>
          )}
          {discountTooBig && (
            <p className="text-xs text-red-700">Staff discounts are limited to {business.max_staff_discount_pct}% ({formatMoney(discountLimit)}).</p>
          )}
          <div className="flex items-end justify-between">
            <span className="text-zinc-500">Total</span>
            <span className="text-right">
              <span className="block text-2xl font-semibold tabular-nums">{formatMoney(total)}</span>
              {total > 0 && <span className="block text-xs text-zinc-400">{formatOldLeones(total)}</span>}
            </span>
          </div>
          <button onClick={openCheckout} disabled={!cart.length || total < 0} className={clsx(buttonPrimary, "w-full !py-3 text-base")}>
            Charge {formatMoney(total)}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="-mt-1 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-5">
      <section className="min-w-0">
        <div className="sticky top-[57px] z-10 -mx-4 bg-background/95 px-4 pb-3 pt-1 backdrop-blur sm:-mx-6 sm:px-6 lg:top-0">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onSearchEnter())}
                placeholder={`Search ${terms.items.toLowerCase()}, scan barcode${business.modules.serials ? " or " + (business.modules.serialLabel ?? "serial") : ""}…`}
                className={clsx(inputClass, "pl-9")}
                autoFocus
                autoComplete="off"
                enterKeyHint="search"
              />
              {query && (
                <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400" aria-label="Clear search">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {canScan && (
              <button onClick={() => setScanning(true)} className={buttonSecondary} aria-label="Scan with camera">
                <Camera className="h-4 w-4" />
              </button>
            )}
            {props.locations.length > 1 && (
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={clsx(selectClass, "hidden w-40 sm:block")} aria-label="Selling from">
                {props.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {categories.length > 0 && (
            <div className="-mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
              <CatChip on={!category} onClick={() => setCategory(null)}>
                All
              </CatChip>
              {categories.map((c) => (
                <CatChip key={c} on={category === c} onClick={() => setCategory(category === c ? null : c)}>
                  {c}
                </CatChip>
              ))}
            </div>
          )}
          <AnimatePresence>
            {notice && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-2 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
              >
                <AlertOctagon className="h-4 w-4 shrink-0" /> {notice}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {items.length === 0 ? (
          <div className="py-16 text-center text-sm text-zinc-500">
            <ScanBarcode className="mx-auto mb-2 h-8 w-8 text-zinc-300" />
            No {terms.items.toLowerCase()} yet. {isAdmin ? "Add them under Stock." : "Ask an admin to add them."}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 pb-28 sm:grid-cols-3 lg:pb-4 xl:grid-cols-4">
            {visible.map((i) => {
              const inCart = cart.find((l) => l.item.id === i.id);
              const out = i.kind !== "service" && i.stock <= 0;
              return (
                <motion.button
                  key={i.id}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => add(i)}
                  className={clsx(
                    "relative flex min-h-24 flex-col justify-between rounded-xl border p-3 text-left transition-colors",
                    inCart
                      ? "border-brand-600 bg-brand-50 dark:border-brand-500 dark:bg-brand-800/20"
                      : "border-zinc-200 bg-surface hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700",
                    out && "opacity-60",
                  )}
                >
                  <span className="line-clamp-2 text-sm font-medium leading-snug">{i.name}</span>
                  <span className="mt-2 flex items-end justify-between gap-1">
                    <span className="text-sm font-semibold tabular-nums">{formatMoney(i.selling_price)}</span>
                    <span className={clsx("text-[11px] tabular-nums", out ? "font-medium text-red-600" : "text-zinc-500")}>
                      {i.kind === "service" ? "service" : out ? "out" : formatQty(i.stock, i.unit)}
                    </span>
                  </span>
                  {inCart && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white">
                      {formatQty(inCart.qty)}
                    </span>
                  )}
                </motion.button>
              );
            })}
          </div>
        )}
      </section>

      {/* Desktop cart */}
      <aside className="sticky top-4 hidden h-[calc(100dvh-5rem)] overflow-hidden rounded-2xl border border-zinc-200 bg-surface lg:block dark:border-zinc-800">
        {cartPanel}
      </aside>

      {/* Phone: cart bar + sheet */}
      {cart.length > 0 && !cartOpen && !checkout && !receipt && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+4.25rem)] z-20 flex items-center justify-between rounded-2xl bg-brand-600 px-4 py-3.5 text-white shadow-lg lg:hidden"
        >
          <span className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" /> {cart.length} item(s)
          </span>
          <span className="flex items-center gap-1 font-semibold tabular-nums">
            {formatMoney(total)} <ChevronUp className="h-4 w-4" />
          </span>
        </button>
      )}
      <AnimatePresence>
        {cartOpen && (
          <Sheet onClose={() => setCartOpen(false)}>
            {cartPanel}
          </Sheet>
        )}
      </AnimatePresence>

      {/* Checkout */}
      <AnimatePresence>
        {checkout && !receipt && (
          <Modal title={`Payment · ${formatMoney(total)}`} onClose={() => !busy && setCheckout(false)}>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-1.5">
                {methods.map((m) => (
                  <button
                    key={m}
                    onClick={() => pickMethod(m)}
                    className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm hover:border-brand-600 dark:border-zinc-700"
                  >
                    {m === "credit" ? "Credit" : PAYMENT_LABELS[m]}
                  </button>
                ))}
              </div>
              <ul className="flex flex-col gap-2">
                {payments.map((p) => (
                  <li key={p.id} className="rounded-xl border border-zinc-200 p-2.5 dark:border-zinc-800">
                    <div className="flex items-center gap-2">
                      <select value={p.method} onChange={(e) => setPay(p.id, { method: e.target.value as PaymentMethod, currency: "SLE" })} className={clsx(selectClass, "!w-auto min-w-0 flex-1 !py-2")}>
                        {methods.map((m) => (
                          <option key={m} value={m}>
                            {PAYMENT_LABELS[m]}
                          </option>
                        ))}
                      </select>
                      {(p.method === "cash" || p.method === "bank") && (
                        <select value={p.currency} onChange={(e) => setPay(p.id, { currency: e.target.value as Currency })} className={clsx(selectClass, "!w-16 shrink-0 !py-2")} aria-label="Currency">
                          <option value="SLE">Le</option>
                          <option value="USD">$</option>
                        </select>
                      )}
                      <input
                        value={p.amount}
                        onChange={(e) => setPay(p.id, { amount: e.target.value })}
                        inputMode="decimal"
                        className={clsx(inputClass, "!w-24 shrink-0 !py-2 text-right tabular-nums")}
                        aria-label="Amount"
                      />
                      {payments.length > 1 && (
                        <button onClick={() => setPayments((rows) => rows.filter((r) => r.id !== p.id))} className="p-1.5 text-zinc-400 hover:text-red-600" aria-label="Remove payment">
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      {p.method !== "cash" && p.method !== "credit" && p.method !== "store_credit" && (
                        <input value={p.reference} onChange={(e) => setPay(p.id, { reference: e.target.value })} placeholder="Transaction ID (optional)" className="flex-1 rounded-md border border-zinc-200 bg-transparent px-2 py-1 dark:border-zinc-700" />
                      )}
                      {p.currency === "USD" && <span className="text-zinc-500">= {formatMoney(base(p))} at {business.usd_rate}</span>}
                      <button onClick={() => fillRemaining(p.id)} className="ml-auto text-brand-700 hover:underline dark:text-brand-500">
                        Fill remaining
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className={clsx("flex justify-between rounded-lg px-3 py-2 text-sm", balanced ? "bg-green-50 text-green-900 dark:bg-green-950/40 dark:text-green-200" : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200")}>
                <span className="flex items-center gap-1.5">
                  {balanced ? <Check className="h-4 w-4" /> : <AlertOctagon className="h-4 w-4" />}
                  {balanced ? "Paid in full" : remaining > 0 ? "Still to pay" : "Over-paid by"}
                </span>
                <span className="tabular-nums font-medium">{formatMoney(Math.abs(remaining))}</span>
              </div>
              {cashRow && (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <label htmlFor="cash-given" className="text-zinc-600 dark:text-zinc-400">
                    Cash handed over
                  </label>
                  <input id="cash-given" value={cashGiven} onChange={(e) => setCashGiven(e.target.value)} inputMode="decimal" placeholder={cashRow.amount} className={clsx(inputClass, "!w-32 !py-2 text-right")} />
                </div>
              )}
              {change > 0 && (
                <p className="text-right text-lg font-semibold tabular-nums">
                  Change: {formatMoney(change)}
                </p>
              )}
              {needsCustomer && !customerId && <p className="text-sm text-red-700">Choose the {terms.customer.toLowerCase()} in the cart for a credit sale.</p>}
              {storeCreditUsed > 0 && customer && (
                <p className="text-xs text-zinc-500">
                  {customer.name} has {formatMoney(customer.store_credit)} of store credit from returns.
                </p>
              )}
              {needsCustomer && customer && customer.credit_limit > 0 && (
                <p className="text-xs text-zinc-500">
                  {customer.name} owes {formatMoney(customer.balance)} of a {formatMoney(customer.credit_limit)} limit.
                </p>
              )}
              {error && (
                <p role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
                  <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0" />
                  {error}
                </p>
              )}
              <button onClick={charge} disabled={busy || !balanced} className={clsx(buttonPrimary, "w-full !py-3 text-base")}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Complete {terms.sale.toLowerCase()}
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {receipt && (
          <Modal title={receipt.offline ? "Saved offline" : `${terms.sale} recorded`} onClose={resetSale}>
            <Receipt data={receipt} onNewSale={resetSale} />
          </Modal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {serialFor && (
          <SerialPicker
            item={items.find((i) => i.id === serialFor.id) ?? serialFor}
            label={business.modules.serialLabel ?? "Serial number"}
            selected={cart.find((l) => l.item.id === serialFor.id)?.serialIds ?? []}
            onClose={() => setSerialFor(null)}
            onDone={(ids) => {
              const item = items.find((i) => i.id === serialFor.id) ?? serialFor;
              setCart((prev) => prev.filter((l) => l.item.id !== item.id));
              if (ids.length) add(item, ids);
              setSerialFor(null);
            }}
          />
        )}
      </AnimatePresence>

      {scanning && <CameraScanner onDetect={onScan} onClose={() => setScanning(false)} />}
    </div>
  );
}

const noopSubscribe = () => () => {};

function CatChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-sm",
        on ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
      )}
    >
      {children}
    </button>
  );
}

function Sheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <motion.div className="fixed inset-0 z-40 bg-black/40 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        className="fixed inset-x-0 bottom-0 z-50 h-[85dvh] overflow-hidden rounded-t-2xl bg-surface pb-[env(safe-area-inset-bottom)] shadow-xl lg:hidden"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
        {children}
      </motion.div>
    </>
  );
}

function SerialPicker({
  item,
  label,
  selected,
  onClose,
  onDone,
}: {
  item: CatalogItem;
  label: string;
  selected: string[];
  onClose: () => void;
  onDone: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>(selected);
  const [q, setQ] = useState("");
  const list = (item.serials ?? []).filter((s) => !q || s.serial.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title={`${item.name}: choose ${label}`} onClose={onClose}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Type or scan ${label}`} className={clsx(inputClass, "mb-3")} autoFocus />
      {list.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">No {label} in stock{q ? " matching that" : ""}.</p>
      ) : (
        <ul className="max-h-72 overflow-y-auto">
          {list.map((s) => (
            <li key={s.id}>
              <label className="flex items-center gap-3 border-b border-zinc-100 py-2.5 font-mono text-sm dark:border-zinc-800">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand-600"
                  checked={picked.includes(s.id)}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))}
                />
                {s.serial}
              </label>
            </li>
          ))}
        </ul>
      )}
      <button onClick={() => onDone(picked)} className={clsx(buttonPrimary, "mt-4 w-full")}>
        Use {picked.length} selected
      </button>
    </Modal>
  );
}
