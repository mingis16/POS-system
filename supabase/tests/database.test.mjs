// Runs every migration against an in-memory Postgres (PGlite) with stand-ins
// for Supabase's auth schema and roles, then exercises the business rules,
// row level security and the anti-fraud controls.
//
//   npm run test:db

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS = fileURLToPath(new URL("../migrations/", import.meta.url));
// Supabase ships pgcrypto (manager PINs are bcrypt hashes); PGlite loads it as an extension.
const db = new PGlite({ extensions: { pgcrypto } });

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

// ---------------------------------------------------------------------------
console.log("\n== returns, exchanges & store credit");
await as(OWNER, () => one(`select create_products($1, $2)`, [B, JSON.stringify([
  { name: "Shirt M", unit: "pieces", cost_price: 40, selling_price: 100, opening_qty: 10 },
  { name: "Shirt L", unit: "pieces", cost_price: 45, selling_price: 120, opening_qty: 10 },
  { name: "Torch", unit: "pieces", cost_price: 20, selling_price: 35, opening_qty: 20 },
  { name: "Itel A70", unit: "pieces", track_mode: "serial", cost_price: 900, selling_price: 1200, opening_qty: 2, serials: ["IT-0001", "IT-0002"] },
  { name: "ORS sachet", unit: "sachets", track_mode: "batch", cost_price: 1, selling_price: 2, opening_qty: 30, batch_no: "ORS-1", expiry_date: "2027-05-01" },
])]));
const P4 = Object.fromEntries((await q(`select name, id from products where business_id = $1`, [B])).map((p) => [p.name, p.id]));
const shirtM = P4["Shirt M"], shirtL = P4["Shirt L"], torch = P4["Torch"], itel = P4["Itel A70"], ors = P4["ORS sachet"];
const stockOf = async (pid) => num((await one(`select coalesce(sum(quantity), 0) q from stock_levels where product_id = $1`, [pid])).q);
const itemOf = async (saleId, pid) => (await one(`select id from sale_items where sale_id = $1 and product_id = $2`, [saleId, pid])).id;
const ret = (uid, payload) => as(uid, () => rpc("process_return", payload));
let refN = 0;
const cref = () => `33333333-3333-3333-3333-${String(++refN).padStart(12, "0")}`;
const till = async () => (await as(CASHIER, () => one(`select cash_up_expected($1, 0) r`, [B]))).r;

await expectError("cashier cannot set a manager PIN", () => as(CASHIER, () => q(`select set_manager_pin($1, '4826')`, [B])), /permission/);
await expectError("easy PINs are refused", () => as(OWNER, () => q(`select set_manager_pin($1, '1234')`, [B])), /too easy/);
await expectError("PIN must be 4 digits", () => as(OWNER, () => q(`select set_manager_pin($1, '12a4')`, [B])), /4 digits/);
await as(OWNER, () => q(`select set_manager_pin($1, '4826')`, [B]));
check("PIN stored as a bcrypt hash", (await one(`select pin_hash from manager_pins where business_id = $1 and user_id = $2`, [B, OWNER])).pin_hash.startsWith("$2a$"));
await expectError("nobody can read PIN hashes through the API", () => as(OWNER, () => q(`select * from manager_pins`)), /permission denied/);
const pinStatus = (await as(CASHIER, () => one(`select manager_pin_status($1) r`, [B]))).r;
check("staff see which managers can approve", pinStatus.managers.some((m) => m.user_id === OWNER && m.has_pin) && pinStatus.my_pin_set_at === null, pinStatus);

// Cashier sells 3 shirts + 2 torches (370) with Le 10 off the sale.
const rs1 = await as(CASHIER, () => rpc("record_sale", { business_id: B, discount: 10, items: [{ product_id: shirtM, qty: 3 }, { product_id: torch, qty: 2 }], payments: [{ method: "cash", amount: 360 }] }));
const rs1Shirt = await itemOf(rs1.sale_id, shirtM), rs1Torch = await itemOf(rs1.sale_id, torch);
check("till expects the sale's cash", num((await till()).expected_cash) === 360);
const info = (await as(CASHIER, () => one(`select sale_return_info($1) r`, [rs1.sale_id]))).r;
check("return info lists what can come back", info.items.length === 2 && num(info.sale.net_lines) === 370 && info.managers.length === 1, info);
await expectError("staff cannot open returns on someone else's sale", () => as(STORE, () => one(`select sale_return_info($1)`, [rs1.sale_id])), /sales you recorded/);

