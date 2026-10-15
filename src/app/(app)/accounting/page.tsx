import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { PAYMENT_LABELS, addDays, formatDate, formatMoney, formatPct, isISODate, titleCase, todayISO } from "@/lib/format";
import { Card, PageHeader, TableWrap } from "@/components/ui/card";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { PrintButton } from "@/components/ui/print-button";
import { buttonSecondary, inputClass, numClass, selectClass, tableClass, tdClass, thClass } from "@/components/ui/styles";
import { ownerTransaction } from "./actions";
import type { PaymentMethod } from "@/lib/types";

export const metadata = { title: "Accounts" };

interface Balance {
  account_id: string;
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  system_key: string | null;
  debit: number;
  credit: number;
  balance: number;
}
interface PL {
  revenue: number;
  revenue_lines: { name: string; amount: number }[];
  cogs: number;
  gross_profit: number;
  expense_lines: { name: string; amount: number }[];
  operating_expenses: number;
  shrinkage: number;
  net_profit: number;
  net_margin_pct: number | null;
}
interface CashFlow {
  accounts: { key: string; name: string; opening: number; inflow: number; outflow: number; closing: number }[];
  by_source: { source: string; inflow: number; outflow: number }[];
}

const SOURCE_LABELS: Record<string, string> = {
  sales: "Sales",
  expenses: "Expenses",
  stock_receipts: "Stock purchases",
  supplier_payments: "Supplier payments",
  customer_payments: "Customer debt repayments",
  job_payments: "Job / service payments",
  owner_transactions: "Owner capital & drawings",
  businesses: "Opening balances",
  products: "Opening stock",
  other: "Other",
};

