"use client";

import { LogOut, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { AuthAccount } from "@/lib/types";

/** Who is signed in, what they have used today, and the way out. */
export function AccountSection({ account, onRefresh }: { account: AuthAccount; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false);

  // Today's count moves while the drawer is closed.
  useEffect(onRefresh, [onRefresh]);

  const signOut = async () => {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* the cookie may already be gone */
    }
    window.location.reload();
  };

  const left = account.dailyLimit > 0 ? Math.max(0, account.dailyLimit - account.usedToday) : null;
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Account</h3>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <p className="truncate text-sm text-zinc-200">{account.email}</p>
        <p className="mt-1 text-xs text-zinc-500">
          {left === null
            ? `${account.usedToday} messages today`
            : `${account.usedToday} of ${account.dailyLimit} messages today, ${left} left. Resets at midnight UTC.`}
        </p>
        <div className="mt-4 flex items-center gap-4">
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-60"
          >
            <LogOut className="size-3.5" />
            Sign out
          </button>
          {account.admin && (
            <a href="/admin" className="flex items-center gap-1.5 text-sm text-zinc-400 underline underline-offset-2 hover:text-zinc-200">
              <ShieldCheck className="size-3.5" />
              Manage accounts
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