const refund = { sale_id: rs1.sale_id, return_type: "refund", reason_code: "changed_mind", reason: "Customer changed mind", refund_method: "cash", manager_id: OWNER };
const wrong = await ret(CASHIER, { ...refund, client_ref: cref(), pin: "0000", items: [{ sale_item_id: rs1Shirt, qty: 1, restock: true }] });
check("wrong PIN is refused and nothing changes", wrong.ok === false && wrong.error === "wrong_pin" && (await stockOf(shirtM)) === 7, wrong);
check("wrong PIN attempt is logged", (await one(`select count(*)::int c from pin_failures where business_id = $1`, [B])).c === 1);
await expectError("storekeeper cannot return the cashier's sale", () => ret(STORE, { ...refund, client_ref: cref(), pin: "4826", items: [{ sale_item_id: rs1Shirt, qty: 1, restock: true }] }), /sales you recorded/);

const ref1 = cref();
const rt1 = await ret(CASHIER, { ...refund, client_ref: ref1, pin: "4826", items: [{ sale_item_id: rs1Shirt, qty: 1, restock: true }] });
// One of three shirts: 300 of the 370 in lines, less its share of the Le 10 → 300 × 360 / 370 / 3 = 97.30
check("partial refund is worth what was paid after discounts", rt1.ok && num(rt1.total) === 97.3 && num(rt1.refund_paid) === 97.3 && rt1.refund_method === "cash", rt1);
check("sellable goods go back on the shelf", (await stockOf(shirtM)) === 8);
const rj = await one(`select sum(l.debit) d, sum(l.credit) c from journal_lines l join journal_entries e on e.id = l.entry_id where e.source_table = 'returns' and e.source_id = $1`, [rt1.return_id]);
check("return journal balances (97.30 refund + 40 stock back)", num(rj.d) === 137.3 && num(rj.c) === 137.3, rj);
check("cash refund comes out of the cashier's till", Math.abs(num((await till()).expected_cash) - (360 - 97.3)) < 0.001);
check("the original sale is untouched", (await one(`select status, total from sales where id = $1`, [rs1.sale_id])).status === "completed");
const dupRet = await ret(CASHIER, { ...refund, client_ref: ref1, pin: "4826", items: [{ sale_item_id: rs1Shirt, qty: 1, restock: true }] });
check("a return sent twice is stored once", dupRet.duplicate === true && dupRet.return_id === rt1.return_id && (await stockOf(shirtM)) === 8, dupRet);
await expectError("cannot return more than was sold", () => ret(CASHIER, { ...refund, client_ref: cref(), pin: "4826", items: [{ sale_item_id: rs1Shirt, qty: 3, restock: true }] }), /Only 2 of Shirt M/);

const rt2 = await ret(CASHIER, { sale_id: rs1.sale_id, client_ref: cref(), return_type: "damaged", reason_code: "defective", reason: "Defective / damaged: does not switch on", refund_method: "cash", manager_id: OWNER, pin: "4826", items: [{ sale_item_id: rs1Torch, qty: 1, restock: true }] });
// One of two torches: 70 × 360 / 370 / 2 = 34.05. Damaged goods are written off even if restock was asked for.
check("damaged return refunds and writes the goods off", rt2.ok && num(rt2.total) === 34.05 && num(rt2.qty_written_off) === 1 && (await stockOf(torch)) === 18, rt2);
const mv = await q(`select reason, qty from stock_movements where ref_table = 'returns' and ref_id = $1 order by id`, [rt2.return_id]);
check("damaged goods pass through the stock ledger", mv.length === 2 && mv[0].reason === "return_in" && mv[1].reason === "damage", mv);

