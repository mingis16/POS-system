// Shared Tailwind class strings so forms, buttons and tables look the same everywhere.

export const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-[15px] text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-brand-600 focus:ring-2 focus:ring-brand-100 disabled:bg-zinc-50 disabled:text-zinc-500 sm:text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-brand-500 dark:focus:ring-brand-800/40 dark:disabled:bg-zinc-900/50";

export const selectClass = inputClass + " pr-8";

export const labelClass = "text-sm font-medium text-zinc-700 dark:text-zinc-300";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";

export const buttonPrimary = `${buttonBase} bg-brand-600 text-white hover:bg-brand-700 dark:bg-brand-500 dark:text-zinc-950 dark:hover:bg-brand-600`;
export const buttonSecondary = `${buttonBase} border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800`;
export const buttonGhost = `${buttonBase} text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800`;
export const buttonDanger = `${buttonBase} border border-red-200 bg-white text-red-700 hover:bg-red-50 dark:border-red-900 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-red-950`;
export const buttonSmall = "!px-2.5 !py-1.5 !text-xs";

export const cardClass =
  "rounded-2xl border border-zinc-200 bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:border-zinc-800";

export const tableClass = "w-full text-left text-sm";
export const thClass =
  "whitespace-nowrap border-b border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400";
export const tdClass =
  "whitespace-nowrap border-b border-zinc-100 px-3 py-2.5 text-zinc-700 dark:border-zinc-800/60 dark:text-zinc-300";
export const numClass = "text-right tabular-nums";
