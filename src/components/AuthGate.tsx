"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import type { AuthInfo } from "@/lib/types";

type Mode = "signin" | "signup";

/** Stands in front of the app until someone signs in. Reloads on success so the page renders signed in. */
export function AuthGate({ auth }: { auth: AuthInfo }) {
  const [mode, setMode] = useState<Mode>(auth.openSignup ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!auth.ready) {
    return (
      <Shell>
        <p className="text-sm text-zinc-300">Sign-in is temporarily unavailable.</p>
        <p className="mt-2 text-sm text-zinc-500">The server cannot reach its database. Try again in a moment.</p>
      </Shell>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/auth/${mode === "signup" ? "signup" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, code }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? `That did not work (${res.status}).`);
        setBusy(false);
        return;
      }
      // The page reads the session cookie on the server, so a reload lands straight in the chat.
      window.location.reload();
    } catch {
      setError("Couldn't reach the server. Check your connection.");
      setBusy(false);
    }
  };

  const signup = mode === "signup";
  return (
    <Shell>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-xs text-zinc-400">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-xs text-zinc-400">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete={signup ? "new-password" : "current-password"}
            required
            minLength={signup ? 10 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500"
            placeholder={signup ? "At least 10 characters" : ""}
          />
        </div>
        {signup && auth.needsCode && (
          <div>
            <label htmlFor="code" className="block text-xs text-zinc-400">
              Invite code
            </label>
            <input
              id="code"
              type="text"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
            />
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-100 px-3 py-2.5 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-60"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {signup ? "Create account" : "Sign in"}
        </button>
      </form>

      {auth.openSignup ? (
        <p className="mt-5 text-center text-sm text-zinc-500">
          {signup ? "Already have an account?" : "New here?"}{" "}
          <button
            type="button"
            onClick={() => {
              setMode(signup ? "signin" : "signup");
              setError("");
            }}
            className="text-zinc-300 underline underline-offset-2 hover:text-zinc-100"
          >
            {signup ? "Sign in" : "Create an account"}
          </button>
        </p>
      ) : (
        <p className="mt-5 text-center text-sm text-zinc-500">Sign-up is closed. Ask the owner for an account.</p>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#0b0b0c] px-4 py-10 text-zinc-100">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-2xl font-semibold tracking-tight">Grok Chat</h1>
        <p className="mt-2 text-center text-sm text-zinc-400">Sign in to start chatting.</p>
        <div className="mt-7 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">{children}</div>
      </div>
    </div>
  );
}
