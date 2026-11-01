"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export type AdminUser = {
  id: string;
  email: string;
  admin: boolean;
  disabled: boolean;
  dailyLimit: number | null;
  createdAt: number;
  messagesToday: number;
  lastSeenAt: number | null;
};

/** Accounts on this server: who is signed up, what they have used today, and their allowance. */
export function AdminUsers({
  initial,
  meId,
  defaultLimit,
  openSignup,
}: {
  initial: AdminUser[];
  meId: string;
  defaultLimit: number;
  openSignup: boolean;
}) {
  const [users, setUsers] = useState(initial);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const change = async (userId: string, patch: { disabled?: boolean; dailyLimit?: number | null }) => {
    setBusy(userId);
    setError("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...patch }),
      });
      const body = (await res.json().catch(() => null)) as { users?: AdminUser[]; error?: { message?: string } } | null;
      if (!res.ok || !body?.users) throw new Error(body?.error?.message ?? `That did not work (${res.status}).`);
      setUsers(body.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy("");
    }
  };

  const askLimit = (user: AdminUser) => {
    const current = user.dailyLimit === null ? "" : String(user.dailyLimit);
    const answer = window.prompt(`Messages per day for ${user.email}. Empty uses the server default of ${defaultLimit}, 0 means no limit.`, current);
    if (answer === null) return;
    const trimmed = answer.trim();
    if (!trimmed) return void change(user.id, { dailyLimit: null });
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 0) {
      setError("Enter a whole number, or leave it empty for the default.");
      return;
    }
    void change(user.id, { dailyLimit: n });
  };

  return (
    <div className="min-h-dvh bg-[#0b0b0c] px-4 py-8 text-zinc-100 md:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
          <ArrowLeft className="size-3.5" />
          Back to chat
        </Link>
        <h1 className="mt-5 text-xl font-semibold tracking-tight">Accounts</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {users.length} {users.length === 1 ? "account" : "accounts"}. Sign-up is {openSignup ? "open" : "closed"}. The default allowance is{" "}
          {defaultLimit > 0 ? `${defaultLimit} messages a day` : "unlimited"}.
        </p>

        {error && <p className="mt-4 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-200">{error}</p>}

        <ul className="mt-6 space-y-3">
          {users.map((user) => (
            <li key={user.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate text-sm text-zinc-100">
                    {user.email}
                    {user.admin && <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400">admin</span>}
                    {user.disabled && <span className="rounded bg-red-950 px-1.5 py-0.5 text-[11px] text-red-300">off</span>}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {user.messagesToday} today of {user.dailyLimit === null ? `${defaultLimit || "unlimited"} (default)` : user.dailyLimit || "unlimited"} · joined{" "}
                    {date(user.createdAt)} · {user.lastSeenAt ? `last seen ${date(user.lastSeenAt)}` : "never signed in"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => askLimit(user)}
                    disabled={busy === user.id}
                    className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-60"
                  >
                    Limit
                  </button>
                  <button
                    type="button"
                    onClick={() => void change(user.id, { disabled: !user.disabled })}
                    disabled={busy === user.id || user.id === meId}
                    title={user.id === meId ? "This is your own account." : undefined}
                    className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
                  >
                    {user.disabled ? "Turn on" : "Turn off"}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Fixed wording in UTC: a locale-formatted date would differ between the server and the browser. */
function date(ms: number): string {
  const when = new Date(ms);
  return `${when.getUTCDate()} ${MONTHS[when.getUTCMonth()]}`;
}
