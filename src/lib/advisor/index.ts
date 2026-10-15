import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdviceResult } from "@/lib/types";
import { claudeAdvice } from "./claude";
import { ruleAdvice, type AdvisorMetrics } from "./rules";

/** Metrics → rule findings → (optionally) Claude's prioritised advice. */
export async function buildAdvice(supabase: SupabaseClient, businessId: string): Promise<AdviceResult> {
  const { data, error } = await supabase.rpc("advisor_metrics", { b: businessId });
  if (error) throw error;
  const metrics = data as AdvisorMetrics;
  const rules = ruleAdvice(metrics);
  const ai = rules.length ? await claudeAdvice(metrics, rules) : null;
  return ai
    ? { generated_at: new Date().toISOString(), source: "ai", model: ai.model, summary: ai.summary, items: ai.items }
    : { generated_at: new Date().toISOString(), source: "rules", items: rules };
}
