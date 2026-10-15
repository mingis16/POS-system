import "server-only";
import { unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import type { Role } from "@/lib/types";

export type ActionState<T = unknown> = { ok: boolean; message?: string; error?: string; data?: T } | null;

/** An error whose message is safe to show the user. */
export class ActionError extends Error {}

/**
 * Runs a server action body and turns failures into a form message. The body
 * returns the success message (and optional data for the client).
 */
export async function runAction<T = unknown>(
  body: () => Promise<string | { message: string; data?: T }>,
  revalidate: string = "/",
): Promise<ActionState<T>> {
  try {
    const result = await body();
    revalidatePath(revalidate, "layout");
    return typeof result === "string" ? { ok: true, message: result } : { ok: true, ...result };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ActionError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) {
      const first = error.issues[0];
      return { ok: false, error: first?.message ?? "Check the form and try again." };
    }
    console.error(error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/**
 * Re-checks the session and role inside a server action. The database checks
 * again (RLS and the functions' require_role), so this is the friendly layer.
 */
export async function authorize(roles?: Role[]) {
  const ctx = await getContext();
  if (!ctx) throw new ActionError("Your session has expired. Please sign in again.");
  if (!ctx.business || !ctx.membership) throw new ActionError("Choose a business first.");
  if (roles && !roles.includes(ctx.membership.role)) {
    throw new ActionError("You do not have permission to do that.");
  }
  return ctx as typeof ctx & { business: NonNullable<typeof ctx.business>; membership: NonNullable<typeof ctx.membership> };
}

/** Throws a user-facing ActionError for a failed Supabase call. */
export function check(error: PostgrestError | null): void {
  if (!error) return;
  throw new ActionError(describeDbError(error));
}

export function describeDbError(error: Pick<PostgrestError, "code" | "message">): string {
  switch (error.code) {
    case "P0001": // raise exception in our functions — written for users
      return error.message;
    case "42501":
      return error.message.startsWith("permission denied") || error.message.includes("row-level security")
        ? "You do not have permission to do that."
        : error.message;
    case "23505":
      return "That already exists (check the name, code or barcode).";
    case "23503":
      return "This record is linked to other records, so it cannot be removed. Deactivate it instead.";
    case "23514":
      return "One of the values is out of range.";
    case "22P02":
      return "One of the values is not in the right format.";
    default:
      console.error("Supabase error", error);
      return error.message || "The database rejected the change.";
  }
}

/** FormData → plain object for Zod (repeated keys become arrays). */
export function formObject(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (key.startsWith("$ACTION")) continue;
    const v = typeof value === "string" ? value : value.name;
    if (key in out) {
      const prev = out[key];
      out[key] = Array.isArray(prev) ? [...prev, v] : [prev, v];
    } else {
      out[key] = v;
    }
  }
  return out;
}
