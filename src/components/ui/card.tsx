import { clsx } from "clsx";
import { cardClass } from "./styles";

export function Card({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx(cardClass, className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3 sm:px-5 dark:border-zinc-800/70">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={clsx("p-4 sm:p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 sm:text-2xl dark:text-zinc-50">{title}</h1>
        {description && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      {Icon && <Icon className="h-8 w-8 text-zinc-300 dark:text-zinc-600" />}
      <p className="font-medium text-zinc-700 dark:text-zinc-300">{title}</p>
      {children && <div className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">{children}</div>}
    </div>
  );
}

/** Horizontally scrollable table wrapper so wide tables never push the page sideways on phones. */
export function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="-mx-4 overflow-x-auto sm:-mx-5">{children}</div>;
}
