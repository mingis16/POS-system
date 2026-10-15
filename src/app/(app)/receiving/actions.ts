"use server";

import { redirect } from "next/navigation";
import { authorize, check, runAction, type ActionState } from "@/lib/actions";
import { receiptSchema, type ReceiptInput } from "@/lib/validation";

/** Goods in from a supplier: stock, average cost, supplier balance and the books in one call. */
export async function receiveStock(input: ReceiptInput): Promise<ActionState> {
  const result = await runAction(async () => {
    const { supabase, business } = await authorize();
    const v = receiptSchema.parse(input);
    const { error } = await supabase.rpc("receive_stock", {
      p: {
        business_id: business.id,
        supplier_id: v.supplier_id || null,
        supplier_name: v.supplier_id ? null : (v.supplier_name ?? null),
        invoice_ref: v.invoice_ref ?? null,
        location_id: v.location_id || null,
        note: v.note ?? null,
        amount_paid: v.amount_paid ?? null,
        payment_method: v.payment_method ?? "cash",
        items: v.items.map((i) => ({
          product_id: i.product_id,
          qty: i.qty,
          unit_cost: i.unit_cost,
          batch_no: i.batch_no ?? null,
          expiry_date: i.expiry_date ?? null,
          serials: (i.serials ?? "").split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean),
        })),
      },
    });
    check(error);
    return "Stock received.";
  }, "/receiving");
  if (result?.ok) redirect("/receiving?done=1");
  return result;
}
