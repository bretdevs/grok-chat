"use client";

import { FileDown, Loader2, RotateCcw } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { imageKey, type Notify, type RunState } from "@/lib/client/use-chat";
import { parseGeneratedFiles, type GeneratedFile, type ParsedReply } from "@/lib/parse-files";
import type { ChatMessage, ToolTrace as Trace } from "@/lib/types";
import { compactNumber, formatBytes } from "@/lib/utils";
import { CopyButton } from "./CopyButton";
import { DownloadButtons } from "./DownloadButtons";
import { FileChips, type Chip } from "./FileChips";
import { Markdown } from "./Markdown";
import { SearchTrace } from "./SearchTrace";
import { SourcesRow } from "./SourcesRow";
import { ToolTrace } from "./ToolTrace";

type Props = {
  message: ChatMessage;
  live: boolean;
  run?: RunState;
  canRetry: boolean;
  onRetry: (id: string) => void;
  onFixKey: (which: "xai" | "e2b") => void;
  notify: Notify;
};

export const Message = memo(function Message(props: Props) {
  return props.message.role === "user" ? <UserMessage message={props.message} /> : <AssistantMessage {...props} />;
});

function UserMessage({ message }: { message: ChatMessage }) {
  const chips: Chip[] = (message.attachments ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    size: a.size,
    kind: a.kind,
    blobKey: a.kind === "image" ? imageKey(a.id) : undefined,
    detail: a.sandboxPath ?? (a.fileId ? "uploaded" : undefined),
  }));
  return (
    <div className="flex flex-col items-end gap-2">
      {message.content && (
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-zinc-800/80 px-4 py-2.5 text-[15px] leading-relaxed text-zinc-100">
          {message.content}
        </div>
      )}
      {chips.length > 0 && <FileChips items={chips} align="end" />}
    </div>
  );
}

type Part = { kind: "text"; key: string; text: string } | { kind: "tools"; key: string; tools: Trace[] };

/** Splits the reply at tool-call offsets so cards render where they happened, and pulls out :::file blocks. */
function layout(message: ChatMessage, streaming: boolean) {
  const content = message.content;
  const tools = [...(message.tools ?? [])].sort((a, b) => a.offset - b.offset);
  const parts: Part[] = [];
  const files: GeneratedFile[] = [];
  let pending: ParsedReply["pending"] = null;
  let group: Trace[] = [];
  let pos = 0;

  const pushText = (raw: string, last: boolean) => {
    const parsed = parseGeneratedFiles(raw, { streaming: streaming && last });
    files.push(...parsed.files);
    if (last) pending = parsed.pending;
    if (parsed.text.trim()) parts.push({ kind: "text", key: `t${parts.length}`, text: parsed.text });
  };
  const flushGroup = () => {
    if (group.length) parts.push({ kind: "tools", key: `g${parts.length}`, tools: group });
    group = [];
  };

  for (const tool of tools) {
    const at = Math.min(Math.max(tool.offset, pos), content.length);
    if (at > pos) {
      flushGroup();
      pushText(content.slice(pos, at), false);
      pos = at;
    }
    group.push(tool);
  }
  flushGroup();
  pushText(content.slice(pos), true);
  return { parts, files, pending: pending as ParsedReply["pending"] };
}

function AssistantMessage({ message, live, run, canRetry, onRetry, onFixKey, notify }: Props) {
  const { parts, files, pending } = useMemo(() => layout(message, live), [message, live]);
  const toolRunning = live && (message.tools ?? []).some((t) => t.status === "running" || t.status === "pending");
  const lastPart = parts.at(-1);
  const thinking = live && !pending && !toolRunning && lastPart?.kind !== "text";
  const visibleText = parts
    .filter((p): p is Extract<Part, { kind: "text" }> => p.kind === "text")
    .map((p) => p.text)
    .join("\n\n");

  return (
    <div className="group/message">
      <div className="space-y-3">
        {parts.map((part) =>
          part.kind === "text" ? (
            <Markdown key={part.key} text={part.text} />
          ) : (
            <div key={part.key} className="space-y-1.5">
              {part.tools.map((tool) =>
                tool.kind === "builtin" ? <SearchTrace key={tool.id} trace={tool} live={live} /> : <ToolTrace key={tool.id} trace={tool} live={live} />,
              )}
            </div>
          ),
        )}
      </div>

      {pending && (
        <div className="mt-3 inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-300">
          <FileDown className="size-3.5 text-zinc-500" />
          Writing {pending.name || "file"}… {pending.size ? formatBytes(pending.size) : ""}
        </div>
      )}

      {thinking && <Thinking status={run?.status} startedAt={run?.startedAt} />}

      <DownloadButtons files={files} delivered={message.files ?? []} onError={(text) => notify(text, { tone: "error" })} />

      {message.sources && message.sources.length > 0 && <SourcesRow sources={message.sources} />}

      {message.status === "error" && (
        <div className="mt-3 rounded-xl border border-red-900/50 bg-red-950/40 px-3.5 py-2.5 text-sm text-red-200">
          <p className="break-words">{message.error || "Something went wrong."}</p>
          {message.errorStatus === 401 && (
            <button
              type="button"
              onClick={() => onFixKey(message.errorSource === "e2b" ? "e2b" : "xai")}
              className="mt-2 rounded-lg border border-red-800/70 px-2.5 py-1 text-xs text-red-100 hover:bg-red-900/40"
            >
              Update API key
            </button>
          )}
        </div>
      )}
      {message.status === "stopped" && <p className="mt-2 text-xs text-zinc-500">Stopped</p>}
      {message.notices?.map((notice, i) => (
        <p key={i} className="mt-2 text-xs text-amber-300/80">
          {notice}
        </p>
      ))}

      {!live && (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-zinc-500">
          {visibleText && <CopyButton text={visibleText} />}
          {canRetry && (
            <button
              type="button"
              onClick={() => onRetry(message.id)}
              className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <RotateCcw className="size-3.5" />
              Retry
            </button>
          )}
          <span className="ml-1">{footer(message)}</span>
        </div>
      )}
    </div>
  );
}

function footer(m: ChatMessage): string {
  const bits = [m.model ?? ""];
  if (m.usage) {
    bits.push(`${compactNumber(m.usage.input)} in`, `${compactNumber(m.usage.output)} out`);
    if (m.usage.cached) bits.push(`${compactNumber(m.usage.cached)} cached`);
  }
  if (m.mode === "chat") bits.push("via chat completions");
  return bits.filter(Boolean).join(" · ");
}

function Thinking({ status, startedAt }: { status?: string; startedAt?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  return (
    <div className="mt-3 flex items-center gap-2 text-sm text-zinc-400">
      <Loader2 className="size-4 animate-spin" />
      <span>{status || "Thinking"}</span>
      {seconds >= 2 && <span className="text-zinc-600">{seconds}s</span>}
    </div>
  );
}
