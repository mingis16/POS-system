"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useFieldArray, useForm, useWatch, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import { clsx } from "clsx";
import {
  AlertOctagon,
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import {
  ARCHETYPES,
  CITIES,
  COMMON_UNITS,
  JOB_KIND_LABELS,
  STORAGE_OPTIONS,
  getArchetype,
  locationsFor,
  type ArchetypeKey,
} from "@/lib/archetypes";
import { CSV_TEMPLATE, csvToItems } from "@/lib/csv";
import { PAYMENT_LABELS, PAYMENT_METHODS, formatMoney } from "@/lib/format";
import { onboardingSchema, type OnboardingInput, type OnboardingValues } from "@/lib/validation";
import type { BusinessModules, JobKind, PaymentMethod } from "@/lib/types";
import { createBusiness } from "@/app/onboarding/actions";
import { Field } from "@/components/ui/field";
import { buttonGhost, buttonPrimary, buttonSecondary, inputClass, selectClass } from "@/components/ui/styles";
import { ARCHETYPE_ICONS } from "./archetype-icons";

type Values = OnboardingInput;

const STEPS: { title: string; subtitle: string; fields: FieldPath<Values>[] }[] = [
  {
    title: "Your business",
    subtitle: "The name customers know you by, and where you trade.",
    fields: ["name", "owner_name", "location_city", "address", "phone", "email"],
  },
  {
    title: "Type of business",
    subtitle: "This sets up the right screens, units and words for you. You can change words later.",
    fields: ["business_type", "custom_type_label", "units", "terminology"],
  },
  {
    title: "How you work",
    subtitle: "Where stock is kept, who records sales, and how customers pay.",
    fields: ["storage_modes", "sales_input_by", "payment_methods"],
  },
  {
    title: "Starting stock",
    subtitle: "Add what you have today: tick suggestions, import a spreadsheet (CSV) or type items in. You can skip this.",
    fields: ["items", "opening_cash"],
  },
  { title: "Review & create", subtitle: "Check the details, then create your business.", fields: [] },
];

const chip = (on: boolean) =>
  clsx(
    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
    on
      ? "border-brand-600 bg-brand-50 text-brand-800 dark:border-brand-500 dark:bg-brand-800/30 dark:text-brand-100"
      : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
  );

const blankItem = (unit: string): Values["items"][number] => ({
  name: "",
  category: "",
  unit,
  kind: "stock",
  cost_price: "",
  selling_price: "",
  reorder_level: "",
  opening_qty: "",
  sku: "",
  barcode: "",
});

export function OnboardingWizard({ ownerName, ownerPhone }: { ownerName: string; ownerPhone: string }) {
  const form = useForm<Values, unknown, OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    mode: "onTouched",
    defaultValues: {
      name: "",
      owner_name: ownerName,
      location_city: "Freetown",
      address: "",
      phone: ownerPhone,
      email: "",
      business_type: undefined as unknown as ArchetypeKey,
      custom_type_label: "",
      units: [],
      terminology: { ...getArchetype("custom").terminology },
      modules: {},
      storage_modes: ["shelves"],
      sales_input_by: "both",
      payment_methods: ["cash", "orange_money", "afrimoney"],
      opening_cash: "",
      items: [],
    },
  });
  const { register, control, setValue, getValues, trigger, formState } = form;
  const { errors } = formState;
  const items = useFieldArray({ control, name: "items" });
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [serverError, setServerError] = useState<string | null>(null);
  const [csvNote, setCsvNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const type = useWatch({ control, name: "business_type" });
  const units = useWatch({ control, name: "units" }) ?? [];
  const storage = useWatch({ control, name: "storage_modes" }) ?? [];
  const payments = useWatch({ control, name: "payment_methods" }) ?? [];
  const modules = (useWatch({ control, name: "modules" }) ?? {}) as BusinessModules;
  const watchedItemsRaw = useWatch({ control, name: "items" });
  const watchedItems = useMemo(() => watchedItemsRaw ?? [], [watchedItemsRaw]);
  const terms = useWatch({ control, name: "terminology" });
  const archetype = type ? getArchetype(type) : null;

  const stockValue = useMemo(
    () =>
      watchedItems.reduce(
        (sum, i) => sum + (Number(i.cost_price || 0) || 0) * (Number(i.opening_qty || 0) || 0),
        0,
      ),
    [watchedItems],
  );

  function go(to: number) {
    setDir(to > step ? 1 : -1);
    setStep(to);
    setServerError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function next() {
    const ok = await trigger(STEPS[step].fields, { shouldFocus: true });
    if (ok) go(step + 1);
  }

  function chooseType(key: ArchetypeKey) {
    const a = getArchetype(key);
    setValue("business_type", key, { shouldValidate: true });
    setValue("terminology", { ...a.terminology });
    setValue("units", key === "custom" ? ["pieces"] : [...a.units], { shouldValidate: true });
    setValue("modules", { ...a.modules } as Record<string, unknown>);
    const defaultStorage = a.locations.some((l) => l.kind === "warehouse") ? ["shelves", "warehouse"] : ["shelves"];
    setValue("storage_modes", defaultStorage as Values["storage_modes"]);
  }

  function toggle<T extends string>(name: "units" | "storage_modes" | "payment_methods", value: T) {
    const current = (getValues(name) ?? []) as string[];
    const nextList = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    setValue(name, nextList as never, { shouldValidate: true });
  }

  function setModule<K extends keyof BusinessModules>(key: K, value: BusinessModules[K]) {
    setValue("modules", { ...(getValues("modules") as BusinessModules), [key]: value } as Record<string, unknown>);
  }

  function addSample(name: string, unit: string, category: string, kind: "stock" | "service" | "raw_material" = "stock") {
    if (watchedItems.some((i) => i.name.toLowerCase() === name.toLowerCase())) return;
    items.append({ ...blankItem(unit), name, category, kind });
  }

  async function importCsv(file: File) {
    const text = await file.text();
    const { rows, unknownHeaders } = csvToItems(text);
    const room = 500 - watchedItems.length;
    rows.slice(0, room).forEach((r) =>
      items.append({
        ...blankItem(r.unit || units[0] || "pieces"),
        name: r.name,
        category: r.category ?? "",
        kind: (["stock", "service", "raw_material"].includes(r.kind) ? r.kind : "stock") as "stock",
        sku: r.sku ?? "",
        barcode: r.barcode ?? "",
        cost_price: r.cost_price ?? "",
        selling_price: r.selling_price ?? "",
        reorder_level: r.reorder_level ?? "",
        opening_qty: r.opening_qty ?? "",
      }),
    );
    setCsvNote(
      `Imported ${Math.min(rows.length, room)} item(s)` +
        (rows.length > room ? ` (${rows.length - room} skipped: 500 max during setup)` : "") +
        (unknownHeaders.length ? `. Ignored columns: ${unknownHeaders.join(", ")}` : "."),
    );
    if (fileRef.current) fileRef.current.value = "";
  }

  function submit() {
    setServerError(null);
    form.handleSubmit(
      () =>
        startTransition(async () => {
          const res = await createBusiness(getValues());
          if (res && !res.ok) setServerError(res.error ?? "Could not create the business.");
        }),
      (errs) => {
        const firstStep = STEPS.findIndex((s) => s.fields.some((f) => f.split(".")[0] in errs));
        if (firstStep >= 0) go(firstStep);
        setServerError("Some details need fixing — see the highlighted fields.");
      },
    )();
  }

  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* Progress */}
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            Step {step + 1} of {STEPS.length}
          </span>
          <span className="hidden sm:inline">{STEPS.map((s) => s.title).join(" · ")}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <motion.div
            className="h-full rounded-full bg-brand-600"
            animate={{ width: `${progress}%` }}
            transition={{ type: "spring", stiffness: 200, damping: 30 }}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-surface p-5 shadow-sm sm:p-7 dark:border-zinc-800">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{STEPS[step].title}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{STEPS[step].subtitle}</p>

        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div
            key={step}
            custom={dir}
            initial={{ opacity: 0, x: dir * 32 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -32 }}
            transition={{ duration: 0.18 }}
            className="mt-6"
          >
            {step === 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Business name" error={errors.name?.message} className="sm:col-span-2">
                  <input {...register("name")} className={inputClass} placeholder="e.g. Aminata's Mini-Mart" autoFocus />
                </Field>
                <Field label="Your name" error={errors.owner_name?.message}>
                  <input {...register("owner_name")} className={inputClass} autoComplete="name" />
                </Field>
                <Field label="Town / city" error={errors.location_city?.message}>
                  <select {...register("location_city")} className={selectClass}>
                    {CITIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Address / area" hint="e.g. 12 Kissy Road, East End" className="sm:col-span-2">
                  <input {...register("address")} className={inputClass} />
                </Field>
                <Field label="Business phone" error={errors.phone?.message} hint="Used on receipts and for alerts.">
                  <input {...register("phone")} type="tel" className={inputClass} placeholder="+232 76 123456" />
                </Field>
                <Field label="Business e-mail (optional)" error={errors.email?.message}>
                  <input {...register("email")} type="email" className={inputClass} />
                </Field>
              </div>
            )}

            {step === 1 && (
              <div className="flex flex-col gap-5">
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {ARCHETYPES.map((a) => {
                    const Icon = ARCHETYPE_ICONS[a.icon];
                    const on = type === a.key;
                    return (
                      <button
                        key={a.key}
                        type="button"
                        onClick={() => chooseType(a.key)}
                        className={clsx(
                          "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                          on
                            ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600 dark:border-brand-500 dark:bg-brand-800/20"
                            : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900",
                        )}
                        aria-pressed={on}
                      >
                        <span
                          className={clsx(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                            on ? "bg-brand-600 text-white" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
                          )}
                        >
                          <Icon className="h-5 w-5" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-50">{a.label}</span>
                          <span className="block text-xs text-zinc-500 dark:text-zinc-400">{a.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {errors.business_type && (
                  <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                    Choose the type of business.
                  </p>
                )}

                {archetype && (
                  <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                    {type === "custom" && (
                      <Field label="What kind of business is it?" error={errors.custom_type_label?.message}>
                        <input {...register("custom_type_label")} className={inputClass} placeholder="e.g. Poultry farm, Printing press, Bakery" />
                      </Field>
                    )}

                    <div>
                      <p className="mb-2 text-sm font-medium">How do you count your stock?</p>
                      <div className="flex flex-wrap gap-2">
                        {[...new Set([...(type === "custom" ? COMMON_UNITS : archetype.units), ...units])].map((u) => (
                          <button key={u} type="button" className={chip(units.includes(u))} onClick={() => toggle("units", u)}>
                            {units.includes(u) && <Check className="h-3.5 w-3.5" />}
                            {u}
                          </button>
                        ))}
                        <AddUnit onAdd={(u) => !units.includes(u) && setValue("units", [...units, u], { shouldValidate: true })} />
                      </div>
                      {errors.units && <p className="mt-1 text-xs text-red-700">{errors.units.message}</p>}
                    </div>

                    {type === "custom" && (
                      <div>
                        <p className="mb-2 text-sm font-medium">What do you need to track?</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Toggle label="Serial numbers / IMEI per unit" on={!!modules.serials} set={(v) => setModule("serials", v)} />
                          <Toggle label="Batches & expiry dates" on={!!modules.batches} set={(v) => { setModule("batches", v); setModule("expiry", v); }} />
                          <Toggle label="I sell services (not only goods)" on={!!modules.services} set={(v) => setModule("services", v)} />
                          <Toggle label="Staff commissions on services" on={!!modules.commissions} set={(v) => setModule("commissions", v)} />
                          <Toggle label="I make products (production)" on={!!modules.production} set={(v) => setModule("production", v)} />
                          <Toggle label="Record stock used up (materials)" on={!!modules.usage} set={(v) => setModule("usage", v)} />
                          <Toggle label="Barcode scanning" on={!!modules.barcode} set={(v) => setModule("barcode", v)} />
                          <Toggle label="Wholesale prices" on={!!modules.wholesale} set={(v) => setModule("wholesale", v)} />
                        </div>
                        <Field label="Jobs, orders or bookings" className="mt-3" hint="Repairs, bookings, installations, custom orders, deliveries…">
                          <select
                            className={selectClass}
                            value={modules.jobs ?? ""}
                            onChange={(e) => setModule("jobs", (e.target.value || null) as JobKind | null)}
                          >
                            <option value="">Not needed</option>
                            {Object.entries(JOB_KIND_LABELS).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v.many}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                    )}

                    <details open={type === "custom"} className="group">
                      <summary className="cursor-pointer text-sm font-medium text-brand-700 dark:text-brand-500">
                        Words used in the app {type !== "custom" && "(optional)"}
                      </summary>
                      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {(["item", "items", "sale", "sales", "customer", "customers"] as const).map((k) => (
                          <Field key={k} label={`"${k}"`} error={errors.terminology?.[k]?.message}>
                            <input {...register(`terminology.${k}`)} className={inputClass} />
                          </Field>
                        ))}
                      </div>
                    </details>
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="flex flex-col gap-6">
                <div>
                  <p className="mb-1 text-sm font-medium">How do you store perishable or temperature-sensitive goods?</p>
                  <p className="mb-2.5 text-xs text-zinc-500">Each becomes a stock location, so you can count and track them separately.</p>
                  <div className="flex flex-wrap gap-2">
                    {STORAGE_OPTIONS.map((s) => (
                      <button key={s.value} type="button" className={chip(storage.includes(s.value))} onClick={() => toggle("storage_modes", s.value)}>
                        {storage.includes(s.value) && <Check className="h-3.5 w-3.5" />}
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {errors.storage_modes && <p className="mt-1 text-xs text-red-700">{errors.storage_modes.message}</p>}
                </div>

                <div>
                  <p className="mb-2.5 text-sm font-medium">Who handles daily sales input?</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(
                      [
                        ["staff", "Cashiers / staff", "Staff record every sale; you review."],
                        ["admin", "Admin only", "Only you (or managers) record sales."],
                        ["both", "Both", "Staff and admins can record sales."],
                      ] as const
                    ).map(([value, label, hint]) => (
                      <label
                        key={value}
                        className="flex cursor-pointer flex-col gap-0.5 rounded-xl border border-zinc-200 p-3 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 dark:border-zinc-800 dark:has-[:checked]:border-brand-500 dark:has-[:checked]:bg-brand-800/20"
                      >
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <input type="radio" value={value} {...register("sales_input_by")} className="accent-brand-600" />
                          {label}
                        </span>
                        <span className="pl-6 text-xs text-zinc-500">{hint}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-1 text-sm font-medium">What payment methods do you accept?</p>
                  <p className="mb-2.5 text-xs text-zinc-500">Cash is always on. Credit lets trusted customers buy now and pay later.</p>
                  <div className="flex flex-wrap gap-2">
                    {PAYMENT_METHODS.map((m) => {
                      const on = m === "cash" || payments.includes(m);
                      return (
                        <button
                          key={m}
                          type="button"
                          disabled={m === "cash"}
                          className={clsx(chip(on), m === "cash" && "cursor-default")}
                          onClick={() => toggle("payment_methods", m as PaymentMethod)}
                        >
                          {on && <Check className="h-3.5 w-3.5" />}
                          {m === "credit" ? "Credit / debt" : PAYMENT_LABELS[m]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {step === 3 && archetype && (
              <div className="flex flex-col gap-5">
                {archetype.sampleItems.length > 0 && (
                  <div>
                    <p className="mb-2 text-sm font-medium">Quick add (you fill in prices)</p>
                    <div className="flex flex-wrap gap-2">
                      {archetype.sampleItems.map((s) => {
                        const added = watchedItems.some((i) => i.name === s.name);
                        return (
                          <button
                            key={s.name}
                            type="button"
                            className={chip(added)}
                            onClick={() => addSample(s.name, s.unit, s.category, s.kind)}
                          >
                            {added ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                            {s.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className={buttonSecondary} onClick={() => items.append(blankItem(units[0] ?? "pieces"))}>
                    <Plus className="h-4 w-4" /> Add {terms?.item?.toLowerCase() ?? "item"}
                  </button>
                  <button type="button" className={buttonSecondary} onClick={() => fileRef.current?.click()}>
                    <Upload className="h-4 w-4" /> Import CSV
                  </button>
                  <a
                    className={buttonGhost}
                    download="saloneledger-items-template.csv"
                    href={`data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}`}
                  >
                    <Download className="h-4 w-4" /> Template
                  </a>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])}
                  />
                </div>
                {csvNote && <p className="text-sm text-zinc-600 dark:text-zinc-400">{csvNote}</p>}
                {errors.items?.message && <p className="text-sm text-red-700">{errors.items.message}</p>}

                {items.fields.length > 0 && (
                  <ul className="flex flex-col gap-3">
                    {items.fields.map((f, i) => {
                      const e = errors.items?.[i];
                      return (
                        <li key={f.id} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-12">
                            <div className="col-span-2 sm:col-span-5">
                              <input {...register(`items.${i}.name`)} placeholder="Name" aria-label="Name" className={inputClass} />
                              {e?.name && <p className="mt-1 text-xs text-red-700">{e.name.message}</p>}
                            </div>
                            <input {...register(`items.${i}.category`)} placeholder="Category" aria-label="Category" className={clsx(inputClass, "sm:col-span-3")} list="sl-categories" />
                            <select {...register(`items.${i}.unit`)} aria-label="Unit" className={clsx(selectClass, "sm:col-span-2")}>
                              {[...new Set([...units, watchedItems[i]?.unit].filter(Boolean))].map((u) => (
                                <option key={u}>{u}</option>
                              ))}
                            </select>
                            <select {...register(`items.${i}.kind`)} aria-label="Kind" className={clsx(selectClass, "self-end sm:col-span-2")}>
                              <option value="stock">For sale</option>
                              <option value="raw_material">Material / ingredient</option>
                              <option value="service">Service</option>
                            </select>
                            <MoneyInput label="Cost price" reg={register(`items.${i}.cost_price`)} error={e?.cost_price?.message} className="sm:col-span-3" />
                            <MoneyInput label="Selling price" reg={register(`items.${i}.selling_price`)} error={e?.selling_price?.message} className="sm:col-span-3" />
                            <MoneyInput label="Re-order at" reg={register(`items.${i}.reorder_level`)} error={e?.reorder_level?.message} className="sm:col-span-2" />
                            <MoneyInput label="In stock now" reg={register(`items.${i}.opening_qty`)} error={e?.opening_qty?.message} className="sm:col-span-3" />
                            <div className="flex items-end justify-end sm:col-span-1">
                              <button type="button" onClick={() => items.remove(i)} className="rounded-lg p-2.5 text-zinc-500 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800" aria-label="Remove">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <datalist id="sl-categories">
                  {archetype.categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>

                <Field label="Cash in the till / safe today (Le)" hint="Your opening cash balance for the books. Leave blank if none." error={errors.opening_cash?.message as string | undefined} className="max-w-xs">
                  <input {...register("opening_cash")} inputMode="decimal" className={inputClass} placeholder="0" />
                </Field>
              </div>
            )}

            {step === 4 && archetype && (
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <Summary label="Business">{getValues("name")} · {getValues("location_city")}</Summary>
                <Summary label="Type">{type === "custom" ? getValues("custom_type_label") : archetype.label}</Summary>
                <Summary label="Stock locations">
                  {locationsFor(archetype, storage as never)
                    .map((l) => l.name + (l.is_default_sale ? " (sales point)" : ""))
                    .join(", ")}
                </Summary>
                <Summary label="Units">{units.join(", ")}</Summary>
                <Summary label="Payments">{["cash", ...payments.filter((p) => p !== "cash")].map((p) => PAYMENT_LABELS[p as PaymentMethod]).join(", ")}</Summary>
                <Summary label="Sales recorded by">
                  {{ staff: "Cashiers / staff", admin: "Admin only", both: "Staff and admins" }[getValues("sales_input_by")]}
                </Summary>
                <Summary label={`Starting ${terms?.items?.toLowerCase() ?? "items"}`}>
                  {watchedItems.length} · stock value {formatMoney(stockValue)}
                </Summary>
                <Summary label="Opening cash">{formatMoney(Number(getValues("opening_cash") || 0))}</Summary>
              </dl>
            )}
          </motion.div>
        </AnimatePresence>

        {serverError && (
          <p role="alert" className="mt-5 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
            <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0" />
            {serverError}
          </p>
        )}

        <div className="mt-7 flex items-center justify-between gap-3 border-t border-zinc-100 pt-5 dark:border-zinc-800">
          <button type="button" className={buttonGhost} onClick={() => go(step - 1)} disabled={step === 0 || pending}>
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          {step < STEPS.length - 1 ? (
            <button type="button" className={buttonPrimary} onClick={next}>
              {step === 3 && watchedItems.length === 0 ? "Skip for now" : "Continue"} <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button type="button" className={buttonPrimary} onClick={submit} disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Create my business
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MoneyInput({
  label,
  reg,
  error,
  className,
}: {
  label: string;
  reg: React.InputHTMLAttributes<HTMLInputElement>;
  error?: string;
  className?: string;
}) {
  return (
    <label className={clsx("flex flex-col gap-1", className)}>
      <span className="text-[11px] text-zinc-500">{label}</span>
      <input {...reg} inputMode="decimal" className={inputClass} placeholder="0" />
      {error && <span className="text-xs text-red-700">{error}</span>}
    </label>
  );
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2.5 text-sm dark:border-zinc-800">
      {label}
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="h-4 w-4 accent-brand-600" />
    </label>
  );
}

function AddUnit({ onAdd }: { onAdd: (u: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <span className="inline-flex items-center gap-1">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (value.trim()) onAdd(value.trim().toLowerCase());
            setValue("");
          }
        }}
        placeholder="Add unit…"
        className="w-28 rounded-full border border-dashed border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand-600 dark:border-zinc-700"
      />
    </span>
  );
}

function Summary({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-zinc-900 dark:text-zinc-100">{children}</dd>
    </div>
  );
}
