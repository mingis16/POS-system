"use client";

import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { inputClass } from "@/components/ui/styles";
import { joinBusiness } from "@/app/onboarding/actions";

export function JoinForm({ defaultName }: { defaultName: string }) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-zinc-200 bg-surface p-6 shadow-sm dark:border-zinc-800">
      <h1 className="text-xl font-semibold tracking-tight">Join your workplace</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Ask the owner or manager for the 8-character joining code (Settings → Staff). They approve you and choose your role.
      </p>
      <ActionForm action={joinBusiness} className="mt-5 flex flex-col gap-4" resetOnSuccess={false}>
        <Field label="Joining code">
          <input name="code" required autoCapitalize="characters" className={`${inputClass} font-mono uppercase tracking-widest`} placeholder="AB12CD34" />
        </Field>
        <Field label="Your name (as your manager knows you)">
          <input name="name" required defaultValue={defaultName} className={inputClass} />
        </Field>
        <Field label="Phone (optional)">
          <input name="phone" type="tel" className={inputClass} />
        </Field>
        <SubmitButton>Send request</SubmitButton>
      </ActionForm>
    </div>
  );
}
