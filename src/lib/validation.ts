/**
 * Zod schemas shared by client forms (React Hook Form) and server actions.
 * The database validates again; these give fast, friendly messages.
 */
import { z } from "zod";
import { ARCHETYPE_KEYS } from "./archetypes";

const trimmed = (label: string, max = 120) =>
  z.string().trim().min(1, `${label} is required.`).max(max, `${label} is too long.`);
const optionalText = (max = 300) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

/** A number typed into a form: accepts "1,250.50", rejects blanks when required. */
export const amount = (label: string, { min = 0, allowZero = true } = {}) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.replace(/,/g, "").trim() : v),
    z
      .union([z.string(), z.number()])
      .refine((v) => v !== "", `${label} is required.`)
      .transform((v) => Number(v))
      .refine((v) => Number.isFinite(v), `${label} must be a number.`)
      .refine((v) => v >= min && (allowZero || v !== 0), `${label} must be ${allowZero ? "at least" : "more than"} ${min}.`),
  );

export const optionalAmount = (label: string) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.replace(/,/g, "").trim() : v),
    z
      .union([z.string(), z.number()])
      .optional()
      .transform((v) => (v === "" || v === undefined ? undefined : Number(v)))
      .refine((v) => v === undefined || (Number.isFinite(v) && v >= 0), `${label} must be a positive number.`),
  );

export const PAYMENT_METHOD = z.enum(["cash", "orange_money", "afrimoney", "qmoney", "bank", "credit"]);
/** How a sale can be paid: the methods a business switches on, plus store credit from returns. */
export const SALE_PAYMENT_METHOD = z.enum([...PAYMENT_METHOD.options, "store_credit"]);
export const MONEY_METHOD = z.enum(["cash", "orange_money", "afrimoney", "qmoney", "bank"]);
export const STORAGE_MODE = z.enum(["shelves", "freezers", "cold_store", "warehouse"]);

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export const onboardingItemSchema = z.object({
  name: trimmed("Item name", 160),
  category: optionalText(60),
  unit: trimmed("Unit", 30),
  kind: z.enum(["stock", "service", "raw_material"]).default("stock"),
  cost_price: optionalAmount("Cost price"),
  selling_price: optionalAmount("Selling price"),
  reorder_level: optionalAmount("Re-order level"),
  opening_qty: optionalAmount("Opening quantity"),
  sku: optionalText(40),
  barcode: optionalText(40),
});

export const onboardingSchema = z
  .object({
    // Step 1
    name: trimmed("Business name").min(2, "Business name is too short."),
    location_city: trimmed("Town / city", 60),
    address: optionalText(200),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ]{7,16}$/, "Enter a phone number like +232 76 123456.")
      .or(z.literal(""))
      .optional(),
    email: z.string().trim().email("Enter a valid e-mail.").or(z.literal("")).optional(),
    owner_name: trimmed("Your name", 80),
    // Step 2
    business_type: z.enum(ARCHETYPE_KEYS, { error: "Choose the type of business." }),
    custom_type_label: optionalText(80),
    units: z.array(z.string().trim().min(1)).min(1, "Choose at least one stock unit."),
    terminology: z.object({
      item: trimmed("Word for an item", 30),
      items: trimmed("Word for items", 30),
      sale: trimmed("Word for a sale", 30),
      sales: trimmed("Word for sales", 30),
      customer: trimmed("Word for a customer", 30),
      customers: trimmed("Word for customers", 30),
      job: z.string().trim().max(30).optional(),
      jobs: z.string().trim().max(30).optional(),
    }),
    modules: z.record(z.string(), z.unknown()),
    // Step 3
    storage_modes: z.array(STORAGE_MODE).min(1, "Choose where you keep stock."),
    sales_input_by: z.enum(["staff", "admin", "both"]),
    payment_methods: z.array(PAYMENT_METHOD).min(1, "Choose at least one payment method."),
    // Step 4
    opening_cash: optionalAmount("Opening cash"),
    items: z.array(onboardingItemSchema).max(500, "Import at most 500 items during setup; add more later."),
  })
  .superRefine((v, ctx) => {
    if (v.business_type === "custom" && !v.custom_type_label) {
      ctx.addIssue({ code: "custom", path: ["custom_type_label"], message: "Describe your type of business." });
    }
  });

export type OnboardingInput = z.input<typeof onboardingSchema>;
export type OnboardingValues = z.output<typeof onboardingSchema>;

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export const productSchema = z.object({
  name: trimmed("Name", 160),
  sku: optionalText(40),
  barcode: optionalText(40),
  category: optionalText(60),
  kind: z.enum(["stock", "service", "raw_material"]),
  unit: trimmed("Unit", 30),
  track_mode: z.enum(["none", "serial", "batch"]),
  cost_price: amount("Cost price"),
  selling_price: amount("Selling price"),
  wholesale_price: optionalAmount("Wholesale price"),
  reorder_level: amount("Re-order level"),
  reorder_qty: amount("Re-order quantity"),
  warranty_months: optionalAmount("Warranty"),
  commission_pct: amount("Commission"),
  requires_prescription: z.boolean().default(false),
  is_regulated: z.boolean().default(false),
  allow_fractional: z.boolean().default(false),
  attributes: z.record(z.string(), z.string()).default({}),
  preferred_supplier_id: z.string().uuid().optional().or(z.literal("")),
  opening_qty: optionalAmount("Opening quantity"),
  location_id: z.string().uuid().optional().or(z.literal("")),
  serials: z.string().optional(),
  batch_no: optionalText(40),
  expiry_date: optionalText(10),
});
export type ProductInput = z.input<typeof productSchema>;

