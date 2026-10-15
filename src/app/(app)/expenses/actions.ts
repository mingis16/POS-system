"use server";

import { z } from "zod";
import { authorize, check, formObject, runAction, type ActionState } from "@/lib/actions";
import { ADMIN_ROLES } from "@/lib/permissions";
import { expenseSchema } from "@/lib/validation";

export async function recordExpense(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize();
    const v = expenseSchema.parse(formObject(form));
    const { error } = await supabase.rpc("record_expense", {
      p: { business_id: business.id, ...v, expense_date: v.expense_date || null },
    });
    check(error);
    return "Expense recorded.";
  }, "/expenses");
}

export async function voidExpense(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(ADMIN_ROLES);
    const id = z.string().uuid().parse(form.get("id"));
    const reason = z.string().trim().min(3, "Give a reason.").parse(form.get("reason"));
    const { error } = await supabase.rpc("void_expense", { p_expense: id, p_reason: reason });
    check(error);
    return "Expense voided and reversed in the books.";
  }, "/expenses");
}

export async function addExpenseCategory(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize(ADMIN_ROLES);
    const name = z.string().trim().min(2, "Enter a name.").max(80).parse(form.get("name"));
    const { count } = await supabase.from("accounts").select("id", { count: "exact", head: true }).eq("business_id", business.id).like("code", "6%");
    const { error } = await supabase.from("accounts").insert({
      business_id: business.id,
      code: `6${String((count ?? 0) + 101).padStart(3, "0")}`,
      name,
      type: "expense",
      is_expense_category: true,
    });
    check(error);
    return "Category added.";
  }, "/expenses");
}
