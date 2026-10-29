"use client";

import { ArrowUp, ChevronDown, Globe, Paperclip, Square, SquareTerminal, type LucideIcon } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import type { PendingFile } from "@/lib/client/use-chat";
import { MODELS } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FileChips } from "./FileChips";

type Props = {
  value: string;
  onChange: (value: string) => void;
  pending: PendingFile[];
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (id: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  model: string;
  onModel: (model: string) => void;
  agent: boolean;
  onAgent: (on: boolean) => void;
  search: boolean;
  onSearch: (on: boolean) => void;
  /** Shown above the box; also blocks sending (e.g. Agent without an E2B key). */
  blocker?: { text: string; action: string; onAction: () => void } | null;
};

export function Composer(p: Props) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const canSend = !p.blocker && (p.value.trim().length > 0 || p.pending.length > 0);

  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
    el.style.overflowY = el.scrollHeight > 240 ? "auto" : "hidden";
  }, [p.value]);

  const models = MODELS.includes(p.model as (typeof MODELS)[number]) ? [...MODELS] : [...MODELS, p.model];

  return (
    <div>
      {p.blocker && (
        <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          <span>{p.blocker.text}</span>
          <button type="button" onClick={p.blocker.onAction} className="shrink-0 rounded-md border border-amber-800/60 px-2 py-1 hover:bg-amber-900/40">
            {p.blocker.action}
          </button>
        </div>
      )}
      <div data-composer className="rounded-2xl border border-zinc-800 bg-zinc-900/70 shadow-lg shadow-black/20 focus-within:border-zinc-700">
        {p.pending.length > 0 && (
          <div className="px-3 pt-3">
            <FileChips
              items={p.pending.map((f) => ({ id: f.id, name: f.file.name, size: f.file.size, kind: f.kind, previewUrl: f.previewUrl }))}
              onRemove={p.onRemoveFile}
            />
          </div>
        )}
        <textarea
          ref={textarea}
          rows={1}
          value={p.value}
          onChange={(e) => p.onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            // On touch keyboards Enter adds a new line; the send button sends.
            if (window.matchMedia("(pointer: coarse)").matches) return;
            e.preventDefault();
            if (canSend && !p.streaming) p.onSend();
          }}
          placeholder={p.agent ? "Ask the agent to build, run or fix something" : "Message Grok"}
          aria-label="Message"
          className="block max-h-60 w-full resize-none bg-transparent px-4 pb-1 pt-3 text-base leading-relaxed text-zinc-100 placeholder:text-zinc-500 focus:outline-none md:text-[15px]"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            title="Attach files"
            aria-label="Attach files"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <Paperclip className="size-4" />
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              p.onAddFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <label className="relative flex shrink-0 items-center">
            <span className="sr-only">Model</span>
            <select
              value={p.model}
              onChange={(e) => p.onModel(e.target.value)}
              className="h-8 appearance-none rounded-lg bg-transparent py-0 pl-2 pr-6 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none"
            >
              {models.map((m) => (
                <option key={m} value={m} className="bg-zinc-900 text-zinc-100">
                  {m}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-1.5 size-3.5 text-zinc-500" />
          </label>
          <Toggle on={p.search} onToggle={p.onSearch} icon={Globe} label="Search" title="Live web and X search" />
          <Toggle on={p.agent} onToggle={p.onAgent} icon={SquareTerminal} label="Agent" title="Run commands and edit files in a cloud VM" />
          <div className="ml-auto" />
          {p.streaming ? (
            <button
              type="button"
              onClick={p.onStop}
              aria-label="Stop"
              title="Stop"
              className="grid size-9 shrink-0 place-items-center rounded-full bg-zinc-100 text-zinc-900 hover:bg-white"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={p.onSend}
              disabled={!canSend}
              aria-label="Send"
              title="Send"
              className="grid size-9 shrink-0 place-items-center rounded-full bg-zinc-100 text-zinc-900 hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Toggle({ on, onToggle, icon: Icon, label, title }: { on: boolean; onToggle: (on: boolean) => void; icon: LucideIcon; label: string; title: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onToggle(!on)}
      title={title}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-xs transition-colors",
        on ? "border-zinc-600 bg-zinc-800 text-zinc-100" : "border-transparent text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200",
      )}
    >
      <Icon className="size-3.5" />
      <span>{label}</span>
    </button>
  );
}
