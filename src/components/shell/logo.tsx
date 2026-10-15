import { clsx } from "clsx";

export function Logo({ className }: { className?: string }) {
  // Green-white-blue: the Sierra Leone flag as a ledger mark.
  return (
    <svg viewBox="0 0 32 32" className={clsx("h-8 w-8 shrink-0", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#0e9a5a" />
      <rect x="6" y="9" width="20" height="4" rx="2" fill="#ffffff" />
      <rect x="6" y="15" width="20" height="4" rx="2" fill="#ffffff" opacity="0.85" />
      <rect x="6" y="21" width="12" height="4" rx="2" fill="#0072c6" />
    </svg>
  );
}
