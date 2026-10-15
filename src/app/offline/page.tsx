import Link from "next/link";
import { WifiOff } from "lucide-react";
import { buttonPrimary } from "@/components/ui/styles";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <WifiOff className="h-10 w-10 text-zinc-400" />
      <h1 className="text-xl font-semibold">You are offline</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        This page has not been saved on this device yet. The till still works offline: open it and keep selling —
        sales are stored on the phone and sent automatically when the network returns.
      </p>
      <Link href="/pos" className={buttonPrimary}>
        Open the till
      </Link>
    </main>
  );
}
