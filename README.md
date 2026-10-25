# SaloneLedger

Point of sale, inventory, bookkeeping and anti-fraud controls for businesses in Sierra Leone. One app adapts to 13 business types (provision shops, supermarkets, restaurants/bars, boutiques, phone shops, electronics, hardware, water factories, salons, pharmacies, furniture, auto, solar) plus any custom business. It works on phones (e.g. Honor X9), tablets and laptops, and keeps selling when the network drops.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Framer Motion · Lucide · React Hook Form + Zod · Supabase (Postgres, Auth, RLS) · Claude API (optional AI advisor).

---

## What it does

| Area | Where |
|---|---|
| **Onboarding wizard** — business details, type (13 archetypes or custom with own units/words/features), storage, who sells, payment methods, starting stock by tick-list, CSV or manual entry, opening cash. Staff join with a code instead. | `src/app/onboarding`, `src/components/onboarding/wizard.tsx`, `create_business()` |
| **POS** — search, barcode scanner or phone camera, IMEI/serial picker, wholesale price, admin price override, line and sale discounts (staff capped), split payments: cash, Orange Money, Afrimoney, QMoney, bank, credit, and US dollars at the business rate; receipts (print / WhatsApp); table service; prescriptions. | `src/app/(app)/pos`, `src/components/pos`, `record_sale()` |
| **Returns & exchanges** — a *Return / Exchange* button on every sale: pick the items and quantities (or IMEIs) coming back, the reason, whether each goes back on the shelf or is written off as damaged, and how the customer is paid back — cash, mobile money, store credit, or an exchange for other items with any difference paid or refunded. A manager's 4-digit PIN confirms every return. The original sale is never edited: each return is its own record with its own journal entry (sales returns, stock back at cost, damaged goods to stock losses, credit-sale debts reduced first). Store credit can be spent at the till. | `src/components/sales/return-dialog.tsx`, `process_return()` |
| **Offline** — catalogue cached on the device; sales queued locally with an idempotency key and synced automatically; service worker keeps the app opening. | `src/lib/offline/queue.ts`, `public/sw.js` |
| **Stock** — per-location levels (shelves, freezer, cold store, warehouse, vehicle), receiving with weighted-average cost, batches with expiry (FEFO), serial units with warranty, transfers, usage, production runs, corrections, CSV import, low-stock and expiry alerts. | `src/app/(app)/inventory`, `receiving`, `production`, `counts` |
| **Reconciliation** — beginning + purchased − sold ± other = expected, vs blind physical counts per location; cash-ups per cashier vs recorded takings. | `src/app/(app)/reconciliation`, `reconciliation_report()` |
| **Anti-fraud** — staff cannot edit or delete sales/expenses (database-enforced); voids need owner approval; returns need a manager PIN (bcrypt-hashed, locked after 5 wrong tries); price overrides, large discounts, after-hours sales, repeated voids, cost spikes on deliveries, large staff expenses, offline negative stock, count shortages and cash shortages raise alerts; hash-chained audit log with IP, user agent and device id. | `20261014000300_controls.sql`, `src/app/(app)/alerts`, `audit` |
| **Bookkeeping** — double-entry general ledger posted by every transaction; P&L, balance sheet, trial balance, cash flow by account and source, receivables and payables, owner capital/drawings. | `20261014000200_ledger.sql`, `src/app/(app)/accounting` |
| **Weekly report + advisor** — revenue vs expenses, net margin, top sellers, dead stock, shrinkage and cash warnings, staff and commissions; rules engine plus optional Claude-written advice ("re-order 50 cases before Thursday"). Generated every Monday by cron. | `src/app/(app)/reports`, `src/lib/advisor` |
| **Jobs** — repairs, bookings, installations, custom orders, service records, delivery dispatches, with payments. | `src/app/(app)/jobs` |

## Roles

| Role | Can |
|---|---|
| Owner | Everything, incl. admins, owner capital/drawings, joining code |
| Admin | Reports, books, approvals, stock corrections, catalogue, staff (not other admins) |
| Cashier | Sales, expenses, stock received, customer payments, counts, own cash-up; can only *request* voids; returns on their own sales with a manager's PIN |
| Storekeeper | As cashier, plus transfers, usage and production |

The UI hides what a role can't do, and Postgres enforces it independently: RLS on every table, column-limited grants, and every transaction runs through a `SECURITY DEFINER` function that checks the caller's role. Staff see only their own sales, expenses and cash-ups; books, alerts and the audit log are admin-only.

---

## Project structure

