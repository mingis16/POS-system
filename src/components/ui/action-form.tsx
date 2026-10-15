"use client";

import { clsx } from "clsx";
import { createContext, startTransition, useActionState, useContext, useEffect, useRef } from "react";
import { AlertOctagon, CheckCircle2, Loader2 } from "lucide-react";
import type { ActionState } from "@/lib/actions";
import { buttonPrimary } from "./styles";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

const PendingContext = createContext(false);

/**
 * A form bound to a server action. Keeps the user's input when the action
 * fails (React would otherwise reset the form) and shows the result inline.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = true,
  showSuccess = true,
  onSuccess,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  showSuccess?: boolean;
  onSuccess?: (state: ActionState) => void;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  });

  useEffect(() => {
    if (state?.ok) {
      if (resetOnSuccess) formRef.current?.reset();
      onSuccessRef.current?.(state);
    }
  }, [state, resetOnSuccess]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => formAction(formData));
  }

  return (
    <PendingContext.Provider value={pending}>
      <form ref={formRef} onSubmit={handleSubmit} className={className}>
        {children}
        <FormMessage state={state} showSuccess={showSuccess} />
      </form>
    </PendingContext.Provider>
  );
}

export function FormMessage({ state, showSuccess = true }: { state: ActionState; showSuccess?: boolean }) {
  if (!state) return null;
  if (state.ok) {
    if (!showSuccess || !state.message) return null;
    return (
      <p role="status" className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
        <CheckCircle2 aria-hidden className="h-4 w-4 shrink-0 text-good" />
        {state.message}
      </p>
    );
  }
  return (
    <p role="alert" className="flex items-start gap-1.5 text-sm text-red-700 dark:text-red-400">
      <AlertOctagon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-critical" />
      {state.error}
    </p>
  );
}

export function SubmitButton({
  children,
  className = buttonPrimary,
  name,
  value,
  confirm,
  disabled,
}: {
  children: React.ReactNode;
  className?: string;
  name?: string;
  value?: string;
  confirm?: string;
  disabled?: boolean;
}) {
  const pending = useContext(PendingContext);
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending || disabled}
      className={clsx(className)}
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      {pending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}
