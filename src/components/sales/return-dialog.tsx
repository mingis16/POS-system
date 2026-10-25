"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import {
  AlertOctagon,
  ArrowLeft,
  ArrowLeftRight,
  Banknote,
  CheckCircle2,
  KeyRound,
  Loader2,
  Minus,
  PackageCheck,
  PackageX,
  Plus,
  Search,
  Smartphone,
  Ticket,
  Trash2,
  Undo2,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { buttonPrimary, buttonSecondary, buttonSmall, inputClass, labelClass, selectClass } from "@/components/ui/styles";
import { PAYMENT_LABELS, formatDate, formatMoney, formatQty } from "@/lib/format";
import { uuid } from "@/lib/uuid";
import { processReturn } from "@/app/(app)/sales/actions";
import type {
  CatalogItem,
  MobileMoneyProvider,
  PaymentMethod,
  ReturnReason,
  ReturnResult,
  SaleReturnType,
  Terminology,
} from "@/lib/types";
import type { ReturnPayload } from "@/lib/validation";

interface InfoItem {
  sale_item_id: string;
  product_id: string;
  name: string;
  kind: string;
  unit: string;
  allow_fractional: boolean;
  qty: number;
  line_total: number;
  returned_qty: number;
  serials: { id: string; serial: string }[] | null;
}

/** sale_return_info() */
interface ReturnInfo {
  sale: { id: string; receipt_no: number; total: number; status: string; created_at: string; net_lines: number };
  customer: { id: string; name: string; balance: number; store_credit: number } | null;
  returned_value: number;
  credit_open: number;
  payments: { method: PaymentMethod; amount: number }[];
  items: InfoItem[];
  returns: { return_no: number; created_at: string; total: number; return_type: SaleReturnType }[];
  managers: { user_id: string; name: string; role: string; has_pin: boolean }[];
  methods: PaymentMethod[];
}

interface LineState {
  qty: number;
  restock: boolean;
  serialIds: string[];
}

interface SwapLine {
  key: string;
  item: CatalogItem;
  qty: number;
  serialIds: string[];
}

type Action = "cash" | "mobile_money" | "store_credit" | "exchange";
type Payout = Exclude<Action, "exchange">;