const rt3 = await ret(CASHIER, { ...refund, client_ref: cref(), pin: "4826", items: [{ sale_item_id: rs1Shirt, qty: 2, restock: true }, { sale_item_id: rs1Torch, qty: 1, restock: true }] });
check("the last return settles the sale to the cent (360 − 97.30 − 34.05)", rt3.ok && num(rt3.total) === 228.65, rt3);
check("refunds add up to exactly what was paid", num((await one(`select sum(total_refund_amount) t from returns where original_sale_id = $1`, [rs1.sale_id])).t) === 360);
check("item refunds add up to the return", num((await one(`select sum(refund_amount) t from return_items where return_id = $1`, [rt3.return_id])).t) === 228.65);
await expectError("nothing left to return", () => ret(CASHIER, { ...refund, client_ref: cref(), pin: "4826", items: [{ sale_item_id: rs1Torch, qty: 1, restock: true }] }), /Only 0 of Torch/);
await expectError("a sale with returns cannot be voided", () => as(OWNER, () => one(`select request_sale_void($1, 'test')`, [rs1.sale_id])), /already been returned/);
await expectError("returns cannot be edited", () => q(`update returns set total_refund_amount = 1 where id = $1`, [rt1.return_id]), /cannot be changed/);
await expectError("returns cannot be written directly", () => as(CASHIER, () => q(`insert into returns (business_id, return_no, original_sale_id, location_id, return_type, reason_code, reason, total_refund_amount, approved_by) values ($1, 99, $2, $3, 'refund', 'other', 'xxx', 1, $4)`, [B, rs1.sale_id, loc["Shop shelves"].id, OWNER])), /permission denied/);

console.log("\n== exchanges, store credit, credit sales");
const isata = (await as(CASHIER, () => one(`insert into customers (business_id, name, phone) values ($1, 'Isata Conteh', '+23279000004') returning id`, [B]))).id;
const isataNow = async () => one(`select balance, store_credit from customers where id = $1`, [isata]);
const rs2 = await as(CASHIER, () => rpc("record_sale", { business_id: B, customer_id: isata, items: [{ product_id: shirtM, qty: 1 }], payments: [{ method: "cash", amount: 100 }] }));
const ex = await ret(CASHIER, { sale_id: rs2.sale_id, client_ref: cref(), return_type: "exchange", reason_code: "wrong_item", reason: "Wrong item / size", manager_id: OWNER, pin: "4826",
  items: [{ sale_item_id: await itemOf(rs2.sale_id, shirtM), qty: 1, restock: true }],
  exchange: { items: [{ product_id: shirtL, qty: 1 }], payments: [{ method: "cash", amount: 20 }] } });
check("exchange: size M back, size L out, customer adds Le 20", ex.ok && num(ex.exchange_amount) === 100 && num(ex.exchange_total) === 120 && num(ex.refund_paid) === 0 && ex.refund_method === null, ex);
const exPays = await q(`select method, amount_base from sale_payments where sale_id = $1`, [ex.exchange_sale_id]);
check("exchange sale is paid with the returned goods plus cash", exPays.length === 2 && exPays.some((p) => p.method === "store_credit" && num(p.amount_base) === 100), exPays);
check("exchange moves both items", (await stockOf(shirtM)) === 10 && (await stockOf(shirtL)) === 9);
check("an even exchange leaves no store credit owing", num((await as(OWNER, () => one(`select balance from account_balances($1) where system_key = 'store_credit'`, [B]))).balance) === 0);
await expectError("the exchange sale cannot be voided", () => as(OWNER, () => one(`select request_sale_void($1, 'test')`, [ex.exchange_sale_id])), /exchange for return/);
const rs3 = await as(CASHIER, () => rpc("record_sale", { business_id: B, customer_id: isata, items: [{ product_id: torch, qty: 2 }], payments: [{ method: "cash", amount: 70 }] }));
await expectError("an exchange needs replacement items", async () => ret(CASHIER, { sale_id: rs3.sale_id, client_ref: cref(), return_type: "exchange", reason_code: "wrong_item", reason: "Wrong item", manager_id: OWNER, pin: "4826", items: [{ sale_item_id: await itemOf(rs3.sale_id, torch), qty: 1, restock: true }] }), /taking in exchange/);
// Torches: 20 − 2 sold + 1 damaged in/out + 1 back − 2 sold = 17
check("a refused exchange leaves the stock alone", (await stockOf(torch)) === 17);
const toCredit = await ret(CASHIER, { sale_id: rs3.sale_id, client_ref: cref(), return_type: "refund", reason_code: "changed_mind", reason: "Changed mind", refund_method: "store_credit", manager_id: OWNER, pin: "4826", items: [{ sale_item_id: await itemOf(rs3.sale_id, torch), qty: 2, restock: true }] });
check("refund kept as store credit", toCredit.ok && num((await isataNow()).store_credit) === 70, toCredit);
await expectError("store credit cannot be overspent", () => as(CASHIER, () => rpc("record_sale", { business_id: B, customer_id: isata, items: [{ product_id: shirtL, qty: 1 }], payments: [{ method: "store_credit", amount: 120 }] })), /only Le 70.00 of store credit/);
await expectError("walk-ins have no store credit to spend", () => as(CASHIER, () => rpc("record_sale", { business_id: B, items: [{ product_id: torch, qty: 2 }], payments: [{ method: "store_credit", amount: 70 }] })), /customer whose store credit/);
await as(CASHIER, () => rpc("record_sale", { business_id: B, customer_id: isata, items: [{ product_id: shirtL, qty: 1 }], payments: [{ method: "store_credit", amount: 70 }, { method: "cash", amount: 50 }] }));
check("store credit spent at the till", num((await isataNow()).store_credit) === 0);

