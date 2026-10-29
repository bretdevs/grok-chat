"use client";

import { Code2, Loader2, Search } from "lucide-react";
import type { ToolTrace } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Card for a tool xAI ran on its side (web search, X search, code interpreter). */
export function SearchTrace({ trace, live }: { trace: ToolTrace; live: boolean }) {
  const running = live && (trace.status === "running" || trace.status === "pending");
  const failed = trace.status === "error";
  const label = labelFor(trace, running);
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-3 py-2 text-[13px]">
      {running ? (
        <Loader2 className="size-4 shrink-0 animate-spin text-zinc-400" />
      ) : trace.provider === "x" ? (
        <span className="grid size-4 shrink-0 place-items-center text-[12px] font-bold leading-none text-zinc-400">X</span>
      ) : trace.provider === "code" ? (
        <Code2 className={cn("size-4 shrink-0", failed ? "text-red-400" : "text-zinc-500")} />
      ) : (
        <Search className={cn("size-4 shrink-0", failed ? "text-red-400" : "text-zinc-500")} />
      )}
      <span className="shrink-0 text-zinc-300">{label}</span>
      {trace.preview && (
        <span className="min-w-0 flex-1 truncate text-zinc-500" title={trace.preview}>
          {trace.preview}
        </span>
      )}
      <span className="ml-auto shrink-0 rounded border border-zinc-800 px-1.5 py-px text-[10px] uppercase tracking-wide text-zinc-500">
        {trace.provider === "x" ? "X" : trace.provider === "code" ? "code" : "web"}
      </span>
    </div>
  );
}

function labelFor(trace: ToolTrace, running: boolean): string {
  if (trace.provider === "code") return running ? "Running Python…" : "Ran Python";
  if (trace.provider === "x") return trace.name || "X search";
  if (running && trace.name === "Web search") return "Searching…";
  return trace.name || "Web search";
}