export const csvRowSchema = z.object({
  name: trimmed("name", 160),
  category: optionalText(60),
  unit: z.string().trim().max(30).optional(),
  kind: z.enum(["stock", "service", "raw_material"]).optional(),
  sku: optionalText(40),
  barcode: optionalText(40),
  cost_price: optionalAmount("cost_price"),
  selling_price: optionalAmount("selling_price"),
  wholesale_price: optionalAmount("wholesale_price"),
  reorder_level: optionalAmount("reorder_level"),
  reorder_qty: optionalAmount("reorder_qty"),
  opening_qty: optionalAmount("opening_qty"),
});

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export const saleSchema = z.object({
  business_id: z.string().uuid(),
  client_ref: z.string().uuid(),
  location_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional().nullable(),
  order_type: z.enum(["counter", "table", "takeaway", "delivery"]).default("counter"),
  table_label: z.string().trim().max(40).optional(),
  discount: z.number().min(0).default(0),
  prescription_ref: z.string().trim().max(80).optional(),
  note: z.string().trim().max(300).optional(),
  offline: z.boolean().default(false),
  captured_at: z.string().datetime().optional(),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        qty: z.number().positive(),
        unit_price: z.number().min(0).optional(),
        discount: z.number().min(0).optional(),
        serial_ids: z.array(z.string().uuid()).optional(),
        performed_by: z.string().uuid().optional().nullable(),
      }),
    )
    .min(1, "Add at least one item.")
    .max(200),
  payments: z
    .array(
      z.object({
        method: SALE_PAYMENT_METHOD,
        amount: z.number().positive(),
        currency: z.enum(["SLE", "USD"]).default("SLE"),
        reference: z.string().trim().max(60).optional(),
      }),
    )
    .max(6),
});
export type SalePayload = z.input<typeof saleSchema>;

export const returnSchema = z.object({
  client_ref: z.string().uuid(),
  sale_id: z.string().uuid(),
  return_type: z.enum(["refund", "exchange", "damaged"]),
  reason_code: z.enum(["changed_mind", "defective", "wrong_item", "expired", "other"]),
  reason: z.string().trim().min(3, "Say why the goods are coming back.").max(300),
  refund_method: z.enum(["cash", "mobile_money", "store_credit"]).nullable().optional(),
  momo_provider: z.enum(["orange_money", "afrimoney", "qmoney"]).nullable().optional(),
  items: z
    .array(
      z.object({
        sale_item_id: z.string().uuid(),
        qty: z.number().positive(),
        restock: z.boolean(),
        serial_ids: z.array(z.string().uuid()).optional(),
      }),
    )
    .min(1, "Choose at least one item to return.")
    .max(200),
  exchange: z
    .object({
      items: z
        .array(
          z.object({
            product_id: z.string().uuid(),
            qty: z.number().positive(),
            serial_ids: z.array(z.string().uuid()).optional(),
          }),
        )
        .min(1, "Choose what the customer is taking in exchange.")
        .max(200),
      payments: z
        .array(
          z.object({
            method: SALE_PAYMENT_METHOD,
            amount: z.number().positive(),
            reference: z.string().trim().max(60).optional(),
          }),
        )
        .max(4),
      prescription_ref: z.string().trim().max(80).optional(),
    })
    .optional(),
  manager_id: z.string().uuid("Choose the manager approving this."),
  pin: z.string().regex(/^\d{4}$/, "Enter the 4-digit manager PIN."),
});
export type ReturnPayload = z.input<typeof returnSchema>;

export const expenseSchema = z.object({
  account_id: z.string().uuid("Choose an expense category."),
  amount: amount("Amount", { allowZero: false }),
  method: MONEY_METHOD,
  paid_to: optionalText(120),
  note: optionalText(300),
  expense_date: z.string().optional(),
});
export type ExpenseInput = z.input<typeof expenseSchema>;

export const receiptSchema = z.object({
  supplier_id: z.string().uuid().optional().or(z.literal("")),
  supplier_name: optionalText(120),
  invoice_ref: optionalText(60),
  location_id: z.string().uuid().optional().or(z.literal("")),
  note: optionalText(300),
  amount_paid: optionalAmount("Amount paid"),
  payment_method: MONEY_METHOD.optional(),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid("Choose an item."),
        qty: amount("Quantity", { allowZero: false }),
        unit_cost: amount("Unit cost"),
        batch_no: optionalText(40),
        expiry_date: optionalText(10),
        serials: z.string().optional(),
      }),
    )
    .min(1, "Add the items received."),
});
export type ReceiptInput = z.input<typeof receiptSchema>;

export const jobSchema = z.object({
  kind: z.enum(["repair", "booking", "installation", "custom_order", "service", "delivery", "general"]),
  title: trimmed("Title", 160),
  customer_name: optionalText(120),
  customer_phone: optionalText(30),
  description: optionalText(2000),
  item_ref: optionalText(64),
  scheduled_for: optionalText(30),
  due_date: optionalText(10),
  assigned_to: z.string().uuid().optional().or(z.literal("")),
  quoted_amount: optionalAmount("Quoted amount"),
});

export const staffLoginSchema = z.object({
  display_name: trimmed("Name", 80),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,30}$/, "Username: 3–30 letters, numbers, dots or dashes."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  role: z.enum(["admin", "cashier", "storekeeper"]),
  phone: optionalText(30),
});
