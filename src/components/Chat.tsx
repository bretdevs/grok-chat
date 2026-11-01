"use client";

import { ArrowDown, Menu, Plus, Upload } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { prepareImage } from "@/lib/client/images";
import { useChat, type PendingFile } from "@/lib/client/use-chat";
import { MAX_SANDBOX_FILE_BYTES, type ApiEndpoint, type AuthInfo, type ChatMessage } from "@/lib/types";
import { uid } from "@/lib/utils";
import { Composer } from "./Composer";
import { Message } from "./Message";
import { SandboxStatus } from "./SandboxStatus";
import { SettingsDrawer } from "./SettingsDrawer";
import { Sidebar } from "./Sidebar";
import { Toasts, useToasts } from "./Toasts";

// Windows executables and scripts only; data files such as .bin or .iso are fine to upload.
const BLOCKED = /\.(exe|dll|msi|scr|com|bat|cmd)$/i;
const MAX_ATTACHMENTS = 10;
const NO_MESSAGES: ChatMessage[] = [];

export default function Chat({ endpoint, auth }: { endpoint: ApiEndpoint; auth: AuthInfo }) {
  const { toasts, push: notify, dismiss } = useToasts();
  const chat = useChat(notify, endpoint, auth);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const shownConversation = useRef(chat.activeId);

  const active = chat.active;
  const messages = active?.messages ?? NO_MESSAGES;
  const streaming = Boolean(chat.activeRun);

  // Stable callbacks keep old messages from re-rendering on every streamed token.
  const actions = useRef({ retry: chat.retry, openSettings: chat.openSettings });
  useEffect(() => {
    actions.current = { retry: chat.retry, openSettings: chat.openSettings };
  });
  const onRetry = useCallback((id: string) => actions.current.retry(id), []);
  const onFixKey = useCallback((which: "xai" | "e2b") => actions.current.openSettings(which), []);

  const addFiles = useCallback(
    async (list: File[]) => {
      const accepted: PendingFile[] = [];
      for (const raw of list) {
        if (BLOCKED.test(raw.name)) {
          notify(`${raw.name}: executables are not supported.`, { tone: "error" });
          continue;
        }
        if (raw.size > MAX_SANDBOX_FILE_BYTES) {
          notify(`${raw.name} is over the 1 GB limit.`, { tone: "error" });
          continue;
        }
        if (!raw.size) {
          notify(`${raw.name} is empty.`, { tone: "error" });
          continue;
        }
        const file = renamePasted(raw);
        if (file.type.startsWith("image/") && file.type !== "image/svg+xml") {
          try {
            const image = await prepareImage(file);
            accepted.push({ id: uid(), file: image, kind: "image", previewUrl: URL.createObjectURL(image) });
          } catch {
            notify(`Couldn't read ${raw.name} as an image.`, { tone: "error" });
          }
        } else {
          accepted.push({ id: uid(), file, kind: "file" });
        }
      }
      if (!accepted.length) return;
      if (pending.length + accepted.length > MAX_ATTACHMENTS) notify(`Up to ${MAX_ATTACHMENTS} attachments per message.`);
      setPending((prev) => {
        const merged = [...prev];
        for (const item of accepted) {
          if (!merged.some((p) => p.file.name === item.file.name && p.file.size === item.file.size)) merged.push(item);
        }
        return merged.slice(0, MAX_ATTACHMENTS);
      });
    },
    [notify, pending.length],
  );

  const removeFile = (id: string) => {
    setPending((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const send = () => {
    if (!chat.send(draft, pending)) return;
    for (const p of pending) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    setDraft("");
    setPending([]);
    stick.current = true;
  };

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = atBottom;
    setShowJump(!atBottom);
  };

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (shownConversation.current !== chat.activeId) {
      shownConversation.current = chat.activeId;
      stick.current = true;
    }
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, chat.activeId]);

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      void addFiles(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [addFiles]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      // Pasting into settings fields stays a normal paste.
      if (target?.closest("input, textarea, [contenteditable='true']") && !target.closest("[data-composer]")) return;
      if (!e.clipboardData?.getData("text/plain")) e.preventDefault();
      void addFiles(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [addFiles]);

  const sidebar = (onClose?: () => void) => (
    <Sidebar
      conversations={chat.conversations}
      activeId={chat.activeId}
      running={chat.runs}
      keyMissing={!chat.keyReady}
      onSelect={(id) => {
        chat.select(id);
        onClose?.();
      }}
      onNew={() => {
        chat.newChat();
        onClose?.();
      }}
      onDelete={chat.deleteConversation}
      onSettings={() => {
        chat.openSettings();
        onClose?.();
      }}
      onClose={onClose}
    />
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-[#0b0b0c] text-zinc-100">
      <aside className="hidden w-64 shrink-0 border-r border-zinc-800/70 md:block">{sidebar()}</aside>

      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/60" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85%] border-r border-zinc-800 bg-[#0b0b0c] pt-[env(safe-area-inset-top)]">
            {sidebar(() => setMenuOpen(false))}
          </aside>
        </div>
      )}

      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-zinc-800/70 px-3 pb-2 pt-[max(env(safe-area-inset-top),0.5rem)] md:px-4">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            className="grid size-8 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-800 md:hidden"
          >
            <Menu className="size-4" />
          </button>
          <h1 className="min-w-0 flex-1 truncate py-1 text-sm text-zinc-300">{active?.title ?? "New chat"}</h1>
          {(chat.agentOn || active?.sandboxId) && (
            <SandboxStatus sandboxId={active?.sandboxId} state={active?.sandboxState} busy={streaming} onDestroy={() => void chat.destroySandbox()} />
          )}
          <button
            type="button"
            onClick={chat.newChat}
            aria-label="New chat"
            className="grid size-8 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-800 md:hidden"
          >
            <Plus className="size-4" />
          </button>
        </header>

        <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto w-full max-w-3xl px-4 py-6">
            {messages.length === 0 ? (
              <EmptyState
                hasKey={chat.keyReady}
                serverPays={chat.serverPays}
                customEndpoint={chat.endpoint.custom}
                search={chat.searchOn}
                agent={chat.agentOn}
                onAddKey={() => chat.openSettings("xai")}
              />
            ) : (
              <div className="space-y-7">
                {messages.map((m, i) => (
                  <Message
                    key={m.id}
                    message={m}
                    live={chat.activeRun?.messageId === m.id}
                    run={chat.activeRun?.messageId === m.id ? chat.activeRun : undefined}
                    canRetry={!streaming && m.role === "assistant" && i === messages.length - 1}
                    onRetry={onRetry}
                    onFixKey={onFixKey}
                    notify={notify}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="relative shrink-0 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2 md:px-4">
          {showJump && messages.length > 0 && (
            <button
              type="button"
              aria-label="Scroll to bottom"
              onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" })}
              className="absolute -top-11 left-1/2 grid size-9 -translate-x-1/2 place-items-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-300 shadow-lg hover:text-zinc-100"
            >
              <ArrowDown className="size-4" />
            </button>
          )}
          <div className="mx-auto w-full max-w-3xl">
            <Composer
              value={draft}
              onChange={setDraft}
              pending={pending}
              onAddFiles={(files) => void addFiles(files)}
              onRemoveFile={removeFile}
              onSend={send}
              onStop={chat.stop}
              streaming={streaming}
              model={chat.model}
              onModel={chat.setModel}
              agent={chat.agentOn}
              onAgent={chat.setAgent}
              search={chat.searchOn}
              onSearch={chat.setSearch}
              blocker={
                chat.agentOn && !chat.e2bReady
                  ? { text: "Add E2B API key in settings (e2b.dev)", action: "Open settings", onAction: () => chat.openSettings("e2b") }
                  : null
              }
            />
          </div>
        </div>
      </main>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="rounded-2xl border border-dashed border-zinc-600 px-10 py-8 text-center">
            <Upload className="mx-auto mb-2 size-6 text-zinc-300" />
            <p className="text-sm text-zinc-200">Drop files to attach</p>
          </div>
        </div>
      )}

      {chat.settings.open && <SettingsDrawer chat={chat} />}
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function EmptyState({
  hasKey,
  serverPays,
  customEndpoint,
  search,
  agent,
  onAddKey,
}: {
  hasKey: boolean;
  serverPays: boolean;
  customEndpoint: boolean;
  search: boolean;
  agent: boolean;
  onAddKey: () => void;
}) {
  const keyName = customEndpoint ? "API key" : "xAI API key";
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center px-2 text-center">
      <h2 className="text-2xl font-semibold tracking-tight text-zinc-100">Grok Chat</h2>
      <p className="mt-2 max-w-md text-sm text-zinc-400">
        {serverPays ? "Ask anything. Attach documents and images." : `Chat with Grok using your own ${keyName}. Attach documents and images.`}
      </p>
      {(search || agent) && (
        <div className="mt-3 space-y-1 text-sm text-zinc-500">
          {search && <p>Live web and X search are on.</p>}
          {agent && <p>Agent can run commands and edit files in a cloud VM.</p>}
        </div>
      )}
      {!hasKey && (
        <div className="mt-8 w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 text-left">
          <p className="text-sm text-zinc-200">Add your {keyName} to start.</p>
          <p className="mt-1 text-xs text-zinc-500">It is stored in this browser only.</p>
          <div className="mt-4 flex items-center gap-4">
            <button type="button" onClick={onAddKey} className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-white">
              Add API key
            </button>
            {!customEndpoint && (
              <a href="https://console.x.ai" target="_blank" rel="noopener noreferrer" className="text-sm text-zinc-400 underline underline-offset-2 hover:text-zinc-200">
                Get a key
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Clipboard images all arrive as "image.png"; give them distinct names. */
function renamePasted(file: File): File {
  if (file.name && !/^image\.(png|jpe?g|gif|webp)$/i.test(file.name)) return file;
  const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
  return new File([file], `pasted-${stamp}.${ext}`, { type: file.type, lastModified: file.lastModified });
}