```
supabase/
  migrations/
    20261014000100_core.sql        businesses, members, roles, catalogue, locations, stock ledger
    20261014000200_ledger.sql      chart of accounts, journal, post_journal / reverse_journal
    20261014000300_controls.sql    audit log (hash chain), alerts, notification outbox, low-stock trigger
    20261014000400_operations.sql  sales, expenses, receiving, payments, counts, cash-ups, jobs, production + RPCs
    20261014000500_reports.sql     P&L, balances, cash flow, reconciliation, dashboards, weekly report, advisor metrics
    20261014000600_security.sql    RLS policies, grants, function privileges
    20261025000100_returns.sql     returns, exchanges, store credit, manager PINs
  tests/database.test.mjs          151 checks against an in-memory Postgres (PGlite)
src/
  proxy.ts                         session refresh, auth gate, device-id cookie
  app/
    page.tsx, login, signup, auth, onboarding, pending, offline
    (app)/                         signed-in area: dashboard, pos, sales, customers, jobs, inventory,
                                   receiving, counts, production, expenses, cash-up, suppliers,
                                   accounting, reports, reconciliation, alerts, audit, staff, settings
    api/sales                      POST: record a sale (also the offline sync target)
    api/sales/[id]/return-info     GET: what can still be returned from a sale
    api/pos/catalog                GET: till catalogue with live stock
    api/advisor                    POST: fresh advice for the business
    api/cron/weekly-reports        Monday reports + advice + expiry scan
    api/cron/notifications         sends queued SMS / WhatsApp alerts
  components/                      ui, shell, pos, onboarding, inventory, reports, charts
  lib/
    archetypes.ts                  the 13 business types + custom
    auth.ts, permissions.ts        session, active business, role capabilities
    validation.ts                  Zod schemas shared by forms and server actions
    advisor/                       rules engine + Claude layer
    offline/queue.ts               on-device sales queue and catalogue cache
    supabase/                      server, browser, proxy and service-role clients
```

---

## Setup

1. **Install:** `npm install`
2. **Supabase project:** create one at supabase.com. In *Authentication → Providers → Email*, decide whether new owners must confirm their e-mail.
3. **Apply the migrations** (once, on the empty project) — either `supabase link --project-ref <ref>` then `supabase db push`, or run `npm run db:bundle` and paste the generated `supabase/setup.sql` into *SQL Editor → New query → Run*.
4. **Environment:** `cp .env.example .env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and (for staff logins without e-mail and for cron) `SUPABASE_SERVICE_ROLE_KEY`. Set `CRON_SECRET` to a long random string.
5. **Run:** `npm run dev` → http://localhost:3000 → *Set up my business*.
6. **Manager PIN:** each owner/admin sets a 4-digit PIN in *Settings → Manager PIN*. Returns cannot be confirmed until at least one manager has one.

**Updating a project that is already set up:** run only the migrations it does not have yet, oldest first — `supabase db push`, or paste each new file from `supabase/migrations/` into *SQL Editor → New query → Run* (for returns: `20261025000100_returns.sql`). Deploy the app after the database is updated: the new pages read the new tables.

To try it on a phone on the same Wi-Fi: `npm run dev -- -H 0.0.0.0` and open `http://<laptop-ip>:3000`. (Camera scanning and the service worker need HTTPS, so test those on the deployed site.)

### Checks

```bash
npm run test:db     # migrations + business rules, RLS and fraud controls (PGlite, no Supabase needed)
npm run typecheck
npm run lint
npm run build
```

### Deploy (Vercel)

Import the repo, add the environment variables, deploy. `vercel.json` schedules the weekly report (Mondays 06:00 GMT) and the alert dispatcher (daily 07:00 GMT — the Hobby plan only allows daily crons; on Pro, set it to `*/10 * * * *`); Vercel sends `CRON_SECRET` automatically. Elsewhere, call those two URLs from any scheduler with `Authorization: Bearer $CRON_SECRET`.

### AI advisor (optional)

Set `ANTHROPIC_API_KEY`. The advisor sends the week's aggregated figures (item names, quantities, prices and totals, plus staff names with cash-up differences and the top debtors' names with balances — no phone numbers) to the Claude API (`claude-opus-5-5`, structured JSON output, server-side refusal fallback enabled) and stores the result on the weekly report. Without a key, the rules engine produces the advice.

### SMS / WhatsApp alerts (optional)

An owner sets their number in *Settings → Alerts*. Critical alerts (and optionally low stock) are queued in `notifications` and sent by `/api/cron/notifications` through the Meta WhatsApp Cloud API, Africa's Talking SMS, or your own webhook — see `.env.example`. With no provider configured, messages stay queued.

---

## Notes and limits

- **Currency:** amounts are new Leones (SLE). The till shows the old-Leone equivalent (×1,000) under the total. USD payments convert at the rate in Settings.
- **Time zone:** Sierra Leone is on GMT all year; business days are UTC days.
- **Blind counts** hide the system quantity on the count sheet, but stock figures are still visible to staff elsewhere (e.g. on the till), so they are a deterrent, not a guarantee.
- **IP/device in the audit log** comes from headers the Next.js server forwards. Someone calling Supabase directly with their own session could supply other values; the hash chain still prevents later edits to the log.
- **Offline:** a sale made offline is recorded even if the system shows no stock, and is flagged. Server-side prices apply at sync time.
- **Not included yet:** printing to Bluetooth thermal printers (uses the browser print dialog), mobile-money API reconciliation (payments are recorded with a reference, not verified against Orange/Afrimoney APIs), multi-branch transfers between businesses, and NRA tax filing exports.
