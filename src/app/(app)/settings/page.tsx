import { requireAdmin } from "@/lib/auth";
import { CITIES, JOB_KIND_LABELS, getArchetype } from "@/lib/archetypes";
import { PAYMENT_LABELS, PAYMENT_METHODS, formatDateTime, formatOldLeones, titleCase } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui/card";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { buttonSecondary, buttonSmall, inputClass, selectClass } from "@/components/ui/styles";
import { addCategory, addLocation, saveBusiness, saveManagerPin, saveNotifications, saveTerminology, updateLocation } from "./actions";

export const metadata = { title: "Settings" };

interface PinStatus {
  my_pin_set_at: string | null;
  managers: { user_id: string; name: string; role: string; has_pin: boolean }[];
}

export default async function SettingsPage() {
  const { supabase, business, terms, user } = await requireAdmin();
  const [{ data: locations }, { data: categories }, { data: pinData }] = await Promise.all([
    supabase.from("locations").select("*").eq("business_id", business.id).order("sort_order"),
    supabase.from("categories").select("id, name").eq("business_id", business.id).order("name"),
    supabase.rpc("manager_pin_status", { b: business.id }),
  ]);
  const pins = (pinData ?? { my_pin_set_at: null, managers: [] }) as PinStatus;
  const m = business.modules ?? {};
  const archetype = getArchetype(business.business_type);

  return (
    <>
      <PageHeader
        title="Settings"
        description={`${business.custom_type_label ?? archetype.label} · created ${new Date(business.created_at).toLocaleDateString("en-GB")}`}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Business & controls" className="lg:row-span-2">
          <ActionForm action={saveBusiness} className="grid gap-4 sm:grid-cols-2" resetOnSuccess={false}>
            <Field label="Business name" className="sm:col-span-2">
              <input name="name" defaultValue={business.name} className={inputClass} />
            </Field>
            <Field label="Town / city">
              <select name="location_city" defaultValue={business.location_city} className={selectClass}>
                {[...new Set([...CITIES, business.location_city])].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Phone">
              <input name="phone" defaultValue={business.phone ?? ""} className={inputClass} />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <input name="address" defaultValue={business.address ?? ""} className={inputClass} />
            </Field>
            <Field label="E-mail">
              <input name="email" type="email" defaultValue={business.email ?? ""} className={inputClass} />
            </Field>
            <Field label="Leones per US dollar" hint={`$1 = Le ${business.usd_rate} (${formatOldLeones(Number(business.usd_rate))}). Keep it current.`}>
              <input name="usd_rate" defaultValue={business.usd_rate} inputMode="decimal" className={inputClass} />
            </Field>
            <fieldset className="sm:col-span-2">
              <legend className="mb-2 text-sm font-medium">Payment methods accepted</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                {PAYMENT_METHODS.map((p) => (
                  <label key={p} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      name="payment_methods"
                      value={p}
                      defaultChecked={p === "cash" || business.payment_methods.includes(p)}
                      disabled={p === "cash"}
                      className="accent-brand-600"
                    />
                    {PAYMENT_LABELS[p]}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Who records sales">
              <select name="sales_input_by" defaultValue={business.sales_input_by} className={selectClass}>
                <option value="both">Staff and admins</option>
                <option value="staff">Staff (admins can too)</option>
                <option value="admin">Admins only</option>
              </select>
            </Field>
            <Field label="Stock units" hint="Comma-separated.">
              <input name="units" defaultValue={business.units.join(", ")} className={inputClass} />
            </Field>

            <p className="pt-2 text-sm font-semibold sm:col-span-2">Anti-fraud thresholds</p>
            <Field label="Max staff discount (%)" hint="Larger discounts need an admin.">
              <input name="max_staff_discount_pct" defaultValue={business.max_staff_discount_pct} inputMode="decimal" className={inputClass} />
            </Field>
            <Field label="Stock count tolerance (%)" hint="Shortages above this raise a critical alert.">
              <input name="stock_variance_tolerance_pct" defaultValue={business.stock_variance_tolerance_pct} inputMode="decimal" className={inputClass} />
            </Field>
            <Field label="Cash-up tolerance (Le)" hint="Differences within this are not flagged.">
              <input name="cash_variance_tolerance" defaultValue={business.cash_variance_tolerance} inputMode="decimal" className={inputClass} />
            </Field>
            <Field label="Flag staff expenses from (Le)">
              <input name="staff_expense_alert_amount" defaultValue={business.staff_expense_alert_amount} inputMode="decimal" className={inputClass} />
            </Field>
            <Field label="Staff may backdate expenses (days)">
              <input name="staff_backdate_days" defaultValue={business.staff_backdate_days} inputMode="numeric" className={inputClass} />
            </Field>
            <Field label="Dead stock after (days unsold)">
              <input name="dead_stock_days" defaultValue={business.dead_stock_days} inputMode="numeric" className={inputClass} />
            </Field>
            <Field label="Opening time" hint="Sales outside hours are flagged.">
              <input name="opening_time" type="time" defaultValue={business.opening_time?.slice(0, 5) ?? ""} className={inputClass} />
            </Field>
            <Field label="Closing time" hint="Bars/clubs: closing can be after midnight.">
              <input name="closing_time" type="time" defaultValue={business.closing_time?.slice(0, 5) ?? ""} className={inputClass} />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton>Save settings</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card title="Stock locations" description="Shelves, freezers, cold rooms, stores, vehicles. Each is counted and reconciled separately.">
          <ul className="mb-4 divide-y divide-zinc-100 dark:divide-zinc-800">
            {(locations ?? []).map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className={l.is_active ? "" : "text-zinc-400 line-through"}>
                  {l.name} <span className="text-xs text-zinc-400">{titleCase(l.kind)}</span>
                  {l.is_default_sale && (
                    <Badge tone="brand" className="ml-2">
                      sales point
                    </Badge>
                  )}
                </span>
                <ActionForm action={updateLocation} className="flex gap-1" showSuccess={false}>
                  <input type="hidden" name="id" value={l.id} />
                  {!l.is_default_sale && (
                    <>
                      <SubmitButton name="op" value="default" className={`${buttonSecondary} ${buttonSmall}`}>
                        Sell from here
                      </SubmitButton>
                      <SubmitButton name="op" value={l.is_active ? "deactivate" : "activate"} className={`${buttonSecondary} ${buttonSmall}`}>
                        {l.is_active ? "Turn off" : "Turn on"}
                      </SubmitButton>
                    </>
                  )}
                </ActionForm>
              </li>
            ))}
          </ul>
          <ActionForm action={addLocation} className="flex flex-wrap gap-2">
            <input name="name" placeholder="e.g. Cold room 2" required className={`${inputClass} !w-44`} />
            <select name="kind" className={`${selectClass} !w-auto`}>
              {["shelf", "freezer", "cold_store", "warehouse", "store_room", "vehicle", "other"].map((k) => (
                <option key={k} value={k}>
                  {titleCase(k)}
                </option>
              ))}
            </select>
            <SubmitButton className={buttonSecondary}>Add</SubmitButton>
          </ActionForm>
        </Card>

        <Card
          title="Manager PIN"
          description="Every return, refund and exchange needs an owner's or admin's 4-digit PIN at the till. Each manager sets their own; it is stored encrypted and nobody can read it back."
        >
          <p className="mb-3 text-sm">
            Your PIN:{" "}
            {pins.my_pin_set_at ? (
              <Badge tone="good">Set {formatDateTime(pins.my_pin_set_at)}</Badge>
            ) : (
              <Badge tone="warning">Not set — you cannot approve returns yet</Badge>
            )}
          </p>
          <ActionForm action={saveManagerPin} className="grid gap-3 sm:grid-cols-2">
            <Field label={pins.my_pin_set_at ? "New PIN" : "PIN"} hint="4 digits. Not 1234, 0000 and the like.">
              <input name="pin" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="new-password" required className={inputClass} />
            </Field>
            <Field label="Repeat PIN">
              <input name="confirm" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="new-password" required className={inputClass} />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton className={buttonSecondary}>{pins.my_pin_set_at ? "Change PIN" : "Set PIN"}</SubmitButton>
            </div>
          </ActionForm>
          {pins.managers.length > 1 && (
            <ul className="mt-4 flex flex-col gap-1 border-t border-zinc-100 pt-3 text-sm dark:border-zinc-800">
              {pins.managers
                .filter((m) => m.user_id !== user.id)
                .map((m) => (
                  <li key={m.user_id} className="flex justify-between gap-2">
                    <span>{m.name}</span>
                    {m.has_pin ? <Badge tone="good">PIN set</Badge> : <Badge>No PIN</Badge>}
                  </li>
                ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-zinc-500">Five wrong PINs in 15 minutes lock that PIN for 15 minutes and alert you. Setting a new PIN unlocks it.</p>
        </Card>

        <Card title="Alerts by SMS / WhatsApp" description="Critical alerts (cash shortages, stock missing, repeated voids) and low stock go to this number.">
          <ActionForm action={saveNotifications} className="grid gap-3 sm:grid-cols-2" resetOnSuccess={false}>
            <Field label="Phone number">
              <input name="phone" type="tel" defaultValue={business.notify?.phone ?? ""} placeholder="+23276123456" className={inputClass} />
            </Field>
            <Field label="Send by">
              <select name="channel" defaultValue={business.notify?.channel ?? "whatsapp"} className={selectClass}>
                <option value="whatsapp">WhatsApp</option>
                <option value="sms">SMS</option>
              </select>
            </Field>
            <Field label="Send">
              <select name="min_severity" defaultValue={business.notify?.min_severity ?? "critical"} className={selectClass}>
                <option value="critical">Critical alerts only</option>
                <option value="warning">Critical and warnings</option>
              </select>
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" name="low_stock" defaultChecked={business.notify?.low_stock ?? true} className="accent-brand-600" /> Low-stock alerts too
            </label>
            <p className="text-xs text-zinc-500 sm:col-span-2">Requires an SMS/WhatsApp provider in the server settings (see README → Notifications).</p>
            <div className="sm:col-span-2">
              <SubmitButton className={buttonSecondary}>Save</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card title="Words & features" description="Rename things to match how your business talks, and switch features on or off.">
          <ActionForm action={saveTerminology} className="flex flex-col gap-4" resetOnSuccess={false}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(["item", "items", "sale", "sales", "customer", "customers", "job", "jobs"] as const).map((k) => (
                <Field key={k} label={`"${k}"`}>
                  <input name={k} defaultValue={terms[k] ?? ""} className={inputClass} />
                </Field>
              ))}
            </div>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              {(
                [
                  ["serials", "Serial / IMEI tracking"],
                  ["batches", "Batches & expiry dates"],
                  ["warranty", "Warranties"],
                  ["services", "Services"],
                  ["commissions", "Staff commissions"],
                  ["production", "Production runs"],
                  ["usage", "Stock usage (materials)"],
                  ["wholesale", "Wholesale prices"],
                  ["tables", "Tables / order types"],
                  ["prescriptions", "Prescriptions (Rx)"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="checkbox" name={`m.${k}`} defaultChecked={Boolean(m[k])} className="accent-brand-600" /> {label}
                </label>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Jobs module">
                <select name="m.jobs" defaultValue={m.jobs ?? ""} className={selectClass}>
                  <option value="">Off</option>
                  {Object.entries(JOB_KIND_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.many}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Serial number label">
                <input name="m.serialLabel" defaultValue={m.serialLabel ?? ""} placeholder="IMEI, VIN, Serial number" className={inputClass} />
              </Field>
            </div>
            <div>
              <SubmitButton className={buttonSecondary}>Save</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card title="Categories">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {(categories ?? []).map((c) => (
              <Badge key={c.id}>{c.name}</Badge>
            ))}
          </div>
          <ActionForm action={addCategory} className="flex gap-2">
            <input name="name" placeholder="New category" className={inputClass} />
            <SubmitButton className={buttonSecondary}>Add</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
