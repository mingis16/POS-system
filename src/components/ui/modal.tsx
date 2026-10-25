"use client";

import { clsx } from "clsx";
import { motion } from "framer-motion";
import { X } from "lucide-react";

/**
 * A bottom sheet on phones and a centred dialog on wider screens. Render it
 * inside <AnimatePresence> so it animates out.
 */
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <>
      <motion.div className="no-print fixed inset-0 z-40 bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx(
          "fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-4",
          wide ? "sm:w-[600px]" : "sm:w-[440px]",
        )}
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        transition={{ type: "spring", stiffness: 420, damping: 36 }}
      >
        <div className="no-print mb-3 flex items-center justify-between gap-3">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </motion.div>
    </>
  );
}
