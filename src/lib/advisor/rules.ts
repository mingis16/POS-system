/**
 * Rule-based business advisor. Works with no AI key: turns the metrics from
 * advisor_metrics() into concrete, numeric recommendations. The Claude layer
 * (./claude.ts) builds on these when ANTHROPIC_API_KEY is set.
 */
import { formatMoney, formatQty } from "@/lib/format";
import type { Advice } from "@/lib/types";

export interface ItemMetric {
  id: string;
  name: string;
  unit: string;
  kind: "stock" | "service" | "raw_material";
  cost_price: number;
  selling_price: number;
  reorder_level: number;
  reorder_qty: number;
  stock: number;
  sold_7d: number;
  sold_prev_7d: number;
  sold_28d: number;
  weekend_28d: number;
  revenue_7d: number;
  profit_7d: number;
  last_sold_at: string | null;
  created_at: string;
  last_received_at: string | null;
}

export interface AdvisorMetrics {
  as_of: string;
  today: string;
  business: { name: string; type: string; custom_type: string | null; city: string };
  items: ItemMetric[];
  revenue_7d: number;
  revenue_prev_7d: number;
  expenses: { category: string; last_7d: number; avg_prev_4w: number }[];
  shrinkage_7d: number;
  shrinkage_items: { name: string; location: string; qty: number; value: number }[];
  cash_variance_7d: { name: string; variance: number }[];
  receivables: number;
  top_debtors: { name: string; phone: string | null; balance: number }[];
  payables: number;
  expiring_30d: { batches: number; value: number };
  voids_7d: number;
  discounts_7d: number;
}

const n = (v: unknown) => Number(v ?? 0) || 0;
const DAY = 86_400_000;
const weekday = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);

