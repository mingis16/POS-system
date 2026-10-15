// Runs every migration against an in-memory Postgres (PGlite) with stand-ins
// for Supabase's auth schema and roles, then exercises the business rules,
// row level security and the anti-fraud controls.
//
//   npm run test:db

import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS = fileURLToPath(new URL("../migrations/", import.meta.url));
const db = new PGlite();

let failures = 0;
let passes = 0;
function check(label, cond, extra) {
  if (cond) {
    passes++;
    console.log("  ok   " + label);
  } else {
    failures++;
    console.log("  FAIL " + label + (extra !== undefined ? " -> " + JSON.stringify(extra) : ""));
  }
}
const num = (v) => (v === null || v === undefined ? v : Number(v));

// --- Supabase stand-ins -----------------------------------------------------
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create publication supabase_realtime;
`);

for (const file of fs.readdirSync(MIGRATIONS).sort()) {
  try {
    await db.exec(fs.readFileSync(path.join(MIGRATIONS, file), "utf8"));
    console.log("applied " + file);
  } catch (e) {
    console.log("MIGRATION FAILED " + file + ": " + e.message);
    process.exit(1);
  }
}

const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];
const HEADERS = JSON.stringify({ "x-client-ip": "41.223.1.9", "x-client-ua": "Test/1.0", "x-device-id": "dev-honor-x9" });

async function as(uid, fn) {
  await db.exec(`set role authenticated;
    select set_config('request.jwt.claim.sub', '${uid}', false);
    select set_config('request.headers', '${HEADERS}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);
      select set_config('request.headers', '', false);`);
  }
}
async function expectError(label, fn, pattern) {
  try {
    await fn();
    check(label + " (expected error)", false, "no error");
  } catch (e) {
    const ok = pattern ? pattern.test(e.message) : true;
    check(label + " — " + e.message.slice(0, 110), ok, e.message);
  }
}
const rpc = (fn, payload) => one(`select ${fn}($1::jsonb) as r`, [JSON.stringify(payload)]).then((r) => r.r);

const OWNER = "00000000-0000-0000-0000-00000000000a";
const CASHIER = "00000000-0000-0000-0000-00000000000b";
const STORE = "00000000-0000-0000-0000-00000000000c";
const OUTSIDER = "00000000-0000-0000-0000-00000000000d";
await q(`insert into auth.users (id, email, raw_user_meta_data) values
  ($1, 'aminata@shop.sl', '{"full_name":"Aminata Kamara"}'),
  ($2, 'mohamed@shop.sl', '{"full_name":"Mohamed Sesay"}'),
  ($3, 'fatmata@shop.sl', '{"full_name":"Fatmata Bangura"}'),
  ($4, 'other@x.sl', '{"full_name":"Other Person"}')`, [OWNER, CASHIER, STORE, OUTSIDER]);
check("profiles created from sign-up metadata",
  (await one(`select full_name from profiles where id = $1`, [OWNER])).full_name === "Aminata Kamara");

// ---------------------------------------------------------------------------
console.log("\n== onboarding");
const B = await as(OWNER, () => rpc("create_business", {
  name: "Aminata's Mini-Mart",
  business_type: "provision_shop",
  location_city: "Freetown",
  phone: "+23276000001",
  terminology: { item: "Product", items: "Products" },
  units: ["pieces", "cartons", "bags"],
  storage_modes: ["shelves", "freezers", "warehouse"],
  sales_input_by: "both",
  payment_methods: ["cash", "orange_money", "afrimoney", "credit"],
  locations: [
    { name: "Shop shelves", kind: "shelf", is_default_sale: true },
    { name: "Freezer", kind: "freezer" },
    { name: "Store room", kind: "store_room" },
  ],
  categories: ["Beverages", "Provisions"],
  expense_categories: ["Market dues"],
  opening_cash: 500,
  items: [
    { name: "Coca-Cola 35cl", category: "Beverages", unit: "bottles", cost_price: 8, selling_price: 12, reorder_level: 10, opening_qty: 48, barcode: "5449000000996" },
    { name: "Rice 50kg", category: "Provisions", unit: "bags", cost_price: 700, selling_price: 780, reorder_level: 2, opening_qty: 5 },
    { name: "Peak milk tin", category: "Provisions", unit: "pieces", cost_price: 10, selling_price: 15, opening_qty: 24 },
  ],
}));
check("business created", typeof B === "string" && B.length === 36, B);
const loc = Object.fromEntries((await q(`select name, id, is_default_sale from locations where business_id = $1`, [B])).map((l) => [l.name, l]));
check("locations from onboarding, shelves are the sales point", loc["Shop shelves"]?.is_default_sale && loc["Freezer"] && loc["Store room"]);
check("owner membership", (await one(`select role from memberships where business_id = $1 and user_id = $2`, [B, OWNER])).role === "owner");
check("chart of accounts seeded incl. archetype expense category",
  (await one(`select count(*)::int c from accounts where business_id = $1 and name = 'Market dues' and is_expense_category`, [B])).c === 1);
const P = Object.fromEntries((await q(`select name, id from products where business_id = $1`, [B])).map((p) => [p.name, p.id]));
const coke = P["Coca-Cola 35cl"], rice = P["Rice 50kg"], milk = P["Peak milk tin"];
check("opening stock on the shelves", num((await one(`select quantity from stock_levels where product_id = $1`, [coke])).quantity) === 48);
const opening = await one(`select sum(debit) d, sum(credit) c from journal_lines where business_id = $1`, [B]);
check("opening journal balances: stock 48*8+5*700+24*10 + cash 500", num(opening.d) === 384 + 3500 + 240 + 500 && num(opening.d) === num(opening.c), opening);
check("onboarding completed", (await one(`select onboarding_completed_at is not null as d from businesses where id = $1`, [B])).d);

// ---------------------------------------------------------------------------
console.log("\n== staff join & RLS");
const code = (await one(`select join_code from businesses where id = $1`, [B])).join_code;
await as(CASHIER, () => one(`select join_business($1, 'Mohamed', '+23277000002')`, [code.toLowerCase()]));
await as(STORE, () => one(`select join_business($1, 'Fatmata', null)`, [code]));
check("pending member sees the business name", (await as(CASHIER, () => q(`select name from businesses`))).length === 1);
check("pending member sees no products", (await as(CASHIER, () => q(`select * from products`))).length === 0);
check("join request raised an alert", (await one(`select count(*)::int c from alerts where business_id = $1 and kind = 'staff_join'`, [B])).c === 2);
await expectError("pending member cannot sell", () => as(CASHIER, () => rpc("record_sale", { business_id: B, items: [{ product_id: coke, qty: 1 }], payments: [{ method: "cash", amount: 12 }] })), /permission/);
await expectError("cashier cannot approve themselves", () => as(CASHIER, () => q(`select update_member($1, $2, 'admin', 'active')`, [B, CASHIER])), /permission/);
await as(OWNER, () => q(`select update_member($1, $2, 'cashier', 'active')`, [B, CASHIER]));
await as(OWNER, () => q(`select update_member($1, $2, 'storekeeper', 'active')`, [B, STORE]));
check("approval resolves the join alert", (await one(`select count(*)::int c from alerts where business_id = $1 and kind = 'staff_join' and status = 'open'`, [B])).c === 0);
check("cashier now sees products", (await as(CASHIER, () => q(`select * from products`))).length === 3);
check("outsider sees nothing", (await as(OUTSIDER, () => q(`select * from products`))).length === 0
  && (await as(OUTSIDER, () => q(`select * from businesses`))).length === 0);
check("cashier cannot change a price (RLS filters the row)",
  (await as(CASHIER, () => q(`update products set selling_price = 1 where id = $1 returning id`, [coke]))).length === 0);
await expectError("cashier cannot insert a sale directly", () => as(CASHIER, () => q(`insert into sales (business_id, receipt_no, location_id, subtotal, total) values ($1, 99, $2, 1, 1)`, [B, loc["Shop shelves"].id])), /permission denied/);
await expectError("cashier cannot post journal entries", () => as(CASHIER, () => q(`select post_journal($1, current_date, 'x', null, null, '[]')`, [B])), /permission denied/);
check("cashier cannot read the books", (await as(CASHIER, () => q(`select * from journal_lines`))).length === 0);
await expectError("owner cannot be demoted while the only owner", () => as(OWNER, () => q(`select update_member($1, $2, 'admin', 'active')`, [B, OWNER])), /at least one active owner/);

// ---------------------------------------------------------------------------
console.log("\n== sales");
const s1 = await as(CASHIER, () => rpc("record_sale", {
  business_id: B, client_ref: "11111111-1111-1111-1111-111111111111",
  items: [{ product_id: coke, qty: 10 }, { product_id: milk, qty: 2 }],
  payments: [{ method: "cash", amount: 100 }, { method: "orange_money", amount: 50, reference: "OM123" }],
}));
check("split cash + Orange Money sale", s1.receipt_no === 1 && num(s1.total) === 150, s1);
check("stock moved off the shelves", num((await one(`select quantity from stock_levels where product_id = $1`, [coke])).quantity) === 38);
const dup = await as(CASHIER, () => rpc("record_sale", {
  business_id: B, client_ref: "11111111-1111-1111-1111-111111111111",
  items: [{ product_id: coke, qty: 10 }], payments: [{ method: "cash", amount: 120 }],
}));
check("re-synced offline sale is stored once", dup.duplicate === true && dup.sale_id === s1.sale_id);
const sj = await one(`select sum(l.debit) d, sum(l.credit) c from journal_lines l join journal_entries e on e.id = l.entry_id where e.source_id = $1`, [s1.sale_id]);
check("sale journal balances (150 revenue + 100 COGS)", num(sj.d) === 250 && num(sj.c) === 250, sj);

await expectError("cashier cannot change the price", () => as(CASHIER, () => rpc("record_sale", { business_id: B, items: [{ product_id: coke, qty: 1, unit_price: 5 }], payments: [{ method: "cash", amount: 5 }] })), /Only an admin/);
await expectError("discount above the staff limit", () => as(CASHIER, () => rpc("record_sale", { business_id: B, discount: 50, items: [{ product_id: rice, qty: 1 }], payments: [{ method: "cash", amount: 730 }] })), /above 5 percent/);
await expectError("payments must match the total", () => as(CASHIER, () => rpc("record_sale", { business_id: B, items: [{ product_id: coke, qty: 1 }], payments: [{ method: "cash", amount: 10 }] })), /do not match/);
await expectError("cannot sell more than in stock", () => as(CASHIER, () => rpc("record_sale", { business_id: B, items: [{ product_id: rice, qty: 9 }], payments: [{ method: "cash", amount: 7020 }] })), /Not enough Rice 50kg/);
await expectError("QMoney is not switched on", () => as(CASHIER, () => rpc("record_sale", { business_id: B, items: [{ product_id: coke, qty: 1 }], payments: [{ method: "qmoney", amount: 12 }] })), /not switched on/);
await expectError("credit needs a customer", () => as(CASHIER, () => rpc("record_sale", { business_id: B, items: [{ product_id: coke, qty: 1 }], payments: [{ method: "credit", amount: 12 }] })), /customer/);

const cust = (await as(CASHIER, () => one(`insert into customers (business_id, name, phone) values ($1, 'Pa Alimamy', '+23278000003') returning id`, [B]))).id;
await expectError("cashier cannot grant credit limits", () => as(CASHIER, () => q(`insert into customers (business_id, name, credit_limit) values ($1, 'X', 1000)`, [B])), /row-level security/);
await as(CASHIER, () => rpc("record_sale", { business_id: B, customer_id: cust, items: [{ product_id: rice, qty: 1 }], payments: [{ method: "cash", amount: 280 }, { method: "credit", amount: 500 }] }));
check("credit sale adds to customer balance", num((await one(`select balance from customers where id = $1`, [cust])).balance) === 500);
const usd = await as(CASHIER, () => rpc("record_sale", { business_id: B, items: [{ product_id: milk, qty: 2 }], payments: [{ method: "cash", amount: 1, currency: "USD" }, { method: "cash", amount: 7 }] }));
check("US dollar payment converted at the business rate (1 USD = 23)", num(usd.total) === 30, usd);
const admPrice = await as(OWNER, () => rpc("record_sale", { business_id: B, items: [{ product_id: coke, qty: 1, unit_price: 10 }], payments: [{ method: "cash", amount: 10 }] }));
check("admin price override allowed and flagged", (await one(`select count(*)::int c from alerts where business_id = $1 and kind = 'price_override'`, [B])).c === 1, admPrice);

const lowBefore = await one(`select count(*)::int c from alerts where business_id = $1 and kind = 'low_stock' and status = 'open'`, [B]);
await as(CASHIER, () => rpc("record_sale", { business_id: B, items: [{ product_id: coke, qty: 30 }], payments: [{ method: "cash", amount: 360 }] }));
const low = await one(`select severity, message from alerts where business_id = $1 and kind = 'low_stock' and product_id = $2 and status = 'open'`, [B, coke]);
check("low-stock alert when Coca-Cola drops to 7 (re-order 10)", lowBefore.c === 0 && low?.severity === "warning", low);

console.log("\n== offline sale beyond book stock");
await as(CASHIER, () => rpc("record_sale", { business_id: B, offline: true, client_ref: "22222222-2222-2222-2222-222222222222", items: [{ product_id: coke, qty: 9 }], payments: [{ method: "cash", amount: 108 }] }));
check("offline sale recorded and flagged negative stock",
  num((await one(`select quantity from stock_levels where product_id = $1`, [coke])).quantity) === -2 &&
  (await one(`select count(*)::int c from alerts where business_id = $1 and kind = 'negative_stock'`, [B])).c === 1);
check("out-of-stock escalates the low-stock alert to critical",
  (await one(`select severity from alerts where business_id = $1 and dedupe_key = $2 and status = 'open'`, [B, "low_stock:" + coke])).severity === "critical");

// ---------------------------------------------------------------------------
console.log("\n== voids need approval");
await expectError("sales cannot be edited", () => as(OWNER, () => q(`update sales set total = 1 where id = $1`, [s1.sale_id])), /permission denied/);
await expectError("sales cannot be edited even by the database owner", () => q(`update sales set total = 1 where id = $1`, [s1.sale_id]), /cannot be edited/);
const vr = await as(CASHIER, () => one(`select request_sale_void($1, 'Customer returned bottles') r`, [s1.sale_id]));
check("cashier's void becomes a request", vr.r === "requested");
check("void request alert for the owner", (await one(`select count(*)::int c from alerts where business_id = $1 and kind = 'void_request' and status = 'open'`, [B])).c === 1);
check("stock untouched until approved", num((await one(`select quantity from stock_levels where product_id = $1`, [milk])).quantity) === 20);
await as(OWNER, () => q(`select review_sale_void($1, true, 'OK')`, [s1.sale_id]));
check("approved void puts stock back", num((await one(`select quantity from stock_levels where product_id = $1`, [milk])).quantity) === 22);
const vj = await one(`select sum(l.debit) - sum(l.credit) as net, count(distinct e.id)::int n from journal_lines l join journal_entries e on e.id = l.entry_id where e.source_id = $1`, [s1.sale_id]);
check("void reverses the journal", num(vj.net) === 0 && vj.n === 2, vj);

// ---------------------------------------------------------------------------
console.log("\n== stock receiving");
const r1 = await as(STORE, () => rpc("receive_stock", {
  business_id: B, supplier_name: "Kissy Road Wholesale", invoice_ref: "INV-77", location_id: loc["Store room"].id,
  amount_paid: 500, payment_method: "cash",
  items: [{ product_id: coke, qty: 48, unit_cost: 11 }, { product_id: rice, qty: 2, unit_cost: 700 }],
}));
check("receipt recorded", typeof r1 === "string");
const sup = await one(`select balance_due from suppliers where business_id = $1 and name = 'Kissy Road Wholesale'`, [B]);
check("unpaid balance owed to supplier (528 + 1400 - 500)", num(sup.balance_due) === 1428, sup);
const avgCost = await one(`select cost_price, (select sum(quantity) from stock_levels where product_id = $1) q from products where id = $1`, [coke]);
check("weighted average cost: (8 on hand × 8 + 48 × 11) / 56 = 10.57", num(avgCost.cost_price) === 10.57, avgCost);
check("cost spike alert (8 → 11 is +38%)", (await one(`select count(*)::int c from alerts where business_id = $1 and kind = 'cost_spike'`, [B])).c === 1);
check("low-stock alert resolves when restocked",
  (await one(`select count(*)::int c from alerts where business_id = $1 and dedupe_key = $2 and status <> 'resolved'`, [B, "low_stock:" + coke])).c === 0);
await as(STORE, () => rpc("transfer_stock", { business_id: B, product_id: coke, from_location_id: loc["Store room"].id, to_location_id: loc["Freezer"].id, qty: 24 }));
check("transfer store room → freezer", num((await one(`select quantity from stock_levels where product_id = $1 and location_id = $2`, [coke, loc["Freezer"].id])).quantity) === 24);
await expectError("cashier cannot transfer", () => as(CASHIER, () => rpc("transfer_stock", { business_id: B, product_id: coke, from_location_id: loc["Store room"].id, to_location_id: loc["Freezer"].id, qty: 1 })), /permission/);

// ---------------------------------------------------------------------------
console.log("\n== expenses");
const acc = (await one(`select id from accounts where business_id = $1 and name = 'Generator fuel'`, [B])).id;
await as(CASHIER, () => rpc("record_expense", { business_id: B, account_id: acc, amount: 600, method: "cash", note: "5 gallons diesel" }));
check("large staff expense alert (>= Le 500)", (await one(`select count(*)::int c from alerts where business_id = $1 and kind = 'large_expense'`, [B])).c === 1);
await expectError("staff cannot backdate beyond the limit", () => as(CASHIER, () => rpc("record_expense", { business_id: B, account_id: acc, amount: 10, expense_date: "2020-01-01" })), /last 1 day/);
await expectError("cannot record into a non-expense account", async () => {
  const cash = (await one(`select id from accounts where business_id = $1 and system_key = 'cash'`, [B])).id;
  return as(CASHIER, () => rpc("record_expense", { business_id: B, account_id: cash, amount: 10 }));
}, /expense category/);

// ---------------------------------------------------------------------------
console.log("\n== cash-up");
const preview = await as(CASHIER, () => one(`select cash_up_expected($1, 200) r`, [B]));
// Cash in: 280 (rice) + 7 SLE (+$1) + 360 + 108 = 755; out: 600 fuel. Voided sale (100) excluded.
check("expected cash = float + cash sales − cash expenses", num(preview.r.expected_cash) === 200 + 755 - 600 && num(preview.r.expected_usd) === 1, preview.r);
const cu = await as(CASHIER, () => rpc("submit_cash_up", { business_id: B, opening_float: 200, counted_cash: 300, counted_usd: 1 }));
check("cash shortage of Le 55 detected", num(cu.variance) === -55, cu);
check("critical cash shortage alert", (await one(`select severity from alerts where business_id = $1 and kind = 'cash_shortage'`, [B])).severity === "critical");

// ---------------------------------------------------------------------------
console.log("\n== blind stock count & reconciliation");
const cnt = (await as(STORE, () => one(`select start_stock_count($1, $2, 'Friday count') r`, [B, loc["Shop shelves"].id]))).r;
const lines = await as(STORE, () => q(`select product_id, expected_qty from stock_count_lines where count_id = $1`, [cnt]));
check("count sheet is blind before submission", lines.length === 3 && lines.every((l) => l.expected_qty === null));
// Book on shelves: milk 24-2-2+2 (void) = 22, rice 5-1 = 4, coke -2. Counted: milk 15 (7 missing), rice 4.
await as(STORE, () => q(`select save_stock_count($1, $2)`, [cnt, JSON.stringify([{ product_id: milk, counted_qty: 15 }, { product_id: rice, counted_qty: 4 }])]));
await expectError("another staff member cannot submit someone else's count", () => as(CASHIER, () => q(`select submit_stock_count($1)`, [cnt])), /permission|started this count/);
const sub = await as(STORE, () => one(`select submit_stock_count($1) r`, [cnt]));
check("shortage valued at cost (7 × Le 10)", num(sub.r.loss_value) === 70 && num(sub.r.gain_value) === 0, sub.r);
check("stock variance alert raised", (await one(`select count(*)::int c from alerts where business_id = $1 and kind = 'stock_variance'`, [B])).c === 1);
await expectError("submitted count lines are locked", () => as(STORE, () => q(`select save_stock_count($1, '[]')`, [cnt])), /already been submitted/);
const rec = await as(OWNER, () => one(`select reconciliation_report($1, current_date - 1, current_date, $2) r`, [B, loc["Shop shelves"].id]));
const milkRow = rec.r.rows.find((r) => r.product_id === milk);
check("reconciliation: beginning + purchased − sold vs counted", milkRow?.status === "short" && num(milkRow.variance) === -7 && num(milkRow.expected) === 22 && num(milkRow.counted) === 15, milkRow);
await as(OWNER, () => q(`select review_stock_count($1, true, 'Spoke to staff')`, [cnt]));
check("approved count corrects the shelf", num((await one(`select quantity from stock_levels where product_id = $1 and location_id = $2`, [milk, loc["Shop shelves"].id])).quantity) === 15);
const shrink = await as(OWNER, () => one(`select balance from account_balances($1) where system_key = 'shrinkage'`, [B]));
check("shrinkage posted to the books", num(shrink.balance) === 70, shrink);

// ---------------------------------------------------------------------------
console.log("\n== serial (IMEI) and batch (expiry) tracking");
await as(OWNER, () => one(`select create_products($1, $2)`, [B, JSON.stringify([
  { name: "Tecno Spark 20", unit: "pieces", track_mode: "serial", cost_price: 1500, selling_price: 1900, warranty_months: 6 },
  { name: "Paracetamol 500mg", unit: "packs", track_mode: "batch", cost_price: 3, selling_price: 5, requires_prescription: false },
  { name: "Amoxicillin 500mg", unit: "packs", track_mode: "batch", cost_price: 12, selling_price: 20, requires_prescription: true },
])]));
const P2 = Object.fromEntries((await q(`select name, id from products where business_id = $1`, [B])).map((p) => [p.name, p.id]));
await expectError("IMEIs required for serialised items", () => as(STORE, () => rpc("receive_stock", { business_id: B, items: [{ product_id: P2["Tecno Spark 20"], qty: 2, unit_cost: 1500 }] })), /serial number/);
await as(STORE, () => rpc("receive_stock", { business_id: B, location_id: loc["Shop shelves"].id, items: [
  { product_id: P2["Tecno Spark 20"], qty: 2, unit_cost: 1500, serials: ["356938035643809", "356938035643817"] },
  { product_id: P2["Paracetamol 500mg"], qty: 10, unit_cost: 3, batch_no: "B-OLD", expiry_date: "2026-10-20" },
  { product_id: P2["Paracetamol 500mg"], qty: 10, unit_cost: 3, batch_no: "B-NEW", expiry_date: "2027-06-01" },
  { product_id: P2["Amoxicillin 500mg"], qty: 5, unit_cost: 12, batch_no: "AX1", expiry_date: "2027-01-01" },
] }));
await expectError("duplicate IMEI rejected", () => as(STORE, () => rpc("receive_stock", { business_id: B, items: [{ product_id: P2["Tecno Spark 20"], qty: 1, unit_cost: 1500, serials: ["356938035643809"] }] })), /already recorded/);
const imei = (await one(`select id from serial_units where serial = '356938035643809'`)).id;
await as(CASHIER, () => rpc("record_sale", { business_id: B, items: [{ product_id: P2["Tecno Spark 20"], qty: 1, serial_ids: [imei] }], payments: [{ method: "afrimoney", amount: 1900 }] }));
const sold = await one(`select status, warranty_until from serial_units where id = $1`, [imei]);
check("IMEI marked sold with 6-month warranty", sold.status === "sold" && sold.warranty_until !== null, sold);
await as(CASHIER, () => rpc("record_sale", { business_id: B, items: [{ product_id: P2["Paracetamol 500mg"], qty: 12 }], payments: [{ method: "cash", amount: 60 }] }));
const bt = Object.fromEntries((await q(`select batch_no, quantity from stock_batches where product_id = $1`, [P2["Paracetamol 500mg"]])).map((r) => [r.batch_no, num(r.quantity)]));
check("first-expiry-first-out on batches", bt["B-OLD"] === 0 && bt["B-NEW"] === 8, bt);
await expectError("prescription medicine needs a prescription reference", () => as(CASHIER, () => rpc("record_sale", { business_id: B, items: [{ product_id: P2["Amoxicillin 500mg"], qty: 1 }], payments: [{ method: "cash", amount: 20 }] })), /prescription/);
await as(CASHIER, () => rpc("record_sale", { business_id: B, prescription_ref: "RX-CONNAUGHT-1", items: [{ product_id: P2["Amoxicillin 500mg"], qty: 1 }], payments: [{ method: "cash", amount: 20 }] }));
const exp = await as(OWNER, () => one(`select scan_expiries($1) n`, [B]));
check("expiry scan runs", exp.n >= 0);

// ---------------------------------------------------------------------------
console.log("\n== production (water factory style)");
await as(OWNER, () => one(`select create_products($1, $2)`, [B, JSON.stringify([
  { name: "Sachet roll", kind: "raw_material", unit: "kg", cost_price: 40, opening_qty: 10, allow_fractional: true },
  { name: "Pure water bag (30)", unit: "bags", cost_price: 0, selling_price: 10 },
])]));
const P3 = Object.fromEntries((await q(`select name, id from products where business_id = $1`, [B])).map((p) => [p.name, p.id]));
await as(STORE, () => rpc("record_production", { business_id: B, product_id: P3["Pure water bag (30)"], qty: 100, inputs: [{ product_id: P3["Sachet roll"], qty: 2.5 }] }));
const water = await one(`select cost_price from products where id = $1`, [P3["Pure water bag (30)"]]);
check("finished goods costed from materials (2.5kg × 40 / 100 bags = 1.00)", num(water.cost_price) === 1, water);

// ---------------------------------------------------------------------------
console.log("\n== jobs");
const job = await as(CASHIER, () => one(`insert into jobs (business_id, kind, title, customer_name, item_ref, quoted_amount) values ($1, 'repair', 'Cracked screen', 'Ibrahim', '356938035643817', 450) returning id, job_no`, [B]));
check("job numbered", Number(job.job_no) === 1);
await as(CASHIER, () => rpc("record_job_payment", { job_id: job.id, amount: 200, method: "cash" }));
check("job payment recorded through the RPC only",
  num((await one(`select amount_paid from jobs where id = $1`, [job.id])).amount_paid) === 200 &&
  (await as(CASHIER, () => q(`update jobs set status = 'in_progress' where id = $1 returning amount_paid`, [job.id])))[0].amount_paid == 200);

// ---------------------------------------------------------------------------
console.log("\n== books & reports");
const tb = await one(`select sum(debit) d, sum(credit) c from journal_lines where business_id = $1`, [B]);
check("trial balance: debits = credits", num(tb.d) === num(tb.c), tb);
const inv = await as(OWNER, () => one(`select balance from account_balances($1) where system_key = 'inventory'`, [B]));
const stockValue = await one(`select coalesce(sum(m.qty * m.unit_cost), 0) v from stock_movements m where m.business_id = $1`, [B]);
check("inventory account equals the stock ledger at cost", Math.abs(num(inv.balance) - num(stockValue.v)) < 0.05, { ledger: inv.balance, stock: stockValue.v });
const pl = await as(OWNER, () => one(`select profit_and_loss($1, current_date - 7, current_date) r`, [B]));
check("P&L has revenue, COGS, expenses, shrinkage", num(pl.r.revenue) > 0 && num(pl.r.cogs) > 0 && num(pl.r.operating_expenses) === 600 && num(pl.r.shrinkage) === 70, pl.r);
await expectError("cashier cannot run the P&L", () => as(CASHIER, () => one(`select profit_and_loss($1, current_date - 7, current_date)`, [B])), /permission/);
const dashA = await as(OWNER, () => one(`select dashboard_summary($1) r`, [B]));
check("admin dashboard", dashA.r.role === "owner" && dashA.r.series.length === 14 && num(dashA.r.today.revenue) > 0, Object.keys(dashA.r));
const dashS = await as(CASHIER, () => one(`select dashboard_summary($1) r`, [B]));
check("staff dashboard shows only their own figures", dashS.r.role === "cashier" && dashS.r.today === undefined && dashS.r.my_sales_today.count > 0);
const cf = await as(OWNER, () => one(`select cash_flow($1, current_date, current_date) r`, [B]));
check("cash flow by account", cf.r.accounts.length === 5, cf.r.accounts);
const wr = await as(OWNER, () => one(`select generate_weekly_report($1, current_date) id`, [B]));
const report = await one(`select data from weekly_reports where id = $1`, [wr.id]);
check("weekly report generated", report.data.top_items.length > 0 && report.data.pl.revenue !== undefined, Object.keys(report.data));
const adv = await as(OWNER, () => one(`select advisor_metrics($1) r`, [B]));
check("advisor metrics", adv.r.items.length > 0 && adv.r.items[0].sold_7d !== undefined);

// ---------------------------------------------------------------------------
console.log("\n== audit trail");
const audit = await one(`select count(*)::int c, count(*) filter (where ip = '41.223.1.9' and device_id = 'dev-honor-x9')::int tagged from audit_log where business_id = $1`, [B]);
check("transactions audited with IP and device", audit.c > 20 && audit.tagged > 20, audit);
check("staff cannot read the audit log", (await as(CASHIER, () => q(`select * from audit_log`))).length === 0);
const chain = await as(OWNER, () => one(`select * from verify_audit_chain($1)`, [B]));
check("hash chain verifies", chain.ok === true, chain);
await expectError("audit rows cannot be edited", () => q(`update audit_log set summary = 'x' where id = 1`), /cannot be changed/);
await db.exec(`alter table audit_log disable trigger audit_log_immutable`);
await q(`update audit_log set after = '{"total": 1}' where id = (select min(id) + 3 from audit_log where business_id = $1)`, [B]);
await db.exec(`alter table audit_log enable trigger audit_log_immutable`);
const broken = await as(OWNER, () => one(`select * from verify_audit_chain($1)`, [B]));
check("tampering detected by the hash chain", broken.ok === false && broken.first_bad_id !== null, broken);

console.log("\n== notifications");
await as(OWNER, () => q(`update businesses set notify = '{"phone":"+23276000001","channel":"whatsapp"}' where id = $1`, [B]));
await as(CASHIER, () => rpc("submit_cash_up", { business_id: B, counted_cash: 0 }));
const nq = await one(`select count(*)::int c from notifications where business_id = $1 and channel = 'whatsapp' and status = 'pending'`, [B]);
check("critical alerts queue a WhatsApp message", nq.c >= 1, nq);
check("anon sees nothing", (await (async () => { await db.exec(`set role anon`); try { return await q(`select * from products`); } catch { return []; } finally { await db.exec(`reset role`); } })()).length === 0);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
