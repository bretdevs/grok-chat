"use client";

import { Plus, Settings, SquareTerminal, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Conversation } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  conversations: Conversation[];
  activeId: string | null;
  running: Record<string, unknown>;
  keyMissing: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onSettings: () => void;
  onClose?: () => void;
};

export function Sidebar(p: Props) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  useEffect(() => {
    if (!confirmId) return;
    const timer = setTimeout(() => setConfirmId(null), 3000);
    return () => clearTimeout(timer);
  }, [confirmId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className="flex-1 pl-1 text-sm font-semibold text-zinc-100">Grok Chat</span>
        {p.onClose && (
          <button type="button" onClick={p.onClose} aria-label="Close menu" className="grid size-8 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-800">
            <X className="size-4" />
          </button>
        )}
      </div>
      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={p.onNew}
          className="flex w-full items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-200 hover:border-zinc-700 hover:bg-zinc-900"
        >
          <Plus className="size-4" />
          New chat
        </button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="Conversations">
        {p.conversations.length === 0 && <p className="px-3 py-2 text-xs text-zinc-600">No conversations yet</p>}
        {p.conversations.map((c) => (
          <div
            key={c.id}
            className={cn(
              "group flex items-center rounded-lg text-sm",
              c.id === p.activeId ? "bg-zinc-800/80 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200",
            )}
          >
            <button type="button" onClick={() => p.onSelect(c.id)} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left">
              {p.running[c.id] ? (
                <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400" aria-label="Running" />
              ) : c.agent ? (
                <SquareTerminal className="size-3.5 shrink-0 text-zinc-500" aria-label="Agent" />
              ) : null}
              <span className="truncate">{c.title || "New chat"}</span>
            </button>
            <button
              type="button"
              onClick={() => (confirmId === c.id ? (setConfirmId(null), p.onDelete(c.id)) : setConfirmId(c.id))}
              aria-label={confirmId === c.id ? `Confirm delete ${c.title}` : `Delete ${c.title}`}
              title={c.sandboxId ? "Delete (also destroys its sandbox)" : "Delete"}
              className={cn(
                "mr-1 shrink-0 rounded-md px-1.5 py-1 text-xs",
                confirmId === c.id ? "bg-red-950 text-red-200" : "text-zinc-500 opacity-100 hover:text-zinc-200 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100",
              )}
            >
              {confirmId === c.id ? "Delete" : <Trash2 className="size-3.5" />}
            </button>
          </div>
        ))}
      </nav>
      <div className="border-t border-zinc-800/70 p-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        <button
          type="button"
          onClick={p.onSettings}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
        >
          <Settings className="size-4" />
          <span className="flex-1 text-left">Settings</span>
          {p.keyMissing && <span className="text-xs text-amber-400">Add API key</span>}
        </button>
      </div>
    </div>
  );
}