export function ruleAdvice(m: AdvisorMetrics): Advice[] {
  const out: (Advice & { score: number })[] = [];
  const today = new Date(m.today + "T00:00:00Z");
  const items = m.items.map((i) => ({
    ...i,
    cost_price: n(i.cost_price),
    selling_price: n(i.selling_price),
    reorder_qty: n(i.reorder_qty),
    stock: n(i.stock),
    sold_7d: n(i.sold_7d),
    sold_prev_7d: n(i.sold_prev_7d),
    sold_28d: n(i.sold_28d),
    weekend_28d: n(i.weekend_28d),
    revenue_7d: n(i.revenue_7d),
  }));
  const revenue = n(m.revenue_7d);
  const prevRevenue = n(m.revenue_prev_7d);

  if (revenue === 0 && items.every((i) => i.sold_28d === 0)) {
    return [
      {
        title: "Record every sale for a week to unlock advice",
        detail: "There are no sales in the last 4 weeks yet. Once sales, deliveries and expenses are recorded daily, this page shows re-order timing, slow stock, margins and losses.",
        priority: "medium",
        category: "general",
      },
    ];
  }

  // 1. Stock-out risk, with the trend and the weekend pattern behind it.
  for (const i of items) {
    if (i.kind === "service" || i.sold_7d <= 0) continue;
    const daily = i.sold_7d / 7;
    const cover = i.stock / daily;
    if (cover >= 7) continue;
    const growth = pct(i.sold_7d, i.sold_prev_7d);
    const weekendShare = i.sold_28d > 0 ? i.weekend_28d / i.sold_28d : 0;
    const runOut = new Date(today.getTime() + Math.max(0, Math.floor(cover)) * DAY);
    const orderBy = new Date(Math.max(today.getTime(), runOut.getTime() - 2 * DAY));
    const target = Math.ceil(daily * 14 - Math.max(0, i.stock));
    const qty = Math.max(target, Math.ceil(i.reorder_qty));
    const parts = [
      growth !== null && growth >= 15
        ? `Your stock of ${i.name} is depleting ${growth}% faster this week (${formatQty(i.sold_7d)} sold vs ${formatQty(i.sold_prev_7d)} the week before).`
        : `${i.name} is selling about ${formatQty(Math.round(daily * 10) / 10)} ${i.unit} a day.`,
      i.stock <= 0
        ? "It is already out of stock on the system."
        : `At this rate the ${formatQty(i.stock, i.unit)} left run out in about ${Math.max(1, Math.round(cover))} day(s) (${weekday(runOut)}).`,
      weekendShare >= 0.5 ? `${Math.round(weekendShare * 100)}% of its sales happen Friday–Sunday, so stock up before the weekend.` : "",
    ].filter(Boolean);
    out.push({
      title: `Re-order ${i.name}`,
      detail: parts.join(" "),
      action: `Order about ${formatQty(qty, i.unit)} before ${weekday(orderBy)} to cover two weeks.`,
      priority: cover < 3 ? "high" : "medium",
      category: "stock",
      score: 100 - cover * 10 + Math.min(i.revenue_7d / 1000, 20),
    });
  }

  // 2. Dead stock
  const dead = items
    .filter((i) => i.kind !== "service" && i.stock > 0 && i.sold_28d === 0 && Date.parse(i.created_at) < today.getTime() - 28 * DAY)
    .map((i) => ({ ...i, value: i.stock * i.cost_price }))
    .sort((a, b) => b.value - a.value);
  const deadValue = dead.reduce((s, i) => s + i.value, 0);
  if (dead.length && deadValue > 0) {
    out.push({
      title: `${formatMoney(deadValue)} tied up in slow stock`,
      detail: `${dead.length} item(s) have not sold in 4 weeks: ${dead.slice(0, 4).map((i) => `${i.name} (${formatMoney(i.value)})`).join(", ")}.`,
      action: "Discount or bundle them with fast sellers, return them to the supplier if you can, and stop re-ordering until they move.",
      priority: deadValue > revenue * 0.5 ? "medium" : "low",
      category: "stock",
      score: 40 + Math.min(deadValue / 1000, 30),
    });
  }

  // 3. Prices below cost / thin margins
  const belowCost = items.filter((i) => i.kind === "stock" && i.sold_7d > 0 && i.selling_price > 0 && i.selling_price < i.cost_price);
  for (const i of belowCost.slice(0, 3)) {
    out.push({
      title: `${i.name} sells below cost`,
      detail: `Selling price ${formatMoney(i.selling_price)} but average cost is ${formatMoney(i.cost_price)} — every sale loses ${formatMoney(i.cost_price - i.selling_price)}. You sold ${formatQty(i.sold_7d)} this week.`,
      action: `Raise the price to at least ${formatMoney(Math.ceil(i.cost_price * 1.15))} or find a cheaper supplier.`,
      priority: "high",
      category: "costs",
      score: 90,
    });
  }
  const thin = items.filter((i) => i.kind === "stock" && i.sold_7d > 0 && i.selling_price >= i.cost_price && i.cost_price > 0 && (i.selling_price - i.cost_price) / i.selling_price < 0.08);
  if (thin.length) {
    out.push({
      title: "Very thin margins on some items",
      detail: `${thin.slice(0, 4).map((i) => `${i.name} (${Math.round(((i.selling_price - i.cost_price) / i.selling_price) * 100)}%)`).join(", ")} earn under 8% after cost — transport, wages and EDSA eat that up.`,
      action: "Review these prices against your latest delivery costs.",
      priority: "medium",
      category: "costs",
      score: 50,
    });
  }

  // 4. Revenue trend
  const revChange = pct(revenue, prevRevenue);
  if (revChange !== null && Math.abs(revChange) >= 15) {
    const up = revChange > 0;
    const movers = [...items]
      .filter((i) => i.sold_prev_7d > 0 || i.sold_7d > 0)
      .map((i) => ({ i, delta: (i.revenue_7d / Math.max(i.sold_7d, 1)) * (i.sold_7d - i.sold_prev_7d) }))
      .sort((a, b) => (up ? b.delta - a.delta : a.delta - b.delta))
      .slice(0, 3)
      .map((x) => x.i.name);
    out.push({
      title: up ? `Sales up ${revChange}% this week` : `Sales down ${-revChange}% this week`,
      detail: `${formatMoney(revenue)} in the last 7 days vs ${formatMoney(prevRevenue)} the week before.${movers.length ? ` Biggest movers: ${movers.join(", ")}.` : ""}`,
      action: up ? "Make sure the fast movers stay in stock." : "Check whether stock-outs, prices or competition explain the drop.",
      priority: up ? "low" : "medium",
      category: "sales",
      score: up ? 20 : 55,
    });
  }

  // 5. Expense spikes
  for (const e of m.expenses ?? []) {
    const last = n(e.last_7d);
    const avg = n(e.avg_prev_4w);
    if (avg > 0 && last > avg * 1.5 && last - avg >= 100) {
      out.push({
        title: `${e.category} spending up ${pct(last, avg)}%`,
        detail: `${formatMoney(last)} this week against a usual ${formatMoney(avg)} a week.`,
        action: e.category.toLowerCase().includes("fuel")
          ? "Check generator hours against fuel bought; long EDSA outages raise fuel use, but so can siphoning."
          : "Check the receipts for this category with whoever recorded them.",
        priority: last - avg > revenue * 0.05 ? "medium" : "low",
        category: "costs",
        score: 45,
      });
    }
  }

  // 6. Shrinkage (stock missing at counts)
  const shrink = n(m.shrinkage_7d);
  if (shrink > 0) {
    const where = (m.shrinkage_items ?? []).slice(0, 3).map((s) => `${s.name} at ${s.location} (${formatMoney(s.value)})`);
    out.push({
      title: `${formatMoney(shrink)} of stock went missing or was written off`,
      detail: `Unexplained losses in the last 7 days${revenue > 0 ? ` — ${((shrink / revenue) * 100).toFixed(1)}% of sales` : ""}.${where.length ? ` Mostly: ${where.join("; ")}.` : ""}`,
      action: "Do a surprise spot count of those items this week, check who had access, and compare with voids and deliveries in the audit trail.",
      priority: revenue > 0 && shrink / revenue > 0.02 ? "high" : "medium",
      category: "fraud",
      score: 85,
    });
  }

  // 7. Cash shortages by staff
  const short = (m.cash_variance_7d ?? []).filter((c) => n(c.variance) < 0);
  if (short.length) {
    out.push({
      title: "Cash-ups came up short",
      detail: short.map((c) => `${c.name}: ${formatMoney(-n(c.variance))} short`).join("; ") + " in the last 7 days.",
      action: "Talk to them the same day, recount together, and review their voided and discounted sales.",
      priority: "high",
      category: "cash",
      score: 88,
    });
  }

  // 8. Money owed by customers
  const recv = n(m.receivables);
  if (recv > 0 && (recv > revenue * 0.25 || recv > 1000)) {
    const top = (m.top_debtors ?? []).slice(0, 3).map((d) => `${d.name} (${formatMoney(d.balance)})`);
    out.push({
      title: `Customers owe you ${formatMoney(recv)}`,
      detail: top.length ? `Largest balances: ${top.join(", ")}.` : "",
      action: "Call or WhatsApp the top debtors this week and pause credit for anyone over their limit.",
      priority: recv > revenue ? "high" : "medium",
      category: "credit",
      score: 60,
    });
  }

  // 9. Expiry
  if (n(m.expiring_30d?.batches) > 0) {
    out.push({
      title: `${formatMoney(m.expiring_30d.value)} of stock expires within 30 days`,
      detail: `${m.expiring_30d.batches} batch(es) are close to or past expiry.`,
      action: "Move them to the front, offer a discount, or return them to the supplier before they expire.",
      priority: "medium",
      category: "stock",
      score: 58,
    });
  }

  // 10. Voids and discounts
  if (n(m.voids_7d) >= 5) {
    out.push({
      title: `${m.voids_7d} sales voided this week`,
      detail: "Frequent voids can hide sales that were paid for in cash.",
      action: "Open Sales → filter 'Voided' and check each reason with the customer copy.",
      priority: "medium",
      category: "fraud",
      score: 65,
    });
  }
  if (revenue > 0 && n(m.discounts_7d) > revenue * 0.05) {
    out.push({
      title: `Discounts are ${((n(m.discounts_7d) / revenue) * 100).toFixed(1)}% of sales`,
      detail: `${formatMoney(m.discounts_7d)} given away in discounts in 7 days.`,
      action: "Lower the staff discount limit in Settings if this is not deliberate.",
      priority: "medium",
      category: "fraud",
      score: 50,
    });
  }

  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ title, detail, action, priority, category }) => ({ title, detail, action, priority, category }));
}
