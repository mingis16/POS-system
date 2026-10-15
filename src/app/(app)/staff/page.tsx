import { KeyRound, UserPlus } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { canCreateAccounts } from "@/lib/supabase/admin";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/permissions";
import { formatDate } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { buttonPrimary, buttonSecondary, buttonSmall, inputClass, selectClass } from "@/components/ui/styles";
import { createStaffLogin, regenerateJoinCode, resetStaffPassword, updateMember } from "./actions";
import type { Membership, Role } from "@/lib/types";

export const metadata = { title: "Staff" };

export default async function StaffPage() {
  const { supabase, business, can, user } = await requireAdmin();
  const { data } = await supabase.from("memberships").select("*").eq("business_id", business.id).order("status").order("display_name");
  const members = (data ?? []) as Membership[];
  const pending = members.filter((m) => m.status === "pending");
  const roles: Role[] = can.owner ? ["owner", "admin", "cashier", "storekeeper"] : ["cashier", "storekeeper"];

  return (
    <>
      <PageHeader title="Staff" description="Who can use the system and what they may do. Staff can never delete or edit past sales." />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          {pending.length > 0 && (
            <Card title={`Waiting for approval (${pending.length})`}>
              <ul className="flex flex-col gap-3">
                {pending.map((m) => (
                  <li key={m.user_id}>
                    <ActionForm action={updateMember} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="user_id" value={m.user_id} />
                      <span className="min-w-32 flex-1 text-sm font-medium">
                        {m.display_name} <span className="text-xs text-zinc-500">{m.phone}</span>
                      </span>
                      <select name="role" defaultValue="cashier" className={`${selectClass} !w-auto !py-1.5`}>
                        {roles.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                      <SubmitButton name="status" value="active" className={`${buttonPrimary} ${buttonSmall}`}>
                        Approve
                      </SubmitButton>
                      <SubmitButton name="status" value="suspended" className={`${buttonSecondary} ${buttonSmall}`}>
                        Decline
                      </SubmitButton>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Team">
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {members
                .filter((m) => m.status !== "pending")
                .map((m) => {
                  const locked = m.role === "owner" && !can.owner;
                  const self = m.user_id === user.id;
                  return (
                    <li key={m.user_id} className="py-3">
                      <ActionForm action={updateMember} className="flex flex-wrap items-center gap-2" resetOnSuccess={false}>
                        <input type="hidden" name="user_id" value={m.user_id} />
                        <div className="min-w-40 flex-1">
                          <input name="display_name" defaultValue={m.display_name} disabled={locked} className={`${inputClass} !py-1.5`} aria-label="Name" />
                          <p className="mt-1 text-xs text-zinc-500">
                            Since {formatDate(m.created_at)} {self && "· you"}
                          </p>
                        </div>
                        <select name="role" defaultValue={m.role} disabled={locked || (!can.owner && m.role === "admin")} className={`${selectClass} !w-auto !py-1.5`}>
                          {[...new Set([...roles, m.role])].map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                        <select name="status" defaultValue={m.status} disabled={locked || self} className={`${selectClass} !w-auto !py-1.5`}>
                          <option value="active">Active</option>
                          <option value="suspended">Suspended</option>
                        </select>
                        {(locked || (!can.owner && m.role === "admin")) && <input type="hidden" name="role" value={m.role} />}
                        {(locked || self) && <input type="hidden" name="status" value={m.status} />}
                        {m.status === "suspended" && <Badge tone="critical">Suspended</Badge>}
                        {!locked && <SubmitButton className={`${buttonSecondary} ${buttonSmall}`}>Save</SubmitButton>}
                      </ActionForm>
                      {canCreateAccounts() && m.role !== "owner" && (
                        <details className="mt-1 text-xs">
                          <summary className="cursor-pointer text-zinc-500">Reset password (staff logins)</summary>
                          <ActionForm action={resetStaffPassword} className="mt-1 flex gap-2">
                            <input type="hidden" name="user_id" value={m.user_id} />
                            <input name="password" type="text" minLength={8} placeholder="New password" className={`${inputClass} !w-44 !py-1`} />
                            <SubmitButton className={`${buttonSecondary} ${buttonSmall}`}>Set</SubmitButton>
                          </ActionForm>
                        </details>
                      )}
                    </li>
                  );
                })}
            </ul>
          </Card>

          <Card title="What each role can do">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                <div key={r}>
                  <dt className="font-medium">{ROLE_LABELS[r]}</dt>
                  <dd className="text-zinc-600 dark:text-zinc-400">{ROLE_DESCRIPTIONS[r]}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card title="Joining code" description="Staff create their own account, choose 'Join as staff' and enter this code. You approve them here.">
            <p className="rounded-xl bg-zinc-100 py-3 text-center font-mono text-2xl font-bold tracking-[0.3em] dark:bg-zinc-800">{business.join_code}</p>
            {can.owner && (
              <ActionForm action={regenerateJoinCode} className="mt-3" resetOnSuccess={false}>
                <SubmitButton className={`${buttonSecondary} w-full`} confirm="Make a new code? The current code stops working.">
                  <KeyRound className="h-4 w-4" /> New code
                </SubmitButton>
              </ActionForm>
            )}
          </Card>

          <Card title="Create a staff login" description="For staff without e-mail: they sign in with a username and password you give them.">
            {canCreateAccounts() ? (
              <ActionForm action={createStaffLogin} className="flex flex-col gap-3">
                <Field label="Name">
                  <input name="display_name" required className={inputClass} />
                </Field>
                <Field label="Username" hint={`They sign in as username.${business.join_code.slice(0, 4).toLowerCase()}`}>
                  <input name="username" required pattern="[a-zA-Z0-9._\-]{3,30}" className={inputClass} placeholder="fatmata" />
                </Field>
                <Field label="Password" hint="At least 8 characters.">
                  <input name="password" type="text" minLength={8} required className={inputClass} />
                </Field>
                <Field label="Role">
                  <select name="role" className={selectClass}>
                    {roles
                      .filter((r) => r !== "owner")
                      .map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Phone">
                  <input name="phone" type="tel" className={inputClass} />
                </Field>
                <SubmitButton>
                  <UserPlus className="h-4 w-4" /> Create login
                </SubmitButton>
              </ActionForm>
            ) : (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Set <code>SUPABASE_SERVICE_ROLE_KEY</code> on the server to create logins here. Until then, use the joining code.
              </p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