const REASONS: { code: ReturnReason; label: string }[] = [
  { code: "changed_mind", label: "Customer changed mind" },
  { code: "defective", label: "Defective / damaged" },
  { code: "wrong_item", label: "Wrong item or size" },
  { code: "expired", label: "Expired or near expiry" },
  { code: "other", label: "Other" },
];
/** Reasons whose goods should not go back on the shelf as new. */
const UNSELLABLE: ReturnReason[] = ["defective", "expired"];
const MOMO: MobileMoneyProvider[] = ["orange_money", "afrimoney", "qmoney"];

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const num = (s: string) => {
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

interface ReturnButtonProps {
  saleId: string;
  receiptNo: number;
  terms: Terminology;
  /** The signed-in user, so a manager approving their own return is picked first. */
  userId: string;
  /** Exchanges record a new sale, so they need the right to sell. */
  canExchange: boolean;
  serialLabel?: string;
  compact?: boolean;
}

/** "Return / Exchange" button that opens the return dialog for one sale. */
export function ReturnButton(props: ReturnButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={props.compact ? `${buttonSecondary} ${buttonSmall}` : `${buttonSecondary} w-full`}
      >
        <Undo2 aria-hidden className={props.compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        Return / Exchange
      </button>
      <AnimatePresence>{open && <ReturnDialog {...props} onClose={() => setOpen(false)} />}</AnimatePresence>
    </>
  );
}

function ReturnDialog({
  saleId,
  receiptNo,
  terms,
  userId,
  canExchange,
  serialLabel = "Serial number",
  onClose,
}: ReturnButtonProps & { onClose: () => void }) {
  const router = useRouter();
  const [info, setInfo] = useState<ReturnInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<"details" | "pin" | "done">("details");
  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [reason, setReason] = useState<ReturnReason>("changed_mind");
  const [note, setNote] = useState("");
  const [action, setAction] = useState<Action>("cash");
  const [leftover, setLeftover] = useState<Payout>("cash");
  const [provider, setProvider] = useState<MobileMoneyProvider | "">("");
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [swap, setSwap] = useState<SwapLine[]>([]);
  const [topUpMethod, setTopUpMethod] = useState<PaymentMethod>("cash");
  const [topUpRef, setTopUpRef] = useState("");
  const [rxRef, setRxRef] = useState("");
  const [managerId, setManagerId] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReturnResult | null>(null);
  // One per dialog: if the connection drops after the server saved the return, re-sending stores it once.
  const [clientRef] = useState(uuid);

  useEffect(() => {
    let alive = true;
    fetch(`/api/sales/${saleId}/return-info`, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as ReturnInfo & { error?: string };
        if (!alive) return;
        if (!res.ok) return setLoadError(body.error ?? "Could not load this sale.");
        setInfo(body);
        const withPin = body.managers.filter((m) => m.has_pin);
        setManagerId((withPin.find((m) => m.user_id === userId) ?? withPin[0])?.user_id ?? "");
        const paidBy = body.payments.find((p) => MOMO.includes(p.method as MobileMoneyProvider))?.method as MobileMoneyProvider | undefined;
        setProvider(paidBy ?? MOMO.find((m) => body.methods.includes(m)) ?? "");
      })
      .catch(() => alive && setLoadError("No connection. Returns need the internet so stock and money stay right."));
    return () => {
      alive = false;
    };
  }, [saleId, userId]);

  // ---------------------------------------------------------------------------
  // Figures (the same rules as process_return in the database)
  // ---------------------------------------------------------------------------

  const items = useMemo(() => info?.items ?? [], [info]);
  const customer = info?.customer ?? null;
  const remaining = (i: InfoItem) => round3(i.qty - i.returned_qty);
  const lineOf = (i: InfoItem): LineState => lines[i.sale_item_id] ?? { qty: 0, restock: !UNSELLABLE.includes(reason), serialIds: [] };
  // A line's share of what the customer actually paid, after line and sale discounts.
  const valueOf = (i: InfoItem, qty: number) =>
    info && info.sale.net_lines > 0 ? round2((qty * i.line_total * info.sale.total) / (info.sale.net_lines * i.qty)) : 0;

  const chosen = items.filter((i) => lineOf(i).qty > 0);
  const openValue = info ? Math.max(0, round2(info.sale.total - info.returned_value)) : 0;
  const allBack = items.length > 0 && items.every((i) => i.returned_qty + lineOf(i).qty >= i.qty - 1e-9);
  const lineSum = round2(chosen.reduce((s, i) => s + valueOf(i, lineOf(i).qty), 0));
  const value = allBack ? openValue : Math.min(lineSum, openValue);

  const isExchange = action === "exchange";
  const swapTotal = round2(swap.reduce((s, l) => s + round2(l.qty * l.item.selling_price), 0));
  const usedOnSwap = isExchange ? Math.min(value, swapTotal) : 0;
  const topUp = isExchange ? round2(swapTotal - usedOnSwap) : 0;
  const left = round2(value - usedOnSwap);
  const toBalance = customer && info ? round2(Math.max(0, Math.min(left, info.credit_open, customer.balance))) : 0;
  const payout = round2(left - toBalance);
  const payoutMethod: Payout = isExchange ? leftover : action;
  const returnType: SaleReturnType = isExchange ? "exchange" : UNSELLABLE.includes(reason) ? "damaged" : "refund";
  const writeOffAll = returnType === "damaged";
  const restocks = (i: InfoItem) => !writeOffAll && i.kind !== "service" && lineOf(i).restock;
  const qtyBack = chosen.filter((i) => i.kind !== "service" && restocks(i)).reduce((s, i) => s + lineOf(i).qty, 0);
  const qtyWrittenOff = chosen.filter((i) => i.kind !== "service" && !restocks(i)).reduce((s, i) => s + lineOf(i).qty, 0);

  const momoOptions = MOMO.filter((m) => info?.methods.includes(m));
  const topUpMethods: PaymentMethod[] = [
    "cash",
    ...(info?.methods ?? []).filter((m) => m !== "cash" && m !== "store_credit" && (m !== "credit" || customer)),
  ];
  const managersWithPin = info?.managers.filter((m) => m.has_pin) ?? [];

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!catalog || !q) return [];
    return catalog
      .filter((i) => i.name.toLowerCase().includes(q) || i.sku?.toLowerCase() === q || i.barcode === q)
      .slice(0, 6);
  }, [catalog, query]);

  // ---------------------------------------------------------------------------
  // Changes
  // ---------------------------------------------------------------------------

  function setLine(i: InfoItem, patch: Partial<LineState>) {
    setLines((prev) => ({
      ...prev,
      [i.sale_item_id]: { ...(prev[i.sale_item_id] ?? { qty: 0, restock: !UNSELLABLE.includes(reason), serialIds: [] }), ...patch },
    }));
  }

  function toggleItem(i: InfoItem, on: boolean) {
    if (i.serials) return setLine(i, { serialIds: on ? i.serials.map((s) => s.id) : [], qty: on ? i.serials.length : 0 });
    setLine(i, { qty: on ? Math.min(1, remaining(i)) : 0 });
  }

  function toggleSerial(i: InfoItem, id: string, on: boolean) {
    const ids = on ? [...new Set([...lineOf(i).serialIds, id])] : lineOf(i).serialIds.filter((x) => x !== id);
    setLine(i, { serialIds: ids, qty: ids.length });
  }

  function changeReason(r: ReturnReason) {
    setReason(r);
    // Faulty or expired goods default to the write-off pile; sellable ones back to the shelf.
    const sellable = !UNSELLABLE.includes(r);
    setLines((prev) => Object.fromEntries(Object.entries(prev).map(([k, l]) => [k, { ...l, restock: sellable }])));
  }

  async function chooseAction(a: Action) {
    setAction(a);
    setError(null);
    if (a !== "exchange" || catalog) return;
    try {
      const res = await fetch("/api/pos/catalog", { cache: "no-store" });
      const body = (await res.json()) as { items?: CatalogItem[]; error?: string };
      if (!res.ok || !body.items) throw new Error(body.error);
      setCatalog(body.items);
    } catch {
      setCatalogError(`Could not load the ${terms.items.toLowerCase()}. Check the connection and choose Exchange again.`);
    }
  }

  function addSwap(item: CatalogItem) {
    setQuery("");
    const serial = item.track_mode === "serial" && item.kind !== "service";
    setSwap((prev) => {
      const existing = prev.find((l) => l.item.id === item.id);
      if (existing) return serial ? prev : prev.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { key: uuid(), item, qty: serial ? 0 : 1, serialIds: [] }];
    });
  }

  function setSwapLine(key: string, patch: Partial<SwapLine>) {
    setSwap((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function validate(): string | null {
    if (!chosen.length) return `Tick the ${terms.items.toLowerCase()} coming back.`;
    for (const i of chosen) {
      const q = lineOf(i).qty;
      if (q > remaining(i) + 1e-9) return `Only ${formatQty(remaining(i))} of ${i.name} can come back.`;
      if (!i.allow_fractional && !Number.isInteger(q)) return `${i.name} is counted in whole ${i.unit}.`;
    }
    if (reason === "other" && note.trim().length < 3) return "Say why the goods are coming back.";
    if (isExchange) {
      if (!swap.length || swap.every((l) => l.qty <= 0)) return "Add what the customer is taking instead.";
      const noSerial = swap.find((l) => l.item.track_mode === "serial" && l.item.kind !== "service" && l.serialIds.length === 0);
      if (noSerial) return `Choose the ${serialLabel} for ${noSerial.item.name}.`;
      if (swap.some((l) => l.item.requires_prescription) && !rxRef.trim()) return "Enter the prescription reference for the new items.";
    }
    if (payout > 0 && payoutMethod === "mobile_money" && !provider) return "Choose the mobile money service for the refund.";
    if (payout > 0 && payoutMethod === "store_credit" && !customer) return "Store credit needs a named customer.";
    return null;
  }

  function next() {
    const problem = validate();
    setError(problem);
    if (!problem) setStep("pin");
  }

  async function submit() {
    if (busy) return;
    if (!/^\d{4}$/.test(pin)) return setError("Enter the 4-digit PIN.");
    const label = REASONS.find((r) => r.code === reason)?.label ?? "Other";
    const payload: ReturnPayload = {
      client_ref: clientRef,
      sale_id: saleId,
      return_type: returnType,
      reason_code: reason,
      reason: `${label}${note.trim() ? `: ${note.trim()}` : ""}`.slice(0, 300),
      refund_method: left > 0 ? payoutMethod : null,
      momo_provider: left > 0 && payoutMethod === "mobile_money" && provider ? provider : null,
      items: chosen.map((i) => ({
        sale_item_id: i.sale_item_id,
        qty: lineOf(i).qty,
        restock: restocks(i),
        serial_ids: i.serials ? lineOf(i).serialIds : undefined,
      })),
      exchange: isExchange
        ? {
            items: swap
              .filter((l) => l.qty > 0)
              .map((l) => ({ product_id: l.item.id, qty: l.qty, serial_ids: l.serialIds.length ? l.serialIds : undefined })),
            payments: topUp > 0 ? [{ method: topUpMethod, amount: topUp, reference: topUpRef.trim() || undefined }] : [],
            prescription_ref: rxRef.trim() || undefined,
          }
        : undefined,
      manager_id: managerId,
      pin,
    };
    setBusy(true);
    setError(null);
    try {
      const res = await processReturn(payload);
      if (res?.ok && res.data) {
        setResult(res.data);
        setStep("done");
      } else {
        setPin("");
        setError(res?.error ?? "The return was not saved.");
      }
    } catch {
      setError("No connection. Nothing was saved; try again when you are back online.");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (busy) return;
    if (step === "done") router.refresh();
    onClose();
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const title = step === "done" ? "Return recorded" : `Return / exchange · ${terms.sale} #${receiptNo}`;

  if (!info) {
    return (
      <Modal title={title} onClose={close} wide>
        {loadError ? (
          <ErrorNote>{loadError}</ErrorNote>
        ) : (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the {terms.sale.toLowerCase()}…
          </p>
        )}
      </Modal>
    );
  }

  if (step === "done" && result) {
    const paidText = payoutText(result);
    return (
      <Modal title={title} onClose={close} wide>
        <div className="flex flex-col items-center gap-2 py-2 text-center">
          <CheckCircle2 className="h-10 w-10 text-good" />
          <p className="text-lg font-semibold">Return #{result.return_no}</p>
          <p className="text-sm text-zinc-500">
            {formatMoney(result.total)} of goods back from {terms.sale.toLowerCase()} #{receiptNo}
          </p>
        </div>
        <ul className="mt-4 flex flex-col gap-2 text-sm">
          {paidText && <ResultLine strong>{paidText}</ResultLine>}
          {Number(result.applied_to_balance) > 0 && (
            <ResultLine>
              {formatMoney(result.applied_to_balance)} taken off what {result.customer ?? `the ${terms.customer.toLowerCase()}`} owes.
            </ResultLine>
          )}
          {result.exchange_sale_id && (
            <ResultLine>
              Exchange recorded as {terms.sale.toLowerCase()} #{result.exchange_receipt_no} ({formatMoney(result.exchange_total)}).
              {topUp > 0 && ` The ${terms.customer.toLowerCase()} pays ${formatMoney(topUp)} more.`}
            </ResultLine>
          )}
          {Number(result.qty_restocked) > 0 && <ResultLine>{formatQty(result.qty_restocked)} back on the shelf.</ResultLine>}
          {Number(result.qty_written_off) > 0 && <ResultLine>{formatQty(result.qty_written_off)} written off as damaged (not back in stock).</ResultLine>}
          {result.duplicate && <ResultLine>This return had already been saved; nothing was recorded twice.</ResultLine>}
        </ul>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          <button type="button" onClick={close} className={clsx(buttonPrimary, "sm:flex-1")}>
            Done
          </button>
          {result.exchange_sale_id && (
            <Link href={`/sales/${result.exchange_sale_id}`} onClick={close} className={clsx(buttonSecondary, "sm:flex-1")}>
              View exchange receipt
            </Link>
          )}
        </div>
      </Modal>
    );
  }

  const summary = (
    <dl className="flex flex-col gap-1 rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
      <SummaryRow label="Value of goods coming back" value={formatMoney(value)} strong />
      {isExchange && <SummaryRow label="New items" value={formatMoney(swapTotal)} />}
      {topUp > 0 && <SummaryRow label={`${terms.customer} pays (${PAYMENT_LABELS[topUpMethod]})`} value={formatMoney(topUp)} strong />}
      {toBalance > 0 && <SummaryRow label={`Off what ${customer?.name} owes`} value={formatMoney(toBalance)} />}
      {payout > 0 && <SummaryRow label={payoutLabel(payoutMethod, provider)} value={formatMoney(payout)} strong />}
      {(qtyBack > 0 || qtyWrittenOff > 0) && (
        <p className="mt-1 text-xs text-zinc-500">
          {qtyBack > 0 && `${formatQty(qtyBack)} back on the shelf`}
          {qtyBack > 0 && qtyWrittenOff > 0 && " · "}
          {qtyWrittenOff > 0 && `${formatQty(qtyWrittenOff)} written off`}
        </p>
      )}
    </dl>
  );

  if (step === "pin") {
    return (
      <Modal title="Manager approval" onClose={close} wide>
        <div className="flex flex-col gap-4">
          {summary}
          {managersWithPin.length === 0 ? (
            <ErrorNote>
              No owner or admin has set a manager PIN yet. They can set one in Settings → Manager PIN, then try again.
            </ErrorNote>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="ret-manager" className={labelClass}>
                  Approving manager
                </label>
                <select id="ret-manager" value={managerId} onChange={(e) => setManagerId(e.target.value)} className={selectClass}>
                  {info.managers.map((m) => (
                    <option key={m.user_id} value={m.user_id} disabled={!m.has_pin}>
                      {m.name}
                      {m.user_id === userId ? " (you)" : ""}
                      {m.has_pin ? "" : " (no PIN set)"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="ret-pin" className={clsx(labelClass, "flex items-center gap-1.5")}>
                  <KeyRound aria-hidden className="h-4 w-4" /> Manager PIN
                </label>
                <input
                  id="ret-pin"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), submit())}
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  autoFocus
                  maxLength={4}
                  placeholder="••••"
                  className={clsx(inputClass, "text-center text-2xl font-semibold tracking-[0.6em]")}
                />
                <p className="text-xs text-zinc-500">The manager types their own PIN. It is checked on the server and never kept on this device.</p>
              </div>
            </>
          )}
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setStep("details");
                setError(null);
                setPin("");
              }}
              disabled={busy}
              className={buttonSecondary}
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || pin.length !== 4 || !managerId}
              className={clsx(buttonPrimary, "flex-1")}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm return
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  const returnable = items.filter((i) => remaining(i) > 0);
  return (
    <Modal title={title} onClose={close} wide>
      <p className="-mt-1 mb-3 text-sm text-zinc-500">
        {formatDate(info.sale.created_at)} · {formatMoney(info.sale.total)}
        {customer ? ` · ${customer.name}` : ` · walk-in ${terms.customer.toLowerCase()}`}
        {info.returned_value > 0 && ` · ${formatMoney(info.returned_value)} already returned`}
      </p>

      {info.sale.status !== "completed" ? (
        <ErrorNote>Only completed {terms.sales.toLowerCase()} can take returns.</ErrorNote>
      ) : returnable.length === 0 ? (
        <ErrorNote>Everything on this receipt has already come back.</ErrorNote>
      ) : (
        <div className="flex flex-col gap-5">
          {/* 1. Items */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">What is coming back?</h3>
            <ul className="flex flex-col gap-2">
              {items.map((i) => {
                const l = lineOf(i);
                const avail = remaining(i);
                const on = l.qty > 0;
                const service = i.kind === "service";
                return (
                  <li
                    key={i.sale_item_id}
                    className={clsx(
                      "rounded-xl border p-3 transition-colors",
                      avail <= 0
                        ? "border-zinc-100 opacity-50 dark:border-zinc-800"
                        : on
                          ? "border-brand-600 bg-brand-50/60 dark:border-brand-500 dark:bg-brand-800/15"
                          : "border-zinc-200 dark:border-zinc-800",
                    )}
                  >
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                        checked={on}
                        disabled={avail <= 0}
                        onChange={(e) => toggleItem(i, e.target.checked)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{i.name}</span>
                        <span className="block text-xs text-zinc-500">
                          Sold {formatQty(i.qty, i.unit)}
                          {i.returned_qty > 0 && ` · ${formatQty(i.returned_qty)} already back`}
                          {avail <= 0 && " · all returned"}
                        </span>
                      </span>
                      {on && <span className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(valueOf(i, l.qty))}</span>}
                    </label>

                    {avail > 0 && on && (
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 pl-7">
                        {i.serials ? (
                          <fieldset className="flex flex-wrap gap-x-3 gap-y-1.5">
                            <legend className="sr-only">{serialLabel}</legend>
                            {i.serials.map((s) => (
                              <label key={s.id} className="flex items-center gap-1.5 font-mono text-xs">
                                <input
                                  type="checkbox"
                                  className="accent-brand-600"
                                  checked={l.serialIds.includes(s.id)}
                                  onChange={(e) => toggleSerial(i, s.id, e.target.checked)}
                                />
                                {s.serial}
                              </label>
                            ))}
                          </fieldset>
                        ) : (
                          <span className="flex items-center gap-2 text-xs text-zinc-500">
                            <Stepper
                              value={l.qty}
                              max={avail}
                              label={i.name}
                              fractional={i.allow_fractional}
                              onChange={(q) => setLine(i, { qty: q })}
                            />
                            of {formatQty(avail)}
                          </span>
                        )}
                        {service ? (
                          <span className="text-xs text-zinc-500">Service — nothing goes back into stock</span>
                        ) : (
                          <label className={clsx("flex items-center gap-1.5 text-xs", writeOffAll && "text-zinc-400")}>
                            <input
                              type="checkbox"
                              className="accent-brand-600"
                              checked={restocks(i)}
                              disabled={writeOffAll}
                              onChange={(e) => setLine(i, { restock: e.target.checked })}
                            />
                            {restocks(i) ? (
                              <PackageCheck aria-hidden className="h-3.5 w-3.5 text-good" />
                            ) : (
                              <PackageX aria-hidden className="h-3.5 w-3.5 text-critical" />
                            )}
                            Return to sellable inventory?
                          </label>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {/* 2. Reason */}
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ret-reason" className={labelClass}>
                Return reason
              </label>
              <select id="ret-reason" value={reason} onChange={(e) => changeReason(e.target.value as ReturnReason)} className={selectClass}>
                {REASONS.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ret-note" className={labelClass}>
                Details {reason === "other" ? "(required)" : "(optional)"}
              </label>
              <input
                id="ret-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
                placeholder="e.g. screen cracked, too small"
                className={inputClass}
              />
            </div>
            {writeOffAll && (
              <p className="text-xs text-amber-700 sm:col-span-2 dark:text-amber-400">
                Damaged or expired goods are written off as a stock loss, not put back on the shelf as new.
              </p>
            )}
          </section>

          {/* 3. What the customer gets */}
          <section>
            <h3 id="ret-action" className="mb-2 text-sm font-semibold">
              Action
            </h3>
            <div role="radiogroup" aria-labelledby="ret-action" className="grid grid-cols-2 gap-2">
              <ActionChoice on={action === "cash"} onClick={() => chooseAction("cash")} icon={Banknote} label="Cash refund" />
              <ActionChoice
                on={action === "mobile_money"}
                onClick={() => chooseAction("mobile_money")}
                icon={Smartphone}
                label="Mobile money refund"
                disabled={momoOptions.length === 0}
                hint={momoOptions.length === 0 ? "Not switched on" : undefined}
              />
              <ActionChoice
                on={action === "store_credit"}
                onClick={() => chooseAction("store_credit")}
                icon={Ticket}
                label="Store credit"
                disabled={!customer}
                hint={customer ? `${customer.name} has ${formatMoney(customer.store_credit)}` : `Needs a named ${terms.customer.toLowerCase()}`}
              />
              {canExchange && (
                <ActionChoice on={isExchange} onClick={() => chooseAction("exchange")} icon={ArrowLeftRight} label="Exchange for other items" />
              )}
            </div>

            {isExchange && (
              <div className="mt-3 flex flex-col gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="relative">
                  <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && matches.length) {
                        e.preventDefault();
                        addSwap(matches[0]);
                      }
                    }}
                    placeholder={catalog ? `Search ${terms.items.toLowerCase()} or scan a barcode` : "Loading…"}
                    disabled={!catalog}
                    className={clsx(inputClass, "pl-9")}
                    aria-label={`Search ${terms.items.toLowerCase()} for the exchange`}
                  />
                </div>
                {catalogError && <ErrorNote>{catalogError}</ErrorNote>}
                {matches.length > 0 && (
                  <ul className="-mt-1 divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                    {matches.map((m) => {
                      const out = m.kind !== "service" && m.stock <= 0;
                      return (
                        <li key={m.id}>
                          <button type="button" onClick={() => addSwap(m)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900">
                            <span className="min-w-0 truncate">{m.name}</span>
                            <span className="flex shrink-0 items-center gap-2 tabular-nums">
                              <span className={clsx("text-xs", out ? "text-red-600" : "text-zinc-500")}>
                                {m.kind === "service" ? "service" : out ? "out" : formatQty(m.stock, m.unit)}
                              </span>
                              {formatMoney(m.selling_price)}
                              <Plus aria-hidden className="h-4 w-4 text-brand-700 dark:text-brand-500" />
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {swap.length === 0 ? (
                  <p className="text-xs text-zinc-500">Add what the {terms.customer.toLowerCase()} takes instead. New items sell at the catalogue price.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {swap.map((l) => {
                      const serial = l.item.track_mode === "serial" && l.item.kind !== "service";
                      return (
                        <li key={l.key} className="rounded-lg bg-zinc-50 p-2.5 dark:bg-zinc-900">
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-sm font-medium">{l.item.name}</span>
                            <span className="flex shrink-0 items-center gap-2">
                              <span className="text-sm font-semibold tabular-nums">{formatMoney(round2(l.qty * l.item.selling_price))}</span>
                              <button
                                type="button"
                                onClick={() => setSwap((prev) => prev.filter((x) => x.key !== l.key))}
                                className="p-1 text-zinc-400 hover:text-red-600"
                                aria-label={`Remove ${l.item.name}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </span>
                          </div>
                          <div className="mt-2">
                            {serial ? (
                              (l.item.serials ?? []).length === 0 ? (
                                <p className="text-xs text-red-700 dark:text-red-400">No {serialLabel} of this in stock.</p>
                              ) : (
                                <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                                  {(l.item.serials ?? []).map((s) => (
                                    <label key={s.id} className="flex items-center gap-1.5 font-mono text-xs">
                                      <input
                                        type="checkbox"
                                        className="accent-brand-600"
                                        checked={l.serialIds.includes(s.id)}
                                        onChange={(e) => {
                                          const ids = e.target.checked ? [...l.serialIds, s.id] : l.serialIds.filter((x) => x !== s.id);
                                          setSwapLine(l.key, { serialIds: ids, qty: ids.length });
                                        }}
                                      />
                                      {s.serial}
                                    </label>
                                  ))}
                                </div>
                              )
                            ) : (
                              <span className="flex items-center gap-2 text-xs text-zinc-500">
                                <Stepper
                                  value={l.qty}
                                  max={9999}
                                  label={l.item.name}
                                  fractional={l.item.allow_fractional}
                                  onChange={(q) => setSwapLine(l.key, { qty: q })}
                                />
                                × {formatMoney(l.item.selling_price)}
                              </span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {swap.some((l) => l.item.requires_prescription) && (
                  <input value={rxRef} onChange={(e) => setRxRef(e.target.value)} placeholder="Prescription reference (required)" className={inputClass} />
                )}
                {topUp > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="ret-topup" className={labelClass}>
                        {terms.customer} pays the difference by
                      </label>
                      <select id="ret-topup" value={topUpMethod} onChange={(e) => setTopUpMethod(e.target.value as PaymentMethod)} className={selectClass}>
                        {topUpMethods.map((m) => (
                          <option key={m} value={m}>
                            {PAYMENT_LABELS[m]}
                          </option>
                        ))}
                      </select>
                    </div>
                    {topUpMethod !== "cash" && topUpMethod !== "credit" && (
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="ret-topup-ref" className={labelClass}>
                          Transaction ID (optional)
                        </label>
                        <input id="ret-topup-ref" value={topUpRef} onChange={(e) => setTopUpRef(e.target.value)} className={inputClass} />
                      </div>
                    )}
                  </div>
                )}
                {swap.length > 0 && left > 0 && payout > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <span className={labelClass}>The new items cost less. Give back {formatMoney(payout)} as</span>
                    <div className="flex flex-wrap gap-1.5">
                      <Pill on={leftover === "cash"} onClick={() => setLeftover("cash")}>
                        Cash
                      </Pill>
                      {momoOptions.length > 0 && (
                        <Pill on={leftover === "mobile_money"} onClick={() => setLeftover("mobile_money")}>
                          Mobile money
                        </Pill>
                      )}
                      {customer && (
                        <Pill on={leftover === "store_credit"} onClick={() => setLeftover("store_credit")}>
                          Store credit
                        </Pill>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {payout > 0 && payoutMethod === "mobile_money" && momoOptions.length > 0 && (
              <div className="mt-3 flex flex-col gap-1.5">
                <label htmlFor="ret-momo" className={labelClass}>
                  Send the refund by
                </label>
                <select id="ret-momo" value={provider} onChange={(e) => setProvider(e.target.value as MobileMoneyProvider)} className={selectClass}>
                  {momoOptions.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_LABELS[m]}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {toBalance > 0 && (
              <p className="mt-3 text-xs text-zinc-500">
                This {terms.sale.toLowerCase()} was on credit: {formatMoney(toBalance)} comes off what {customer?.name} owes before any money is handed back.
              </p>
            )}
          </section>

          {summary}
          {error && <ErrorNote>{error}</ErrorNote>}
          <button type="button" onClick={next} disabled={!chosen.length} className={clsx(buttonPrimary, "w-full !py-3")}>
            <KeyRound aria-hidden className="h-4 w-4" /> Continue to manager PIN
          </button>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function payoutLabel(method: Payout, provider: MobileMoneyProvider | ""): string {
  if (method === "cash") return "Cash back";
  if (method === "mobile_money") return `Back by ${provider ? PAYMENT_LABELS[provider] : "mobile money"}`;
  return "Added to store credit";
}

function payoutText(r: ReturnResult): string | null {
  const paid = Number(r.refund_paid);
  if (paid <= 0) return null;
  if (r.refund_method === "cash") return `Give the customer ${formatMoney(paid)} in cash.`;
  if (r.refund_method === "mobile_money") return `Send ${formatMoney(paid)} back by ${r.momo_provider ? PAYMENT_LABELS[r.momo_provider] : "mobile money"}.`;
  return `${formatMoney(paid)} added to ${r.customer ?? "the customer"}'s store credit.`;
}

function Stepper({
  value,
  max,
  label,
  fractional,
  onChange,
}: {
  value: number;
  max: number;
  label: string;
  fractional: boolean;
  onChange: (qty: number) => void;
}) {
  const clamp = (q: number) => Math.min(max, Math.max(0, fractional ? round3(q) : Math.round(q)));
  return (
    <span className="flex items-center rounded-lg border border-zinc-200 bg-surface dark:border-zinc-700">
      <button type="button" onClick={() => onChange(clamp(value - 1))} disabled={value <= 0} className="p-1.5 disabled:opacity-40" aria-label={`Fewer ${label}`}>
        <Minus className="h-3.5 w-3.5" />
      </button>
      <input
        value={value}
        inputMode="decimal"
        onChange={(e) => onChange(clamp(num(e.target.value)))}
        className="w-12 bg-transparent text-center text-sm tabular-nums text-zinc-900 outline-none dark:text-zinc-50"
        aria-label={`${label} quantity`}
      />
      <button type="button" onClick={() => onChange(clamp(value + 1))} disabled={value >= max} className="p-1.5 disabled:opacity-40" aria-label={`More ${label}`}>
        <Plus className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

function ActionChoice({
  on,
  onClick,
  icon: Icon,
  label,
  hint,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "flex min-h-16 flex-col items-start gap-1 rounded-xl border p-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        on
          ? "border-brand-600 bg-brand-50 text-brand-800 dark:border-brand-500 dark:bg-brand-800/20 dark:text-brand-100"
          : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700",
      )}
    >
      <span className="flex items-center gap-2 font-medium">
        <Icon className="h-4 w-4 shrink-0" /> {label}
      </span>
      {hint && <span className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>}
    </button>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded-full border px-3 py-1.5 text-sm",
        on ? "border-brand-600 bg-brand-50 text-brand-800 dark:border-brand-500 dark:bg-brand-800/20 dark:text-brand-100" : "border-zinc-300 dark:border-zinc-700",
      )}
    >
      {children}
    </button>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={clsx("flex justify-between gap-3", strong && "font-semibold")}>
      <dt className={strong ? "" : "text-zinc-600 dark:text-zinc-400"}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function ResultLine({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <li className={clsx("rounded-lg px-3 py-2", strong ? "bg-green-50 font-semibold text-green-900 dark:bg-green-950/40 dark:text-green-200" : "bg-zinc-50 dark:bg-zinc-900")}>
      {children}
    </li>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
      <AlertOctagon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