const rs4 = await as(CASHIER, () => rpc("record_sale", { business_id: B, items: [{ product_id: torch, qty: 1 }], payments: [{ method: "cash", amount: 35 }] }));
const rs4Torch = await itemOf(rs4.sale_id, torch);
const walkIn = { sale_id: rs4.sale_id, return_type: "refund", reason_code: "changed_mind", reason: "Changed mind", manager_id: OWNER, pin: "4826", items: [{ sale_item_id: rs4Torch, qty: 1, restock: true }] };
await expectError("store credit needs a named customer", () => ret(CASHIER, { ...walkIn, client_ref: cref(), refund_method: "store_credit" }), /named customer/);
await expectError("refunds need a way to pay back", () => ret(CASHIER, { ...walkIn, client_ref: cref() }), /Choose how the customer gets/);
await expectError("QMoney refunds need QMoney switched on", () => ret(CASHIER, { ...walkIn, client_ref: cref(), refund_method: "mobile_money", momo_provider: "qmoney" }), /not switched on/);
const momo = await ret(CASHIER, { ...walkIn, client_ref: cref(), refund_method: "mobile_money", momo_provider: "orange_money" });
check("Orange Money refund", momo.ok && momo.momo_provider === "orange_money" && num(momo.refund_paid) === 35, momo);
check("mobile money refund shows against the cashier's Orange Money", num((await till()).momo_expected.orange_money) === -35, (await till()).momo_expected);

const rs5 = await as(CASHIER, () => rpc("record_sale", { business_id: B, customer_id: isata, items: [{ product_id: torch, qty: 2 }], payments: [{ method: "credit", amount: 70 }] }));
check("credit sale owed", num((await isataNow()).balance) === 70);
const cr = await ret(CASHIER, { sale_id: rs5.sale_id, client_ref: cref(), return_type: "refund", reason_code: "changed_mind", reason: "Changed mind", refund_method: "cash", manager_id: OWNER, pin: "4826", items: [{ sale_item_id: await itemOf(rs5.sale_id, torch), qty: 1, restock: true }] });
check("goods bought on credit come off the debt, not out of the till", cr.ok && num(cr.applied_to_balance) === 35 && num(cr.refund_paid) === 0 && cr.refund_method === null && num((await isataNow()).balance) === 35, cr);

console.log("\n== returns of serial and batch items");
const unit1 = (await one(`select id from serial_units where serial = 'IT-0001'`)).id;
const rs6 = await as(CASHIER, () => rpc("record_sale", { business_id: B, items: [{ product_id: itel, qty: 1, serial_ids: [unit1] }], payments: [{ method: "cash", amount: 1200 }] }));
const rs6Item = await itemOf(rs6.sale_id, itel);
const phone = { sale_id: rs6.sale_id, return_type: "refund", reason_code: "changed_mind", reason: "Changed mind", refund_method: "cash", manager_id: OWNER, pin: "4826" };
await expectError("a serialised return names the IMEI", () => ret(CASHIER, { ...phone, client_ref: cref(), items: [{ sale_item_id: rs6Item, qty: 1, restock: true }] }), /serial number/);
const sr = await ret(CASHIER, { ...phone, client_ref: cref(), items: [{ sale_item_id: rs6Item, qty: 1, restock: true, serial_ids: [unit1] }] });
const unit = await one(`select status, sale_id, warranty_until from serial_units where id = $1`, [unit1]);
check("returned phone is back in stock by IMEI", sr.ok && unit.status === "in_stock" && unit.sale_id === null && unit.warranty_until === null, unit);
const rs7 = await as(CASHIER, () => rpc("record_sale", { business_id: B, items: [{ product_id: ors, qty: 5 }], payments: [{ method: "cash", amount: 10 }] }));
await ret(CASHIER, { sale_id: rs7.sale_id, client_ref: cref(), return_type: "refund", reason_code: "changed_mind", reason: "Changed mind", refund_method: "cash", manager_id: OWNER, pin: "4826", items: [{ sale_item_id: await itemOf(rs7.sale_id, ors), qty: 2, restock: true }] });
check("restocked batch goods go back into their batch", num((await one(`select quantity from stock_batches where product_id = $1`, [ors])).quantity) === 27);
check("many returns by one person raise an alert", (await one(`select count(*)::int c from alerts where business_id = $1 and kind = 'return_pattern'`, [B])).c === 1);

