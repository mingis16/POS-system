"use server";

import { z } from "zod";
import { authorize, check, runAction, type ActionState } from "@/lib/actions";
import { amount } from "@/lib/validation";

const schema = z.object({
  product_id: z.string().uuid("Choose what was produced."),
  qty: amount("Quantity produced", { allowZero: false }),
  location_id: z.string().uuid().optional().or(z.literal("")),
  batch_no: z.string().trim().max(40).optional(),
  expiry_date: z.string().optional(),
  note: z.string().trim().max(300).optional(),
  inputs: z.array(z.object({ product_id: z.string().uuid("Choose a material."), qty: amount("Material quantity", { allowZero: false }) })),
});

export async function recordProduction(input: z.input<typeof schema>): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize(["owner", "admin", "storekeeper"]);
    const v = schema.parse(input);
    const { error } = await supabase.rpc("record_production", {
      p: { business_id: business.id, ...v, location_id: v.location_id || null, expiry_date: v.expiry_date || null },
    });
    check(error);
    return "Production recorded: materials used and finished goods added.";
  }, "/production");
}
