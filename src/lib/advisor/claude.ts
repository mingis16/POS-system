import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Advice } from "@/lib/types";
import type { AdvisorMetrics } from "./rules";

export const ADVISOR_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const AdviceSchema = z.object({
  summary: z.string().describe("Two or three sentences on how the business is doing this week, in plain English."),
  items: z
    .array(
      z.object({
        title: z.string(),
        detail: z.string().describe("Why, with the actual numbers from the data."),
        action: z.string().describe("One concrete thing to do, with a quantity or date where possible."),
        priority: z.enum(["high", "medium", "low"]),
        category: z.enum(["stock", "sales", "cash", "fraud", "costs", "credit", "general"]),
      }),
    )
    .describe("3 to 7 recommendations, most important first."),
});

// Stable across requests so the prefix can be cached.
const SYSTEM = `You are the business advisor inside SaloneLedger, a bookkeeping and stock app used by small and medium businesses in Sierra Leone (provision shops, supermarkets, bars, pharmacies, hardware shops, water factories, salons and more).

You receive this week's figures for one business as JSON, plus findings already computed by the app's rules engine. Write practical advice the owner can act on this week.

Rules:
- Use only numbers that are in the data. Never invent sales, prices, weather or events. You may suggest a likely reason (weekend trade, EDSA power cuts raising generator fuel use, month-end salaries, school fees, holidays, the rainy season) only as a possibility to check, not as a fact.
- Money is in new Leones; write it as "Le 1,250". Quantities use the item's unit.
- Be specific: name the item, give the quantity to re-order and the day to do it by, name the staff member or location when the data does.
- Keep the rules engine's findings that matter, merge duplicates, and add anything it missed (for example combinations: a fast-rising item that also has a thin margin).
- Treat stock shrinkage, cash shortages, repeated voids and heavy discounts as possible theft and say so plainly but fairly.
- Short sentences, no jargon, no markdown.`;

/**
 * Asks Claude to turn the metrics and rule findings into prioritised advice.
 * Returns null when no key is configured or the model declines; the caller
 * then shows the rule-based advice alone.
 */
export async function claudeAdvice(
  metrics: AdvisorMetrics,
  ruleFindings: Advice[],
): Promise<{ summary: string; items: Advice[]; model: string } | null> {
  if (!aiConfigured()) return null;
  const client = new Anthropic({ timeout: 90_000, maxRetries: 2 });

  // Keep the payload small: the items that matter most.
  const compact = {
    ...metrics,
    // Names and balances only; phone numbers stay in the app.
    top_debtors: metrics.top_debtors.map((d) => ({ name: d.name, balance: d.balance })),
    items: metrics.items.slice(0, 50).map((i) => ({
      name: i.name,
      unit: i.unit,
      kind: i.kind,
      stock: i.stock,
      sold_7d: i.sold_7d,
      sold_prev_7d: i.sold_prev_7d,
      sold_28d: i.sold_28d,
      weekend_share_28d: Number(i.sold_28d) > 0 ? Math.round((Number(i.weekend_28d) / Number(i.sold_28d)) * 100) / 100 : null,
      selling_price: i.selling_price,
      cost_price: i.cost_price,
      reorder_level: i.reorder_level,
      revenue_7d: i.revenue_7d,
      profit_7d: i.profit_7d,
      last_sold_at: i.last_sold_at,
    })),
  };

  try {
    const response = await client.beta.messages.parse({
      model: ADVISOR_MODEL,
      max_tokens: 16000,
      // Server-side fallback: if a safety classifier declines, the API re-runs the request on its recommended model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(AdviceSchema) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Business data (JSON):\n${JSON.stringify(compact)}\n\nRules-engine findings (JSON):\n${JSON.stringify(ruleFindings)}`,
        },
      ],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) return null;
    return { ...response.parsed_output, model: response.model };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) console.warn("Advisor: rate limited");
    else if (error instanceof Anthropic.AuthenticationError) console.error("Advisor: invalid ANTHROPIC_API_KEY");
    else if (error instanceof Anthropic.APIError) console.error(`Advisor: API error ${error.status}`, error.message);
    else console.error("Advisor failed", error);
    return null;
  }
}