export default async function AccountingPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; tab?: string }> }) {
  const { supabase, business, can } = await requireAdmin();
  const sp = await searchParams;
  const to = sp.to && isISODate(sp.to) ? sp.to : todayISO();
  const from = sp.from && isISODate(sp.from) ? sp.from : `${to.slice(0, 8)}01`;
  const tab = sp.tab ?? "pl";

  const [pl, bal, cf, journal] = await Promise.all([
    supabase.rpc("profit_and_loss", { b: business.id, p_from: from, p_to: to }),
    supabase.rpc("account_balances", { b: business.id, p_from: null, p_to: to }),
    supabase.rpc("cash_flow", { b: business.id, p_from: from, p_to: to }),
    tab === "journal"
      ? supabase
          .from("journal_entries")
          .select("id, entry_no, entry_date, memo, source_table, reverses, journal_lines(debit, credit, accounts(name, code))")
          .eq("business_id", business.id)
          .gte("entry_date", from)
          .lte("entry_date", to)
          .order("entry_no", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: null }),
  ]);
  const p = pl.data as PL | null;
  const balances = (bal.data ?? []) as Balance[];
  const flow = cf.data as CashFlow | null;
  const sum = (t: Balance["type"]) => balances.filter((b) => b.type === t).reduce((s, b) => s + Number(b.balance), 0);
  const assets = sum("asset");
  const liabilities = sum("liability");
  const equity = sum("equity");
  const retained = sum("revenue") - sum("expense");
  const tb = balances.reduce((s, b) => ({ d: s.d + Number(b.debit), c: s.c + Number(b.credit) }), { d: 0, c: 0 });
  const methods = ["cash", ...business.payment_methods.filter((m) => m !== "cash" && m !== "credit")] as PaymentMethod[];
  const tabs = [
    ["pl", "Profit & loss"],
    ["bs", "Balance sheet"],
    ["cf", "Cash flow"],
    ["ar", "Owed to / by you"],
    ["journal", "General ledger"],
  ] as const;

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Kept automatically: every sale, expense, delivery and payment posts a double-entry journal entry."
        actions={<PrintButton />}
      />
      <form className="no-print mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value={tab} />
        <label className="text-xs text-zinc-500">
          From
          <input type="date" name="from" defaultValue={from} className={`${inputClass} !py-1.5`} />
        </label>
        <label className="text-xs text-zinc-500">
          To
          <input type="date" name="to" defaultValue={to} className={`${inputClass} !py-1.5`} />
        </label>
        <button className={buttonSecondary}>Show</button>
      </form>
      <nav className="no-print mb-5 flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
        {tabs.map(([k, label]) => (
          <Link
            key={k}
            href={`/accounting?tab=${k}&from=${from}&to=${to}`}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm ${tab === k ? "border-brand-600 font-medium text-brand-800 dark:text-brand-100" : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      <div className="print-area">
        {tab === "pl" && p && (
          <Card title={`Profit & loss · ${formatDate(from)} – ${formatDate(to)}`} className="max-w-2xl">
            <dl className="flex flex-col gap-1.5 text-sm">
              {p.revenue_lines.map((r) => (
                <Line key={r.name} label={r.name} value={r.amount} />
              ))}
              <Line label="Total revenue" value={p.revenue} strong />
              <Line label="Cost of goods sold" value={-p.cogs} />
              <Line label="Gross profit" value={p.gross_profit} strong />
              {p.expense_lines.map((e) => (
                <Line key={e.name} label={e.name} value={-e.amount} indent />
              ))}
              <Line label="Operating expenses" value={-p.operating_expenses} />
              {Number(p.shrinkage) !== 0 && <Line label="Stock losses & shrinkage" value={-p.shrinkage} />}
              <Line label={Number(p.net_profit) >= 0 ? "Net profit" : "Net loss"} value={p.net_profit} strong />
              <div className="mt-1 text-right text-xs text-zinc-500">Net margin {formatPct(p.net_margin_pct)}</div>
            </dl>
          </Card>
        )}

        {tab === "bs" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title={`Balance sheet at ${formatDate(to)}`}>
              <dl className="flex flex-col gap-1.5 text-sm">
                {balances.filter((b) => b.type === "asset" && Number(b.balance) !== 0).map((b) => (
                  <Line key={b.account_id} label={b.name} value={b.balance} />
                ))}
                <Line label="Total assets" value={assets} strong />
                {balances.filter((b) => b.type === "liability" && Number(b.balance) !== 0).map((b) => (
                  <Line key={b.account_id} label={b.name} value={b.balance} />
                ))}
                <Line label="Total liabilities" value={liabilities} strong />
                {balances.filter((b) => b.type === "equity" && Number(b.balance) !== 0).map((b) => (
                  <Line key={b.account_id} label={b.name} value={b.balance} />
                ))}
                <Line label="Profit kept in the business" value={retained} />
                <Line label="Total equity" value={equity + retained} strong />
                <p className="mt-2 text-xs text-zinc-500">
                  Check: assets {formatMoney(assets)} = liabilities + equity {formatMoney(liabilities + equity + retained)}
                </p>
              </dl>
            </Card>
            <Card title="Trial balance" bodyClassName="px-4 py-0 sm:px-5 sm:py-0">
              <TableWrap>
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th className={thClass}>Account</th>
                      <th className={`${thClass} ${numClass}`}>Debit</th>
                      <th className={`${thClass} ${numClass}`}>Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balances.filter((b) => Number(b.debit) || Number(b.credit)).map((b) => {
                      const net = Number(b.debit) - Number(b.credit);
                      return (
                        <tr key={b.account_id}>
                          <td className={tdClass}>
                            <span className="text-xs text-zinc-400">{b.code}</span> {b.name}
                          </td>
                          <td className={`${tdClass} ${numClass}`}>{net > 0 ? formatMoney(net) : ""}</td>
                          <td className={`${tdClass} ${numClass}`}>{net < 0 ? formatMoney(-net) : ""}</td>
                        </tr>
                      );
                    })}
                    <tr className="font-semibold">
                      <td className={tdClass}>Total</td>
                      <td className={`${tdClass} ${numClass}`}>{formatMoney(tb.d)}</td>
                      <td className={`${tdClass} ${numClass}`}>{formatMoney(tb.c)}</td>
                    </tr>
                  </tbody>
                </table>
              </TableWrap>
            </Card>
          </div>
        )}

        {tab === "cf" && flow && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Cash, mobile money & bank" bodyClassName="px-4 py-0 sm:px-5 sm:py-0">
              <TableWrap>
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th className={thClass}>Account</th>
                      <th className={`${thClass} ${numClass}`}>Opening</th>
                      <th className={`${thClass} ${numClass}`}>In</th>
                      <th className={`${thClass} ${numClass}`}>Out</th>
                      <th className={`${thClass} ${numClass}`}>Closing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flow.accounts.map((a) => (
                      <tr key={a.key}>
                        <td className={tdClass}>{a.name}</td>
                        <td className={`${tdClass} ${numClass}`}>{formatMoney(a.opening)}</td>
                        <td className={`${tdClass} ${numClass}`}>{formatMoney(a.inflow)}</td>
                        <td className={`${tdClass} ${numClass}`}>{formatMoney(a.outflow)}</td>
                        <td className={`${tdClass} ${numClass} font-medium`}>{formatMoney(a.closing)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </Card>
            <Card title="Where the money came from and went">
              <dl className="flex flex-col gap-1.5 text-sm">
                {flow.by_source.map((s) => (
                  <div key={s.source} className="flex justify-between gap-3">
                    <dt>{SOURCE_LABELS[s.source] ?? titleCase(s.source)}</dt>
                    <dd className="tabular-nums">
                      {Number(s.inflow) > 0 && <span className="text-green-800 dark:text-green-400">+{formatMoney(s.inflow)}</span>}{" "}
                      {Number(s.outflow) > 0 && <span className="text-red-700 dark:text-red-400">−{formatMoney(s.outflow)}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>
        )}

        {tab === "ar" && <Owed businessId={business.id} />}

        {tab === "journal" && (
          <Card title="General ledger" bodyClassName="px-4 py-0 sm:px-5 sm:py-0">
            <TableWrap>
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>#</th>
                    <th className={thClass}>Date</th>
                    <th className={thClass}>Memo</th>
                    <th className={thClass}>Account</th>
                    <th className={`${thClass} ${numClass}`}>Debit</th>
                    <th className={`${thClass} ${numClass}`}>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {((journal.data ?? []) as unknown as {
                    id: string;
                    entry_no: number;
                    entry_date: string;
                    memo: string;
                    reverses: string | null;
                    journal_lines: { debit: number; credit: number; accounts: { name: string; code: string } }[];
                  }[]).flatMap((e) =>
                    e.journal_lines.map((l, i) => (
                      <tr key={`${e.id}-${i}`} className={i === 0 ? "border-t-2 border-zinc-100 dark:border-zinc-800" : ""}>
                        <td className={tdClass}>{i === 0 ? e.entry_no : ""}</td>
                        <td className={tdClass}>{i === 0 ? formatDate(e.entry_date) : ""}</td>
                        <td className={`${tdClass} max-w-56 truncate`}>{i === 0 ? `${e.reverses ? "↺ " : ""}${e.memo}` : ""}</td>
                        <td className={tdClass}>{l.accounts.name}</td>
                        <td className={`${tdClass} ${numClass}`}>{Number(l.debit) ? formatMoney(l.debit) : ""}</td>
                        <td className={`${tdClass} ${numClass}`}>{Number(l.credit) ? formatMoney(l.credit) : ""}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        )}
      </div>

      {can.ownerMoney && (
        <Card title="Owner's money" description="Money you put into the business (capital) or take out for yourself (drawings)." className="no-print mt-5 max-w-2xl">
          <ActionForm action={ownerTransaction} className="grid gap-3 sm:grid-cols-4">
            <Field label="Type">
              <select name="kind" className={selectClass}>
                <option value="drawing">Drawing (take out)</option>
                <option value="capital">Capital (put in)</option>
              </select>
            </Field>
            <Field label="Amount (Le)">
              <input name="amount" inputMode="decimal" required className={inputClass} />
            </Field>
            <Field label="Method">
              <select name="method" className={selectClass}>
                {methods.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_LABELS[m]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Note">
              <input name="note" className={inputClass} />
            </Field>
            <div className="sm:col-span-4">
              <SubmitButton>Record</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}
      <p className="no-print mt-4 text-xs text-zinc-500">Period shown: {formatDate(from)} to {formatDate(to)}. Balances are as at {formatDate(addDays(to, 0))}.</p>
    </>
  );
}

async function Owed({ businessId }: { businessId: string }) {
  const { supabase } = await requireAdmin();
  const [{ data: customers }, { data: suppliers }] = await Promise.all([
    supabase.from("customers").select("id, name, phone, balance, credit_limit").eq("business_id", businessId).gt("balance", 0).order("balance", { ascending: false }),
    supabase.from("suppliers").select("id, name, phone, balance_due").eq("business_id", businessId).gt("balance_due", 0).order("balance_due", { ascending: false }),
  ]);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Accounts receivable (customers owe you)">
        <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
          {(customers ?? []).map((c) => (
            <li key={c.id} className="flex justify-between py-2">
              <span>
                {c.name} <span className="text-xs text-zinc-500">{c.phone}</span>
              </span>
              <span className="tabular-nums">{formatMoney(c.balance)}</span>
            </li>
          ))}
          {!customers?.length && <li className="py-2 text-zinc-500">Nobody owes you.</li>}
        </ul>
      </Card>
      <Card title="Accounts payable (you owe suppliers)">
        <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
          {(suppliers ?? []).map((s) => (
            <li key={s.id} className="flex justify-between py-2">
              <span>
                {s.name} <span className="text-xs text-zinc-500">{s.phone}</span>
              </span>
              <span className="tabular-nums">{formatMoney(s.balance_due)}</span>
            </li>
          ))}
          {!suppliers?.length && <li className="py-2 text-zinc-500">You owe no suppliers.</li>}
        </ul>
      </Card>
    </div>
  );
}

function Line({ label, value, strong, indent }: { label: string; value: number; strong?: boolean; indent?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "border-t border-zinc-100 pt-1.5 font-semibold dark:border-zinc-800" : ""} ${indent ? "pl-4 text-zinc-500" : ""}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{formatMoney(value)}</dd>
    </div>
  );
}
