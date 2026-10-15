/** Database row shapes and shared domain types. Keep in step with supabase/migrations. */

export type Role = "owner" | "admin" | "cashier" | "storekeeper";
export type MemberStatus = "active" | "pending" | "suspended";
export type PaymentMethod = "cash" | "orange_money" | "afrimoney" | "qmoney" | "bank" | "credit";
export type Currency = "SLE" | "USD";
export type ProductKind = "stock" | "service" | "raw_material";
export type TrackMode = "none" | "serial" | "batch";
export type LocationKind = "shelf" | "freezer" | "cold_store" | "warehouse" | "store_room" | "vehicle" | "other";
export type StorageMode = "shelves" | "freezers" | "cold_store" | "warehouse";
export type SalesInputBy = "staff" | "admin" | "both";
export type JobKind = "repair" | "booking" | "installation" | "custom_order" | "service" | "delivery" | "general";
export type JobStatus = "pending" | "scheduled" | "in_progress" | "ready" | "completed" | "cancelled";
export type AlertSeverity = "info" | "warning" | "critical";
export type AlertStatus = "open" | "acknowledged" | "resolved";

export interface Terminology {
  item: string;
  items: string;
  sale: string;
  sales: string;
  customer: string;
  customers: string;
  job?: string;
  jobs?: string;
}

export interface AttributeField {
  key: string;
  label: string;
  placeholder?: string;
}

/** Feature switches stored on the business (snapshotted from its archetype). */
export interface BusinessModules {
  barcode?: boolean;
  serials?: boolean;
  serialLabel?: string;
  batches?: boolean;
  expiry?: boolean;
  warranty?: boolean;
  wholesale?: boolean;
  services?: boolean;
  commissions?: boolean;
  prescriptions?: boolean;
  tables?: boolean;
  production?: boolean;
  usage?: boolean;
  jobs?: JobKind | null;
  attributes?: AttributeField[];
}

export interface Business {
  id: string;
  name: string;
  business_type: string;
  custom_type_label: string | null;
  location_city: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  currency_code: string;
  usd_rate: number;
  terminology: Partial<Terminology>;
  units: string[];
  modules: BusinessModules;
  storage_modes: StorageMode[];
  sales_input_by: SalesInputBy;
  payment_methods: PaymentMethod[];
  max_staff_discount_pct: number;
  stock_variance_tolerance_pct: number;
  cash_variance_tolerance: number;
  staff_expense_alert_amount: number;
  staff_backdate_days: number;
  opening_time: string | null;
  closing_time: string | null;
  dead_stock_days: number;
  notify: { phone?: string; channel?: "sms" | "whatsapp"; low_stock?: boolean; min_severity?: AlertSeverity };
  join_code: string;
  onboarding_completed_at: string | null;
  created_at: string;
}

export interface Membership {
  business_id: string;
  user_id: string;
  role: Role;
  status: MemberStatus;
  display_name: string;
  phone: string | null;
  created_at: string;
}

export interface Location {
  id: string;
  business_id: string;
  name: string;
  kind: LocationKind;
  is_default_sale: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface Category {
  id: string;
  name: string;
}

export interface Product {
  id: string;
  business_id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  category_id: string | null;
  kind: ProductKind;
  unit: string;
  track_mode: TrackMode;
  attributes: Record<string, string>;
  cost_price: number;
  selling_price: number;
  wholesale_price: number | null;
  reorder_level: number;
  reorder_qty: number;
  preferred_supplier_id: string | null;
  warranty_months: number | null;
  requires_prescription: boolean;
  is_regulated: boolean;
  commission_pct: number;
  allow_fractional: boolean;
  is_active: boolean;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  balance_due: number;
  is_active: boolean;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  credit_limit: number;
  balance: number;
  is_active: boolean;
}

export interface Account {
  id: string;
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  system_key: string | null;
  is_expense_category: boolean;
  is_active: boolean;
}

export interface Sale {
  id: string;
  business_id: string;
  receipt_no: number;
  customer_id: string | null;
  location_id: string;
  order_type: "counter" | "table" | "takeaway" | "delivery";
  table_label: string | null;
  subtotal: number;
  discount: number;
  total: number;
  cost_total: number;
  status: "completed" | "void_requested" | "voided";
  prescription_ref: string | null;
  note: string | null;
  offline: boolean;
  captured_at: string;
  created_by: string;
  created_at: string;
  void_reason: string | null;
  void_requested_at: string | null;
  void_review_note: string | null;
  voided_at: string | null;
}

export interface SaleItem {
  id: string;
  product_id: string;
  name: string;
  kind: ProductKind;
  qty: number;
  unit_price: number;
  list_price: number;
  discount: number;
  line_total: number;
  unit_cost: number;
  performed_by: string | null;
  commission_amount: number;
  serial_ids: string[] | null;
}

export interface SalePayment {
  id: string;
  method: PaymentMethod;
  currency: Currency;
  amount: number;
  fx_rate: number;
  amount_base: number;
  reference: string | null;
}

export interface Alert {
  id: string;
  kind: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  product_id: string | null;
  ref_table: string | null;
  ref_id: string | null;
  status: AlertStatus;
  created_at: string;
  updated_at: string;
  resolution_note: string | null;
}

export interface Job {
  id: string;
  job_no: number;
  kind: JobKind;
  title: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  description: string | null;
  item_ref: string | null;
  status: JobStatus;
  scheduled_for: string | null;
  due_date: string | null;
  assigned_to: string | null;
  quoted_amount: number | null;
  amount_paid: number;
  details: Record<string, string>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface AuditEntry {
  id: number;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  summary: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  user_agent: string | null;
  device_id: string | null;
  created_at: string;
  hash: string;
}

/** What the POS needs per sellable item; also cached on the device for offline use. */
export interface CatalogItem {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
  kind: ProductKind;
  unit: string;
  track_mode: TrackMode;
  selling_price: number;
  wholesale_price: number | null;
  requires_prescription: boolean;
  allow_fractional: boolean;
  commission_pct: number;
  stock: number;
  serials?: { id: string; serial: string }[];
}

export interface WeeklyReportData {
  week_start: string;
  week_end: string;
  business: { name: string; type: string; city: string };
  pl: {
    revenue: number;
    cogs: number;
    gross_profit: number;
    operating_expenses: number;
    shrinkage: number;
    net_profit: number;
    net_margin_pct: number | null;
    expense_lines: { name: string; amount: number }[];
  };
  previous: { revenue: number; net_profit: number; operating_expenses: number };
  sales: { count: number; total: number; average: number; discounts: number; voided: number };
  by_day: { date: string; revenue: number }[];
  payment_mix: { method: PaymentMethod; amount: number }[];
  top_items: { product_id: string; name: string; qty: number; revenue: number; profit: number }[];
  dead_stock: { product_id: string; name: string; unit: string; quantity: number; value: number; last_sold: string | null }[];
  shrinkage: { value: number; lines: { name: string; qty: number; value: number; reason: string }[] };
  cash: { cash_ups: number; shortage: number; overage: number };
  alerts: { kind: string; severity: AlertSeverity; count: number }[];
  staff: { user_id: string; name: string; sales: number; revenue: number; discounts: number; commission: number }[];
  receivables: number;
  payables: number;
}

export interface Advice {
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
  category: "stock" | "sales" | "cash" | "fraud" | "costs" | "credit" | "general";
  action?: string;
}

export interface AdviceResult {
  generated_at: string;
  source: "rules" | "ai";
  model?: string;
  summary?: string;
  items: Advice[];
}
