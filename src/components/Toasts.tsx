"use client";

import { X } from "lucide-react";
import { useCallback, useState } from "react";
import { cn, uid } from "@/lib/utils";

export type ToastItem = { id: string; text: string; tone: "error" | "info" };

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: string) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (text: string, opts?: { tone?: "error" | "info" }) => {
      const id = uid();
      const tone = opts?.tone ?? "info";
      setToasts((list) => [...list.slice(-3), { id, text, tone }]);
      setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4000);
    },
    [dismiss],
  );
  return { toasts, push, dismiss };
}

export function Toasts({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className={cn(
            "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg shadow-black/40",
            t.tone === "error" ? "border-red-900/60 bg-red-950/95 text-red-100" : "border-zinc-800 bg-zinc-900/95 text-zinc-100",
          )}
        >
          <p className="flex-1 leading-snug">{t.text}</p>
          <button type="button" onClick={() => onDismiss(t.id)} aria-label="Dismiss" className="-mr-1 rounded p-0.5 opacity-60 hover:opacity-100">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
