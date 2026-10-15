import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { inputClass } from "@/components/ui/styles";
import { AuthCard, NotConfigured } from "@/components/shell/auth-card";
import { signUp } from "@/app/auth/actions";
import { connection } from "next/server";
import { isConfigured } from "@/lib/auth";

export const metadata = { title: "Create account" };

export default async function SignupPage() {
  await connection();
  return (
    <AuthCard
      title="Create your account"
      subtitle="Next you'll set up your business — or join one with a code from your manager."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-brand-700 hover:underline dark:text-brand-500">
            Sign in
          </Link>
        </>
      }
    >
      {!isConfigured() && <NotConfigured />}
      <ActionForm action={signUp} className="flex flex-col gap-4" resetOnSuccess={false}>
        <Field label="Full name" htmlFor="full_name">
          <input id="full_name" name="full_name" autoComplete="name" required className={inputClass} />
        </Field>
        <Field label="E-mail" htmlFor="email">
          <input id="email" name="email" type="email" autoComplete="email" required className={inputClass} />
        </Field>
        <Field label="Phone (optional)" htmlFor="phone" hint="For WhatsApp/SMS alerts later.">
          <input id="phone" name="phone" type="tel" autoComplete="tel" className={inputClass} placeholder="+232 76 123456" />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 8 characters.">
          <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required className={inputClass} />
        </Field>
        <SubmitButton>Create account</SubmitButton>
      </ActionForm>
    </AuthCard>
  );
}
