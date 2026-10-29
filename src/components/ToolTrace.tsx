"use client";

import {
  ChevronRight,
  Download,
  FilePen,
  FilePlus,
  FileText,
  FolderOpen,
  Globe,
  Loader2,
  SquareTerminal,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useBlobUrl } from "@/lib/client/blob-store";
import type { ToolTrace as Trace } from "@/lib/types";
import { cn, formatBytes } from "@/lib/utils";

/** Collapsible card for a sandbox tool call: command, file operation, page or delivery. */
export function ToolTrace({ trace, live }: { trace: Trace; live: boolean }) {
  const [open, setOpen] = useState(false);
  const running = live && (trace.status === "running" || trace.status === "pending");
  const failed = trace.status === "error";
  const { icon: Icon, title } = describe(trace);
  const shot = useBlobUrl(trace.screenshotKey);
  const tail = running && trace.output ? lastLines(trace.output, 3) : "";

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/40 text-[13px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-zinc-900/80"
      >
        {running ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-zinc-400" />
        ) : (
          <Icon className={cn("size-4 shrink-0", failed ? "text-red-400" : "text-zinc-500")} />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-zinc-300">{title}</span>
        <span className={cn("shrink-0 text-xs", failed ? "text-red-400" : "text-zinc-500")}>{badge(trace, running)}</span>
        <ChevronRight className={cn("size-4 shrink-0 text-zinc-600 transition-transform", open && "rotate-90")} />
      </button>
      {tail && !open && (
        <pre className="whitespace-pre-wrap break-all border-t border-zinc-800/60 px-3 py-1.5 font-mono text-[11.5px] leading-relaxed text-zinc-500">
          {tail}
        </pre>
      )}
      {shot && (
        <a href={shot} target="_blank" rel="noopener noreferrer" className="block border-t border-zinc-800/60">
          {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
          <img src={shot} alt="Browser screenshot" className="max-h-72 w-full object-cover object-top" />
        </a>
      )}
      {open && (
        <div className="border-t border-zinc-800/60 px-3 py-2.5">
          <Details trace={trace} />
        </div>
      )}
    </div>
  );
}

function describe(trace: Trace): { icon: LucideIcon; title: string } {
  const a = trace.args ?? {};
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  switch (trace.name) {
    case "run_terminal_cmd":
      return { icon: SquareTerminal, title: s(a.command) ? `$ ${firstLine(s(a.command))}` : "$ …" };
    case "file": {
      const action = s(a.action);
      const icon = action === "write" ? FilePlus : action === "edit" ? FilePen : action === "list" ? FolderOpen : action === "delete" ? Trash2 : FileText;
      return { icon, title: action ? `file ${action} ${s(a.path)}` : "file …" };
    }
    case "browser_open":
      return { icon: Globe, title: s(a.url) ? `open ${s(a.url)}` : "open …" };
    case "get_sandbox_files": {
      const paths = Array.isArray(a.paths) ? a.paths.map((p) => String(p).split("/").pop()) : [];
      return { icon: Download, title: paths.length ? `deliver ${paths.join(", ")}` : "deliver …" };
    }
    default:
      return { icon: SquareTerminal, title: trace.name };
  }
}

function badge(trace: Trace, running: boolean): string {
  if (running) return trace.status === "pending" ? "preparing" : "running";
  const r = trace.result ?? {};
  const duration = trace.durationMs !== undefined ? formatDuration(trace.durationMs) : "";
  if (trace.name === "run_terminal_cmd") {
    if (r.timedOut) return "timed out";
    if (typeof r.exitCode === "number") return [`exit ${r.exitCode}`, duration].filter(Boolean).join(" · ");
  }
  if (trace.status === "error") return "failed";
  return duration;
}

function Details({ trace }: { trace: Trace }) {
  const a = trace.args ?? {};
  const r = trace.result ?? {};
  const error = typeof r.error === "string" ? r.error : undefined;

  if (trace.name === "run_terminal_cmd") {
    return (
      <div className="space-y-2">
        <Pre text={trace.output || "(no output)"} />
        <Meta items={[`cwd ${String(r.cwd ?? a.cwd ?? "/home/user/work")}`, typeof r.exitCode === "number" ? `exit ${r.exitCode}` : "", trace.durationMs !== undefined ? formatDuration(trace.durationMs) : ""]} />
        {error && <ErrorLine text={error} />}
      </div>
    );
  }
  if (error) return <ErrorLine text={error} />;

  if (trace.name === "file") {
    const action = String(a.action ?? "");
    if (action === "read") return <Pre text={String(r.content ?? "")} />;
    if (action === "write") {
      return (
        <div className="space-y-2">
          <Meta items={[`wrote ${formatBytes(Number(r.bytes ?? 0))}`]} />
          <Pre text={String(a.content ?? "")} />
        </div>
      );
    }
    if (action === "edit") {
      return (
        <div className="space-y-2">
          <Pre text={String(r.oldStr ?? a.old_str ?? "")} tone="removed" />
          <Pre text={String(r.newStr ?? a.new_str ?? "")} tone="added" />
        </div>
      );
    }
    if (action === "list" && Array.isArray(r.entries)) {
      const lines = (r.entries as { name?: string; type?: string; size?: number }[]).map(
        (e) => `${e.type === "dir" ? "d" : "-"} ${String(e.name ?? "")}${e.type === "dir" ? "/" : ""}${e.type !== "dir" && typeof e.size === "number" ? `  ${formatBytes(e.size)}` : ""}`,
      );
      return <Pre text={lines.join("\n") || "(empty)"} />;
    }
    return <Meta items={["done"]} />;
  }

  if (trace.name === "browser_open") {
    return (
      <div className="space-y-2">
        <div className="text-zinc-300">{String(r.title || "Untitled page")}</div>
        <Meta items={[String(r.url ?? a.url ?? ""), String(r.engine ?? "")]} />
        {typeof r.note === "string" && r.note && <p className="text-xs text-amber-300/80">{r.note}</p>}
        <Pre text={String(r.text ?? "")} />
      </div>
    );
  }

  if (trace.name === "get_sandbox_files") {
    const files = Array.isArray(r.files) ? (r.files as { name: string; bytes: number }[]) : [];
    const errors = Array.isArray(r.errors) ? (r.errors as { path: string; error: string }[]) : [];
    return (
      <div className="space-y-1 text-xs text-zinc-400">
        {files.map((f) => (
          <div key={f.name}>
            {f.name} · {formatBytes(f.bytes)}
          </div>
        ))}
        {errors.map((e) => (
          <ErrorLine key={e.path} text={`${e.path}: ${e.error}`} />
        ))}
      </div>
    );
  }

  return <Pre text={JSON.stringify(r, null, 2)} />;
}

function Pre({ text, tone }: { text: string; tone?: "added" | "removed" }) {
  return (
    <pre
      className={cn(
        "max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/40 p-2.5 font-mono text-[11.5px] leading-relaxed",
        tone === "added" ? "text-emerald-300/90" : tone === "removed" ? "text-red-300/80" : "text-zinc-300",
      )}
    >
      {text}
    </pre>
  );
}

function Meta({ items }: { items: string[] }) {
  return <div className="text-xs text-zinc-500">{items.filter(Boolean).join(" · ")}</div>;
}

function ErrorLine({ text }: { text: string }) {
  return <p className="text-xs text-red-300">{text}</p>;
}

function firstLine(text: string): string {
  const line = text.split("\n")[0];
  return text.includes("\n") ? `${line} …` : line;
}

function lastLines(text: string, n: number): string {
  return text.replace(/\s+$/, "").split("\n").slice(-n).join("\n");
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}
