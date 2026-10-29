"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { SandboxState } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SandboxStatus({
  sandboxId,
  state,
  busy,
  onDestroy,
}: {
  sandboxId?: string;
  state?: SandboxState;
  busy: boolean;
  onDestroy: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const current: SandboxState = sandboxId ? (state ?? "paused") : "none";
  return (
    <div className="flex items-center gap-1.5">
      <span
        title={sandboxId ? `Sandbox ${sandboxId}` : "A sandbox starts with the first Agent message"}
        className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400"
      >
        <span
          className={cn(
            "size-1.5 rounded-full",
            current === "running" ? "animate-pulse bg-emerald-400" : current === "paused" ? "bg-amber-400" : "bg-zinc-600",
          )}
        />
        <span className="hidden sm:inline">Sandbox</span>
        {current}
      </span>
      {sandboxId && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!confirming) return setConfirming(true);
            setConfirming(false);
            onDestroy();
          }}
          title="Destroy sandbox"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs disabled:opacity-40",
            confirming ? "border-red-800 bg-red-950/60 text-red-200" : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100",
          )}
        >
          <Trash2 className="size-3.5" />
          <span className={confirming ? "" : "hidden sm:inline"}>{confirming ? "Confirm" : "Destroy sandbox"}</span>
        </button>
      )}
    </div>
  );
}
