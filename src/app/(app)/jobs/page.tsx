import { Wrench } from "lucide-react";
import { requireCapability } from "@/lib/auth";
import { JOB_KIND_LABELS } from "@/lib/archetypes";
import { PAYMENT_LABELS, formatDate, formatDateTime, formatMoney, titleCase } from "@/lib/format";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { Badge, type Tone } from "@/components/ui/badge";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { buttonSecondary, buttonSmall, inputClass, selectClass } from "@/components/ui/styles";
import { createJob, recordJobPayment, updateJobStatus } from "./actions";
import type { Job, JobKind, JobStatus, PaymentMethod } from "@/lib/types";

export const metadata = { title: "Jobs" };

const STATUS_TONE: Record<JobStatus, Tone> = {
  pending: "neutral",
  scheduled: "info",
  in_progress: "warning",
  ready: "brand",
  completed: "good",
  cancelled: "neutral",
};

/** Extra fields per kind of job, stored in jobs.details. */
const DETAIL_FIELDS: Partial<Record<JobKind, { key: string; label: string; placeholder?: string }[]>> = {
  repair: [
    { key: "fault", label: "Fault reported", placeholder: "Cracked screen, not charging…" },
    { key: "accessories", label: "Left with us", placeholder: "Phone only / with charger" },
  ],
  installation: [
    { key: "address", label: "Site address" },
    { key: "system", label: "System", placeholder: "5 kVA inverter + 4 panels" },
  ],
  delivery: [
    { key: "vehicle", label: "Vehicle", placeholder: "AKP 123" },
    { key: "driver", label: "Driver" },
    { key: "loaded", label: "Loaded (bags/cases)" },
    { key: "returned", label: "Returned unsold" },
    { key: "route", label: "Route / customers" },
  ],
  service: [
    { key: "vehicle", label: "Vehicle reg / VIN" },
    { key: "mileage", label: "Mileage (km)" },
  ],
  custom_order: [
    { key: "dimensions", label: "Size / dimensions" },
    { key: "materials", label: "Wood / fabric / finish" },
  ],
  booking: [{ key: "service", label: "Service wanted", placeholder: "Knotless braids, medium" }],
};

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { supabase, business, terms } = await requireCapability("jobs");
  const kind = (business.modules?.jobs ?? "general") as JobKind;
  const one = terms.job ?? JOB_KIND_LABELS[kind].one;
  const many = terms.jobs ?? JOB_KIND_LABELS[kind].many;
  const { status } = await searchParams;

  let q = supabase.from("jobs").select("*").eq("business_id", business.id).order("created_at", { ascending: false }).limit(200);
  if (status === "open" || !status) q = q.not("status", "in", "(completed,cancelled)");
  else if (status !== "all") q = q.eq("status", status);
  const [{ data }, { data: staff }] = await Promise.all([
    q,
    supabase.from("memberships").select("user_id, display_name").eq("business_id", business.id).eq("status", "active").order("display_name"),
  ]);
  const jobs = (data ?? []) as Job[];
  const who = new Map((staff ?? []).map((s) => [s.user_id, s.display_name]));
  const methods = ["cash", ...business.payment_methods.filter((m) => m !== "cash" && m !== "credit")] as PaymentMethod[];
  const fields = DETAIL_FIELDS[kind] ?? [];

  return (
    <>
      <PageHeader title={many} description={`Track each ${one.toLowerCase()} from start to finish, with payments taken along the way.`} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title={`New ${one.toLowerCase()}`}>
          <ActionForm action={createJob} className="flex flex-col gap-3">
            <input type="hidden" name="kind" value={kind} />
            <Field label="Title">
              <input name="title" required className={inputClass} placeholder={kind === "repair" ? "Tecno Spark 10 – screen" : kind === "booking" ? "Braids for Mariama" : ""} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={terms.customer}>
                <input name="customer_name" className={inputClass} />
              </Field>
              <Field label="Phone">
                <input name="customer_phone" type="tel" className={inputClass} />
              </Field>
            </div>
            {(kind === "repair" || kind === "service" || kind === "installation") && (
              <Field label={kind === "repair" ? "IMEI / serial" : kind === "service" ? "VIN / reg no." : "Serial no(s)."}>
                <input name="item_ref" className={`${inputClass} font-mono`} />
              </Field>
            )}
            {fields.map((f) => (
              <Field key={f.key} label={f.label}>
                <input name={`details.${f.key}`} placeholder={f.placeholder} className={inputClass} />
              </Field>
            ))}
            <Field label="Notes">
              <textarea name="description" rows={2} className={inputClass} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={kind === "booking" ? "Appointment" : "Scheduled for"}>
                <input name="scheduled_for" type="datetime-local" className={inputClass} />
              </Field>
              <Field label="Due / ready by">
                <input name="due_date" type="date" className={inputClass} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Assigned to">
                <select name="assigned_to" className={selectClass}>
                  <option value="">—</option>
                  {(staff ?? []).map((s) => (
                    <option key={s.user_id} value={s.user_id}>
                      {s.display_name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Price quoted (Le)">
                <input name="quoted_amount" inputMode="decimal" className={inputClass} />
              </Field>
            </div>
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </Card>

        <div className="flex flex-col gap-3 lg:col-span-2">
          <form className="flex gap-2">
            <select name="status" defaultValue={status ?? "open"} className={`${selectClass} !w-auto !py-1.5`}>
              <option value="open">Open</option>
              <option value="ready">Ready</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
              <option value="all">All</option>
            </select>
            <button className={buttonSecondary}>Show</button>
          </form>
          {jobs.length === 0 ? (
            <Card>
              <EmptyState icon={Wrench} title={`No ${many.toLowerCase()} here`} />
            </Card>
          ) : (
            jobs.map((j) => {
              const balance = j.quoted_amount !== null ? Number(j.quoted_amount) - Number(j.amount_paid) : null;
              return (
                <Card key={j.id} bodyClassName="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">
                        <span className="text-zinc-400">#{j.job_no}</span> {j.title}
                      </p>
                      <p className="text-sm text-zinc-500">
                        {[j.customer_name, j.customer_phone, j.item_ref].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                    <Badge tone={STATUS_TONE[j.status]}>{titleCase(j.status)}</Badge>
                  </div>
                  {(j.description || Object.keys(j.details ?? {}).length > 0) && (
                    <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                      {Object.entries(j.details ?? {}).map(([k, v]) => (
                        <div key={k}>
                          <dt className="inline text-zinc-500">{titleCase(k)}: </dt>
                          <dd className="inline">{v}</dd>
                        </div>
                      ))}
                      {j.description && <p className="text-zinc-600 sm:col-span-2 dark:text-zinc-400">{j.description}</p>}
                    </dl>
                  )}
                  <p className="mt-2 text-xs text-zinc-500">
                    {j.scheduled_for && `${formatDateTime(j.scheduled_for)} · `}
                    {j.due_date && `due ${formatDate(j.due_date)} · `}
                    {j.assigned_to && `${who.get(j.assigned_to) ?? ""} · `}
                    {j.quoted_amount !== null ? `quoted ${formatMoney(j.quoted_amount)}, paid ${formatMoney(j.amount_paid)}` : `paid ${formatMoney(j.amount_paid)}`}
                    {balance !== null && balance > 0 && <span className="font-medium text-amber-700"> · balance {formatMoney(balance)}</span>}
                  </p>
                  {j.status !== "completed" && j.status !== "cancelled" && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                      <ActionForm action={updateJobStatus} className="flex gap-1.5" showSuccess={false}>
                        <input type="hidden" name="id" value={j.id} />
                        <select name="status" defaultValue={j.status} className={`${selectClass} !w-auto !py-1`}>
                          {(["pending", "scheduled", "in_progress", "ready", "completed", "cancelled"] as const).map((s) => (
                            <option key={s} value={s}>
                              {titleCase(s)}
                            </option>
                          ))}
                        </select>
                        <SubmitButton className={`${buttonSecondary} ${buttonSmall}`}>Update</SubmitButton>
                      </ActionForm>
                      <ActionForm action={recordJobPayment} className="flex gap-1.5">
                        <input type="hidden" name="job_id" value={j.id} />
                        <input name="amount" inputMode="decimal" placeholder="Payment" required className={`${inputClass} !w-24 !py-1`} />
                        <select name="method" className={`${selectClass} !w-auto !py-1`}>
                          {methods.map((m) => (
                            <option key={m} value={m}>
                              {PAYMENT_LABELS[m]}
                            </option>
                          ))}
                        </select>
                        <SubmitButton className={`${buttonSecondary} ${buttonSmall}`}>Take payment</SubmitButton>
                      </ActionForm>
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