console.log("\n== manager PIN lock-out");
const rs8 = await as(CASHIER, () => rpc("record_sale", { business_id: B, items: [{ product_id: torch, qty: 1 }], payments: [{ method: "cash", amount: 35 }] }));
const guess = { sale_id: rs8.sale_id, return_type: "refund", reason_code: "changed_mind", reason: "Changed mind", refund_method: "cash", manager_id: OWNER, items: [{ sale_item_id: await itemOf(rs8.sale_id, torch), qty: 1, restock: true }] };
while ((await one(`select count(*)::int c from pin_failures where business_id = $1`, [B])).c < 5) {
  await ret(CASHIER, { ...guess, client_ref: cref(), pin: "9999" });
}
check("repeated wrong PINs raise a critical alert", (await one(`select severity from alerts where business_id = $1 and kind = 'pin_failures'`, [B]))?.severity === "critical");
await expectError("five wrong PINs lock the PIN, even the right one", () => ret(CASHIER, { ...guess, client_ref: cref(), pin: "4826" }), /Too many wrong PINs/);
await as(OWNER, () => q(`select set_manager_pin($1, '5937')`, [B]));
check("a new PIN unlocks returns", (await ret(CASHIER, { ...guess, client_ref: cref(), pin: "5937" })).ok === true);

console.log("\n== books after returns");
check("staff see the returns they took; others see none",
  (await as(CASHIER, () => q(`select id from returns`))).length >= 10 && (await as(STORE, () => q(`select id from returns`))).length === 0);
const tb2 = await one(`select sum(debit) d, sum(credit) c from journal_lines where business_id = $1`, [B]);
check("trial balance still balances", num(tb2.d) === num(tb2.c), tb2);
const inv2 = await as(OWNER, () => one(`select balance from account_balances($1) where system_key = 'inventory'`, [B]));
const stock2 = await one(`select coalesce(sum(m.qty * m.unit_cost), 0) v from stock_movements m where m.business_id = $1`, [B]);
check("inventory account still equals the stock ledger at cost", Math.abs(num(inv2.balance) - num(stock2.v)) < 0.05, { ledger: inv2.balance, stock: stock2.v });
const scAcc = await as(OWNER, () => one(`select balance from account_balances($1) where system_key = 'store_credit'`, [B]));
const scCust = await one(`select coalesce(sum(store_credit), 0) v from customers where business_id = $1`, [B]);
check("store credit account equals what customers hold", num(scAcc.balance) === num(scCust.v), { account: scAcc.balance, customers: scCust.v });
const pl2 = (await as(OWNER, () => one(`select profit_and_loss($1, current_date - 7, current_date) r`, [B]))).r;
check("P&L shows sales returns against revenue", pl2.revenue_lines.some((l) => l.name === "Sales returns" && num(l.amount) < 0), pl2.revenue_lines);
const dash2 = (await as(OWNER, () => one(`select dashboard_summary($1) r`, [B]))).r;
check("dashboard shows today's sales net of returns", dash2.today.returns.count >= 10 && num(dash2.today.returns.total) > 0, dash2.today);
const B2 = await as(OUTSIDER, () => rpc("create_business", { name: "Kroo Bay Boutique", business_type: "boutique", location_city: "Freetown" }));
check("new businesses get the store credit and sales returns accounts",
  (await one(`select count(*)::int c from accounts where business_id = $1 and system_key in ('store_credit', 'sales_returns')`, [B2])).c === 2);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
