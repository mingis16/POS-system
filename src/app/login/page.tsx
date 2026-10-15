import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { inputClass } from "@/components/ui/styles";
import { AuthCard, NotConfigured } from "@/components/shell/auth-card";
import { signIn } from "@/app/auth/actions";
import { connection } from "next/server";
import { isConfigured } from "@/lib/auth";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await connection();
  const { next } = await searchParams;
  return (
    <AuthCard
      title="Sign in"
      subtitle="Owners use their e-mail. Staff use the username their manager gave them."
      footer={
        <>
          New business?{" "}
          <Link href="/signup" className="font-medium text-brand-700 hover:underline dark:text-brand-500">
            Create an account
          </Link>
        </>
      }
    >
      {!isConfigured() && <NotConfigured />}
      <ActionForm action={signIn} className="flex flex-col gap-4" resetOnSuccess={false}>
        <input type="hidden" name="next" value={next ?? ""} />
        <Field label="E-mail or staff username" htmlFor="login">
          <input id="login" name="login" autoComplete="username" required className={inputClass} placeholder="you@example.com or fatmata.k2qx" />
        </Field>
        <Field label="Password" htmlFor="password">
          <input id="password" name="password" type="password" autoComplete="current-password" required className={inputClass} />
        </Field>
        <SubmitButton>Sign in</SubmitButton>
      </ActionForm>
    </AuthCard>
  );
}
