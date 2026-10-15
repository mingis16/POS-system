"use client";

import { CloudOff, MessageCircle, Printer } from "lucide-react";
import { PAYMENT_LABELS, formatDateTime, formatMoney, formatQty, formatUsd } from "@/lib/format";
import type { Currency, PaymentMethod } from "@/lib/types";
import { buttonPrimary, buttonSecondary } from "@/components/ui/styles";

export interface ReceiptData {
  businessName: string;
  address: string;
  phone: string | null;
  receiptNo: number | null;
  at: string;
  cashier: string;
  customer: string | null;
  tableLabel?: string;
  lines: { name: string; qty: number; unit: string; price: number; discount: number; total: number; serials?: string[] }[];
  subtotal: number;
  discount: number;
  total: number;
  payments: { method: PaymentMethod; currency: Currency; amount: number; base: number }[];
  change: number;
  offline: boolean;
  saleLabel: string;
}

export function receiptText(r: ReceiptData): string {
  const lines = [
    r.businessName,
    r.address,
    r.phone ?? "",
    `${r.saleLabel} ${r.receiptNo ? "#" + r.receiptNo : "(offline, number on sync)"} · ${formatDateTime(r.at)}`,
    "",
    ...r.lines.map((l) => `${l.name} × ${formatQty(l.qty)} = ${formatMoney(l.total)}`),
    "",
    r.discount ? `Discount: -${formatMoney(r.discount)}` : "",
    `TOTAL: ${formatMoney(r.total)}`,
    ...r.payments.map((p) => `${PAYMENT_LABELS[p.method]}: ${p.currency === "USD" ? formatUsd(p.amount) : formatMoney(p.amount)}`),
    r.change > 0 ? `Change: ${formatMoney(r.change)}` : "",
    "",
    "Thank you!",
  ];
  return lines.filter((l, i) => l !== "" || lines[i - 1] !== "").join("\n");
}

export function Receipt({ data, onNewSale }: { data: ReceiptData; onNewSale: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      {data.offline && (
        <p className="no-print flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0" />
          Saved on this device. It will be sent automatically when the network returns.
        </p>
      )}
      <div className="print-area mx-auto w-full max-w-[320px] rounded-xl border border-dashed border-zinc-300 bg-white p-4 font-mono text-[12px] leading-relaxed text-black dark:border-zinc-700">
        <div className="text-center">
          <p className="text-sm font-bold">{data.businessName}</p>
          {data.address && <p>{data.address}</p>}
          {data.phone && <p>Tel: {data.phone}</p>}
          <p className="mt-1">
            {data.saleLabel} {data.receiptNo ? `#${data.receiptNo}` : "(offline)"} · {formatDateTime(data.at)}
          </p>
          <p>Served by {data.cashier}</p>
          {data.customer && <p>Customer: {data.customer}</p>}
          {data.tableLabel && <p>Table: {data.tableLabel}</p>}
        </div>
        <hr className="my-2 border-dashed border-zinc-400" />
        {data.lines.map((l, i) => (
          <div key={i} className="mb-1">
            <div className="flex justify-between gap-2">
              <span className="min-w-0 break-words">{l.name}</span>
              <span className="shrink-0">{formatMoney(l.total)}</span>
            </div>
            <div className="text-[11px] text-zinc-600">
              {formatQty(l.qty)} {l.unit} × {formatMoney(l.price)}
              {l.discount > 0 && ` − ${formatMoney(l.discount)}`}
            </div>
            {l.serials?.length ? <div className="text-[11px] text-zinc-600">S/N: {l.serials.join(", ")}</div> : null}
          </div>
        ))}
        <hr className="my-2 border-dashed border-zinc-400" />
        {data.discount > 0 && (
          <div className="flex justify-between">
            <span>Discount</span>
            <span>-{formatMoney(data.discount)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm font-bold">
          <span>TOTAL</span>
          <span>{formatMoney(data.total)}</span>
        </div>
        {data.payments.map((p, i) => (
          <div key={i} className="flex justify-between">
            <span>{PAYMENT_LABELS[p.method]}</span>
            <span>{p.currency === "USD" ? `${formatUsd(p.amount)} (${formatMoney(p.base)})` : formatMoney(p.amount)}</span>
          </div>
        ))}
        {data.change > 0 && (
          <div className="flex justify-between font-bold">
            <span>Change</span>
            <span>{formatMoney(data.change)}</span>
          </div>
        )}
        <p className="mt-3 text-center">Thank you for your custom!</p>
      </div>
      <div className="no-print grid grid-cols-3 gap-2">
        <button type="button" onClick={() => window.print()} className={buttonSecondary}>
          <Printer className="h-4 w-4" /> Print
        </button>
        <a
          className={buttonSecondary}
          target="_blank"
          rel="noreferrer"
          href={`https://wa.me/?text=${encodeURIComponent(receiptText(data))}`}
        >
          <MessageCircle className="h-4 w-4" /> WhatsApp
        </a>
        <button type="button" onClick={onNewSale} className={buttonPrimary} autoFocus>
          New sale
        </button>
      </div>
    </div>
  );
}
