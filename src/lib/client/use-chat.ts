"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { docBlock } from "@/lib/doc-block";
import { mimeFromName } from "@/lib/mime";
import { decodeBase64 } from "@/lib/parse-files";
import { sandboxBlock } from "@/lib/sandbox-paths";
import {
  DEFAULT_MODEL,
  MAX_CONVERSATIONS,
  MAX_MESSAGES,
  MAX_SANDBOX_FILE_BYTES,
  MAX_XAI_FILE_BYTES,
  XAI_FILE_TTL_SECONDS,
  type ApiEndpoint,
  type ApiMessage,
  type Attachment,
  type ChatMessage,
  type Conversation,
  type ErrorSource,
  type SandboxFile,
  type StreamEvent,
  type ToolTrace,
  type TurnFlags,
  type UploadLimits,
  type UploadResult,
} from "@/lib/types";
import { errorText, formatBytes, uid } from "@/lib/utils";
import { mergeSources } from "@/lib/xai/citations";
import { fetchServerConfig, killSandbox, pauseSandbox, RequestError, streamChat } from "./api";
import { blobToDataUrl, deleteBlobs, getBlob, listBlobKeys, putBlob } from "./blob-store";
import { beginSandboxUpload, uploadToSandbox, uploadToXai } from "./upload";
import {
  loadConversations,
  readPrefs,
  readString,
  saveConversations,
  STORAGE_KEYS,
  writePrefs,
  writeString,
  type Prefs,
} from "./storage";

export type PendingFile = { id: string; file: File; kind: "image" | "file"; previewUrl?: string };
export type Notify = (text: string, opts?: { tone?: "error" | "info" }) => void;
export type RunState = { messageId: string; status: string; startedAt: number };
export type SettingsState = { open: boolean; focus?: "xai" | "e2b"; error?: string };

type Upload = { key: string; blob: Blob; name: string; kind: "image" | "file" };
type Target = { convId: string; assistantId: string; userId: string };
type ClientEvent =
  | StreamEvent
  | { type: "file_saved"; file: SandboxFile }
  | { type: "screenshot_saved"; callId?: string; key: string }
  | { type: "stopped" }
  | { type: "failed"; message: string; status?: number; source?: ErrorSource };
type Queued = Target & { event: ClientEvent };

/** Uploaded xAI files expire after 24h; stop referencing them a little before that. */
const FILE_ID_TTL_MS = (XAI_FILE_TTL_SECONDS - 600) * 1000;
const HISTORY_IMAGE_LIMIT = 8;
/** Until /api/config answers, assume the smallest chunk size so uploads also work on Vercel. */
const DEFAULT_LIMITS: UploadLimits = {
  chunkBytes: 4 * 1024 * 1024,
  maxRequestBytes: 64 * 1024 * 1024,
  xaiFileBytes: MAX_XAI_FILE_BYTES,
  sandboxFileBytes: MAX_SANDBOX_FILE_BYTES,
};

export const imageKey = (attachmentId: string) => `img:${attachmentId}`;
const docTextKey = (attachmentId: string) => `doc:${attachmentId}`;

/** `endpoint` comes from the server render, so key wording is right before /api/config answers. */
export function useChat(notify: Notify, endpoint: ApiEndpoint) {
  const [apiKey, setApiKeyState] = useState(() => readString(STORAGE_KEYS.xaiKey));
  const [e2bKey, setE2bKeyState] = useState(() => readString(STORAGE_KEYS.e2bKey));
  const [extraInstructions, setExtraState] = useState(() => readString(STORAGE_KEYS.extraInstructions));
  const [model, setModelState] = useState(() => readString(STORAGE_KEYS.model) || DEFAULT_MODEL);
  const [prefs, setPrefsState] = useState<Prefs>(readPrefs);
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations);
  const [activeId, setActiveId] = useState<string | null>(() => readString(STORAGE_KEYS.active) || null);
  const [serverE2b, setServerE2b] = useState(false);
  const [limits, setLimits] = useState<UploadLimits>(DEFAULT_LIMITS);
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [settings, setSettings] = useState<SettingsState>({ open: false });

  const controllers = useRef(new Map<string, AbortController>());
  const docBlobs = useRef(new Map<string, File>());
  const queue = useRef<Queued[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(conversations);
  const warnedStorage = useRef(false);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const sorted = useMemo(() => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt), [conversations]);

  const persist = useCallback(
    (list: Conversation[]) => {
      const dropped = saveConversations(list);
      if (dropped.length && !warnedStorage.current) {
        warnedStorage.current = true;
        notify("Browser storage is full, so the oldest conversations will not survive a reload.", { tone: "error" });
      }
    },
    [notify],
  );

  useEffect(() => {
    latest.current = conversations;
    const timer = setTimeout(() => persist(conversations), 300);
    return () => clearTimeout(timer);
  }, [conversations, persist]);

  useEffect(() => {
    const flushNow = () => persist(latest.current);
    window.addEventListener("pagehide", flushNow);
    return () => window.removeEventListener("pagehide", flushNow);
  }, [persist]);

  useEffect(() => {
    writeString(STORAGE_KEYS.active, activeId ?? "");
  }, [activeId]);

  useEffect(() => {
    let alive = true;
    fetchServerConfig()
      .then((config) => {
        if (!alive) return;
        setServerE2b(config.e2bServerKey);
        if (config.uploads) setLimits(config.uploads);
      })
      .catch(() => undefined);
    // Drop stored blobs that no conversation points at any more.
    void (async () => {
      const keys = await listBlobKeys();
      const used = referencedBlobKeys(latest.current);
      await deleteBlobs(keys.filter((key) => !used.has(key)));
    })();
    return () => {
      alive = false;
    };
  }, []);

  const flush = useCallback(() => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = null;
    const batch = queue.current;
    if (!batch.length) return;
    queue.current = [];
    setConversations((prev) => applyBatch(prev, batch));
  }, []);

  /** Stream events are applied in order, in batches, so a fast stream does not re-render per token. */
  const enqueue = useCallback(
    (item: Queued) => {
      queue.current.push(item);
      flushTimer.current ??= setTimeout(flush, 40);
    },
    [flush],
  );

  const setRunStatus = useCallback((convId: string, status: string) => {
    setRuns((r) => (r[convId] && r[convId].status !== status ? { ...r, [convId]: { ...r[convId], status } } : r));
  }, []);

  const openSettings = useCallback((focus?: "xai" | "e2b", error?: string) => setSettings({ open: true, focus, error }), []);
  const closeSettings = useCallback(() => setSettings({ open: false }), []);

  const cleanup = (conv: Conversation) => {
    void deleteBlobs(blobKeysOf(conv.messages));
    if (conv.sandboxId) void killSandbox(conv.sandboxId, e2bKey || undefined).catch(() => undefined);
  };

  const onTurnError = (status: number | undefined, source: ErrorSource | undefined, message: string) => {
    if (status !== 401) return;
    if (source === "e2b") openSettings("e2b", message || "E2B rejected this API key.");
    else openSettings("xai", `${endpoint.custom ? endpoint.host : "xAI"} rejected this API key. Enter a valid key.`);
  };

  const runTurn = async (p: { conv: Conversation; history: ChatMessage[]; user: ChatMessage; uploads: Upload[]; appendUser: boolean }) => {
    const { conv, history, user } = p;
    const flags: TurnFlags = { agent: Boolean(conv.agent), search: conv.search !== false };
    const assistant: ChatMessage = {
      id: uid(),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      status: "streaming",
      model,
      flags,
    };
    const added = p.appendUser ? [user, assistant] : [assistant];
    setConversations((prev) => upsertConversation(prev, conv, added));

    const controller = new AbortController();
    controllers.current.set(conv.id, controller);
    setRuns((r) => ({ ...r, [conv.id]: { messageId: assistant.id, status: p.uploads.length ? "Uploading" : "Sending", startedAt: Date.now() } }));
    const target: Target = { convId: conv.id, assistantId: assistant.id, userId: user.id };
    let settled = false;
    // A sandbox woken for uploads is paused again if the turn ends before the server's agent loop takes it over.
    let wokenForUpload: string | undefined;
    let serverOwnsSandbox = false;

    try {
      let sandboxId = conv.sandboxId;
      const reuploaded = new Set(p.uploads.map((u) => u.key));
      const images = p.uploads.filter((u) => u.kind === "image");
      const docs = p.uploads.filter((u) => u.kind !== "image");
      // On a retry, files already on the sandbox disk are reused.
      const sandboxFiles = (user.attachments ?? [])
        .filter((a) => a.sandboxPath && !reuploaded.has(a.id))
        .map((a) => ({ path: a.sandboxPath!, bytes: a.size }));
      const newFileIds: string[] = [];
      const inlineDocs: string[] = [];

      // Documents are uploaded one per request before the turn starts: to xAI in Ask mode,
      // in chunks into the sandbox in Agent mode. Images stay small and travel with the turn.
      if (docs.length) {
        const results: UploadResult[] = [];
        if (flags.agent) {
          setRunStatus(conv.id, sandboxId ? "Resuming sandbox" : "Starting sandbox");
          const begun = await beginSandboxUpload({ e2bKey: e2bKey || undefined, conversationId: conv.id, sandboxId, signal: controller.signal });
          sandboxId = begun.sandboxId;
          wokenForUpload = sandboxId;
          enqueue({ ...target, event: { type: "sandbox", sandboxId, state: "running" } });
          if (begun.replaced) {
            enqueue({
              ...target,
              event: { type: "warning", message: "The previous sandbox no longer exists, so a new one was started. Files from earlier turns are not in it." },
            });
          }
        }
        const usedNames = new Set<string>();
        for (const doc of docs) {
          const progress = (fraction: number) => setRunStatus(conv.id, `Uploading ${doc.name} · ${Math.floor(fraction * 100)}%`);
          progress(0);
          if (flags.agent && sandboxId) {
            const saved = await uploadToSandbox(doc.blob, uniqueName(doc.name, usedNames), {
              e2bKey: e2bKey || undefined,
              sandboxId,
              chunkBytes: limits.chunkBytes,
              signal: controller.signal,
              onProgress: progress,
            });
            results.push({ key: doc.key, name: doc.name, kind: "file", bytes: saved.bytes, path: saved.path });
            sandboxFiles.push(saved);
          } else {
            const saved = await uploadToXai(doc.blob, doc.name, { apiKey, signal: controller.signal, onProgress: progress });
            if (saved.fileId) {
              results.push({ key: doc.key, name: doc.name, kind: "file", bytes: saved.bytes, fileId: saved.fileId });
              newFileIds.push(saved.fileId);
            } else {
              // No Files API on this endpoint: the text goes in the message and stays in IndexedDB for later turns.
              const text = saved.text ?? "";
              await putBlob(docTextKey(doc.key), new Blob([text], { type: "text/plain" }));
              results.push({ key: doc.key, name: doc.name, kind: "file", bytes: saved.bytes, inline: true });
              inlineDocs.push(docBlock(doc.name, text));
            }
          }
        }
        enqueue({ ...target, event: { type: "uploads", files: results } });
        setRunStatus(conv.id, "Sending");
      }

      const previous = endpoint.chain ? chainFrom(history, flags) : undefined;
      const messages = await toApiMessages([...history, user], { includeImages: !previous, agent: flags.agent, reuploaded });
      const turn = messages.at(-1);
      if (turn && newFileIds.length) turn.fileIds = [...(turn.fileIds ?? []), ...newFileIds];
      if (turn && inlineDocs.length) turn.content = [turn.content, ...inlineDocs].filter(Boolean).join("\n\n");
      const events = streamChat({
        apiKey,
        e2bKey: e2bKey || undefined,
        model,
        conversationId: conv.id,
        agent: flags.agent,
        sandboxId,
        sandboxFiles,
        search: { on: flags.search, web: prefs.web, x: prefs.x, code: prefs.code, xFrom: prefs.xFrom || undefined, xTo: prefs.xTo || undefined },
        temperature: flags.agent ? prefs.temperatureAgent : prefs.temperatureAsk,
        topP: prefs.topP,
        extraInstructions: extraInstructions.trim() || undefined,
        submitResult: prefs.submitResult,
        networkRetry: prefs.networkRetry,
        messages,
        files: images,
        previous,
        signal: controller.signal,
      });
      for await (const ev of events) {
        serverOwnsSandbox = true;
        switch (ev.type) {
          case "status":
            setRunStatus(conv.id, ev.text);
            break;
          case "retrying":
            setRunStatus(conv.id, ev.n > 1 ? `Retrying (${ev.n})…` : "Retrying…");
            break;
          case "file":
            saveDelivered(target, ev);
            break;
          case "screenshot":
            saveScreenshot(target, ev);
            break;
          default:
            if (ev.type === "done" || ev.type === "error") settled = true;
            if (ev.type === "error") onTurnError(ev.status, ev.source, ev.message);
            if (ev.type === "delta" || ev.type === "replace") setRunStatus(conv.id, "");
            enqueue({ ...target, event: ev });
        }
      }
      if (!settled) {
        enqueue({
          ...target,
          event: {
            type: "failed",
            message: flags.agent
              ? "The connection closed before the agent finished. On Vercel this is usually the 5 minute function limit; long agent jobs need next start on a server."
              : "The connection closed before the reply finished.",
          },
        });
      }
    } catch (err) {
      if (controller.signal.aborted) {
        enqueue({ ...target, event: { type: "stopped" } });
      } else {
        const e = err instanceof RequestError ? err : new RequestError(errorText(err), 0);
        enqueue({ ...target, event: { type: "failed", message: e.message, status: e.status, source: e.source } });
        onTurnError(e.status, e.source, e.message);
      }
    } finally {
      if (wokenForUpload && !serverOwnsSandbox) {
        const id = wokenForUpload;
        void pauseSandbox(id, e2bKey || undefined)
          .then(() => enqueue({ ...target, event: { type: "sandbox", sandboxId: id, state: "paused" } }))
          .catch(() => undefined);
      }
      flush();
      controllers.current.delete(conv.id);
      setRuns((r) => {
        const next = { ...r };
        delete next[conv.id];
        return next;
      });
    }
  };

  const saveDelivered = (target: Target, ev: Extract<StreamEvent, { type: "file" }>) => {
    try {
      const id = uid();
      const blobKey = `file:${id}`;
      void putBlob(blobKey, new Blob([decodeBase64(ev.b64)], { type: ev.mime }));
      enqueue({ ...target, event: { type: "file_saved", file: { id, name: ev.name, path: ev.path, mime: ev.mime, bytes: ev.bytes, blobKey } } });
    } catch {
      notify(`Couldn't read ${ev.name} from the sandbox.`, { tone: "error" });
    }
  };

  const saveScreenshot = (target: Target, ev: Extract<StreamEvent, { type: "screenshot" }>) => {
    try {
      const key = `shot:${uid()}`;
      void putBlob(key, new Blob([decodeBase64(ev.b64)], { type: ev.mime }));
      enqueue({ ...target, event: { type: "screenshot_saved", callId: ev.callId, key } });
    } catch {
      // a broken screenshot is not worth interrupting the turn
    }
  };

  /** Starts a turn. Returns false when nothing was sent (empty, missing key, busy). */
  const send = (text: string, pending: PendingFile[]): boolean => {
    const trimmed = text.trim();
    if (!trimmed && !pending.length) return false;
    if (!apiKey) {
      openSettings("xai", endpoint.custom ? "Add your API key to start." : "Add your xAI API key to start.");
      return false;
    }
    if (active && runs[active.id]) return false;
    const agent = active ? Boolean(active.agent) : prefs.agent;
    if (agent && !e2bKey && !serverE2b) {
      openSettings("e2b", "Agent mode needs an E2B API key.");
      return false;
    }
    if (!agent) {
      // Ask mode sends documents to xAI, which has its own per-file limit; Agent mode does not.
      const docLimit = Math.min(limits.xaiFileBytes, limits.maxRequestBytes);
      const big = pending.find((p) => p.kind === "file" && p.file.size > docLimit);
      if (big) {
        notify(
          `${big.file.name} is ${formatBytes(big.file.size)}. Documents can be up to ${formatBytes(docLimit)} here; turn on Agent to work with bigger files in the sandbox.`,
          { tone: "error" },
        );
        return false;
      }
    }

    const now = Date.now();
    const attachments: Attachment[] = [];
    const uploads: Upload[] = [];
    for (const p of pending) {
      attachments.push({ id: p.id, name: p.file.name, size: p.file.size, mime: p.file.type || mimeFromName(p.file.name), kind: p.kind });
      uploads.push({ key: p.id, blob: p.file, name: p.file.name, kind: p.kind });
      if (p.kind === "image") void putBlob(imageKey(p.id), p.file);
      else docBlobs.current.set(p.id, p.file);
    }
    const user: ChatMessage = { id: uid(), role: "user", content: trimmed, createdAt: now, ...(attachments.length ? { attachments } : {}) };

    let conv = active;
    if (!conv) {
      conv = { id: uid(), title: makeTitle(trimmed, attachments), createdAt: now, updatedAt: now, messages: [], agent: prefs.agent, search: prefs.search };
      // Keep at most MAX_CONVERSATIONS; clean up what falls off the end.
      const overflow = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt).slice(MAX_CONVERSATIONS - 1);
      overflow.forEach(cleanup);
      if (overflow.length) setConversations((prev) => prev.filter((c) => !overflow.some((o) => o.id === c.id)));
      setActiveId(conv.id);
    } else if (conv.messages.length + 2 > MAX_MESSAGES) {
      void deleteBlobs(blobKeysOf(conv.messages.slice(0, conv.messages.length + 2 - MAX_MESSAGES)));
    }
    void runTurn({ conv, history: conv.messages, user, uploads, appendUser: true });
    return true;
  };

  /** Runs the last user message again in place of the last reply. */
  const retry = (assistantId: string) => {
    const conv = active;
    if (!conv || runs[conv.id]) return;
    const idx = conv.messages.findIndex((m) => m.id === assistantId);
    const user = conv.messages[idx - 1];
    if (idx !== conv.messages.length - 1 || user?.role !== "user") return;
    void (async () => {
      const uploads: Upload[] = [];
      for (const a of user.attachments ?? []) {
        if (a.kind === "image") {
          const blob = await getBlob(imageKey(a.id));
          if (blob) uploads.push({ key: a.id, blob, name: a.name, kind: "image" });
          continue;
        }
        if (!conv.agent && a.fileId && a.uploadedAt && Date.now() - a.uploadedAt < FILE_ID_TTL_MS) continue;
        if (a.inline && (await getBlob(docTextKey(a.id)))) continue;
        if (conv.agent && a.sandboxPath) continue;
        const doc = docBlobs.current.get(a.id);
        if (doc) uploads.push({ key: a.id, blob: doc, name: a.name, kind: "file" });
      }
      void deleteBlobs(blobKeysOf([conv.messages[idx]]));
      setConversations((prev) => prev.map((c) => (c.id === conv.id ? { ...c, messages: c.messages.filter((m) => m.id !== assistantId) } : c)));
      await runTurn({ conv: { ...conv, messages: conv.messages.slice(0, idx) }, history: conv.messages.slice(0, idx - 1), user, uploads, appendUser: false });
    })();
  };

  const stop = () => {
    if (active) controllers.current.get(active.id)?.abort();
  };

  const deleteConversation = (id: string) => {
    const conv = conversations.find((c) => c.id === id);
    if (!conv) return;
    controllers.current.get(id)?.abort();
    cleanup(conv);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  };

  const clearAll = () => {
    for (const controller of controllers.current.values()) controller.abort();
    conversations.forEach(cleanup);
    setConversations([]);
    setActiveId(null);
  };

  const destroySandbox = async () => {
    const conv = active;
    if (!conv?.sandboxId) return;
    try {
      await killSandbox(conv.sandboxId, e2bKey || undefined);
      setConversations((prev) => prev.map((c) => (c.id === conv.id ? { ...c, sandboxId: undefined, sandboxState: "none" } : c)));
      notify("Sandbox destroyed. The next Agent message starts a new one.");
    } catch (err) {
      notify(`Couldn't destroy the sandbox: ${errorText(err)}`, { tone: "error" });
    }
  };

  const updatePrefs = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefsState(next);
    writePrefs(next);
  };

  /** Agent and Search belong to the conversation; the last choice becomes the default for new chats. */
  const setConversationFlag = (key: "agent" | "search", on: boolean) => {
    updatePrefs({ [key]: on });
    if (active) setConversations((prev) => prev.map((c) => (c.id === active.id ? { ...c, [key]: on } : c)));
  };

  const setApiKey = (value: string) => {
    setApiKeyState(value);
    writeString(STORAGE_KEYS.xaiKey, value);
  };
  const setE2bKey = (value: string) => {
    setE2bKeyState(value);
    writeString(STORAGE_KEYS.e2bKey, value);
  };
  const setExtraInstructions = (value: string) => {
    setExtraState(value);
    writeString(STORAGE_KEYS.extraInstructions, value);
  };
  const setModel = (value: string) => {
    setModelState(value);
    writeString(STORAGE_KEYS.model, value);
  };

  const agentOn = active ? Boolean(active.agent) : prefs.agent;
  const searchOn = active ? active.search !== false : prefs.search;

  return {
    apiKey,
    setApiKey,
    e2bKey,
    setE2bKey,
    serverE2b,
    endpoint,
    extraInstructions,
    setExtraInstructions,
    model,
    setModel,
    prefs,
    updatePrefs,
    conversations: sorted,
    active,
    activeId,
    select: setActiveId,
    newChat: () => setActiveId(null),
    deleteConversation,
    clearAll,
    runs,
    activeRun: active ? runs[active.id] : undefined,
    send,
    stop,
    retry,
    agentOn,
    searchOn,
    setAgent: (on: boolean) => setConversationFlag("agent", on),
    setSearch: (on: boolean) => setConversationFlag("search", on),
    e2bReady: Boolean(e2bKey) || serverE2b,
    destroySandbox,
    settings,
    openSettings,
    closeSettings,
  };
}

export type ChatState = ReturnType<typeof useChat>;

/** The previous reply's response id, when the next turn can continue that chain. */
function chainFrom(history: ChatMessage[], flags: TurnFlags) {
  const last = history.at(-1);
  if (!last || last.role !== "assistant" || last.status !== "done" || !last.responseId || !last.promptVersion) return undefined;
  if (last.mode === "chat") return undefined;
  if (Boolean(last.flags?.agent) !== flags.agent || Boolean(last.flags?.search) !== flags.search) return undefined;
  return { responseId: last.responseId, promptVersion: last.promptVersion, openCallIds: last.openCallIds };
}

async function toApiMessages(list: ChatMessage[], opts: { includeImages: boolean; agent: boolean; reuploaded: Set<string> }): Promise<ApiMessage[]> {
  const out: ApiMessage[] = [];
  const now = Date.now();
  let imagesLeft = HISTORY_IMAGE_LIMIT;
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    const current = i === list.length - 1;
    if (m.role === "assistant") {
      const content = [m.content.trim(), opts.agent ? toolSummary(m.tools) : ""].filter(Boolean).join("\n\n");
      if (content) out.unshift({ role: "assistant", content });
      continue;
    }
    const attachments = m.attachments ?? [];
    const fileIds = attachments
      .filter((a) => a.fileId && a.uploadedAt && now - a.uploadedAt < FILE_ID_TTL_MS && !opts.reuploaded.has(a.id))
      .map((a) => a.fileId!);
    // The server lists the current turn's sandbox files (sandboxFiles); earlier turns list theirs here.
    const onDisk = current ? [] : attachments.filter((a) => a.sandboxPath);
    let content = m.content;
    if (onDisk.length) content = [content, sandboxBlock(onDisk.map((a) => ({ path: a.sandboxPath!, bytes: a.size })))].filter(Boolean).join("\n\n");
    for (const a of attachments) {
      if (!a.inline || opts.reuploaded.has(a.id)) continue;
      const blob = await getBlob(docTextKey(a.id));
      if (blob) content = [content, docBlock(a.name, await blob.text())].filter(Boolean).join("\n\n");
    }
    const images: string[] = [];
    if (!current && opts.includeImages) {
      for (const a of attachments) {
        if (a.kind !== "image" || imagesLeft <= 0) continue;
        const blob = await getBlob(imageKey(a.id));
        if (!blob) continue;
        images.push(await blobToDataUrl(blob));
        imagesLeft--;
      }
    }
    out.unshift({ role: "user", content, ...(fileIds.length ? { fileIds } : {}), ...(images.length ? { images } : {}) });
  }
  return out;
}

/** A short record of sandbox tool calls, so a reply still makes sense when history is resent as text. */
function toolSummary(tools?: ToolTrace[]): string {
  const lines = (tools ?? [])
    .filter((t) => t.kind === "function")
    .slice(0, 20)
    .map((t) => {
      const a = t.args ?? {};
      if (t.name === "run_terminal_cmd") return `- ran \`${String(a.command ?? "").slice(0, 200)}\` (exit ${String(t.result?.exitCode ?? "?")})`;
      if (t.name === "file") return `- file ${String(a.action ?? "")} ${String(a.path ?? "")}`;
      if (t.name === "browser_open") return `- opened ${String(a.url ?? "")}`;
      if (t.name === "get_sandbox_files") return `- delivered ${Array.isArray(a.paths) ? a.paths.join(", ") : ""}`;
      return `- ${t.name}`;
    });
  return lines.length ? `[tools used]\n${lines.join("\n")}\n[/tools used]` : "";
}

/** Two attachments with the same name in one turn would overwrite each other in /home/user/uploaded. */
function uniqueName(name: string, used: Set<string>): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let candidate = name;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

function makeTitle(text: string, attachments: Attachment[]): string {
  const line = text.split("\n").find((l) => l.trim())?.trim() ?? "";
  if (line) return line.length > 60 ? `${line.slice(0, 57)}…` : line;
  return attachments[0]?.name ?? "New chat";
}

function upsertConversation(list: Conversation[], conv: Conversation, added: ChatMessage[]): Conversation[] {
  const now = Date.now();
  const existing = list.find((c) => c.id === conv.id);
  if (!existing) return [{ ...conv, messages: added.slice(-MAX_MESSAGES), updatedAt: now }, ...list];
  return list.map((c) => (c.id === conv.id ? { ...c, messages: [...c.messages, ...added].slice(-MAX_MESSAGES), updatedAt: now } : c));
}

function applyBatch(list: Conversation[], batch: Queued[]): Conversation[] {
  const byConv = new Map<string, Queued[]>();
  for (const item of batch) byConv.set(item.convId, [...(byConv.get(item.convId) ?? []), item]);
  return list.map((c) => byConv.get(c.id)?.reduce(applyEvent, c) ?? c);
}

function applyEvent(conv: Conversation, q: Queued): Conversation {
  const ev = q.event;
  if (ev.type === "sandbox") return { ...conv, sandboxId: ev.sandboxId ?? undefined, sandboxState: ev.state };
  if (ev.type === "uploads") return mapMessage(conv, q.userId, (m) => ({ ...m, attachments: mergeUploads(m.attachments, ev.files) }));
  const next = mapMessage(conv, q.assistantId, (m) => applyToAssistant(m, ev));
  return ev.type === "done" ? { ...next, updatedAt: Date.now() } : next;
}

function mapMessage(conv: Conversation, id: string, fn: (m: ChatMessage) => ChatMessage): Conversation {
  const idx = conv.messages.findIndex((m) => m.id === id);
  if (idx === -1) return conv;
  const messages = [...conv.messages];
  messages[idx] = fn(messages[idx]);
  return { ...conv, messages };
}

function mergeUploads(attachments: Attachment[] | undefined, results: UploadResult[]): Attachment[] | undefined {
  if (!attachments) return attachments;
  const now = Date.now();
  return attachments.map((a) => {
    const r = results.find((x) => x.key === a.id);
    if (!r || r.error) return a;
    return {
      ...a,
      ...(r.fileId ? { fileId: r.fileId, uploadedAt: now } : {}),
      ...(r.path ? { sandboxPath: r.path } : {}),
      ...(r.inline ? { inline: true } : {}),
    };
  });
}

function applyToAssistant(m: ChatMessage, ev: ClientEvent): ChatMessage {
  switch (ev.type) {
    case "delta":
      return { ...m, content: m.content + ev.text };
    case "replace":
      return {
        ...m,
        content: ev.text,
        tools: m.tools?.map((t) => (t.offset > ev.text.length ? { ...t, offset: ev.text.length } : t)),
      };
    case "tool_call":
      return upsertTool(m, ev.callId, { kind: "function", name: ev.name, status: "pending" });
    case "tool_start":
      return upsertTool(m, ev.callId, { kind: "function", name: ev.name, args: ev.args, status: "running" });
    case "tool_stdout":
      return upsertTool(m, ev.callId, (t) => ({ output: ((t?.output ?? "") + ev.text).slice(-20_000) }));
    case "tool_end":
      return upsertTool(m, ev.callId, { status: ev.ok ? "done" : "error", result: ev.result, durationMs: ev.durationMs });
    case "screenshot_saved": {
      const callId = ev.callId ?? [...(m.tools ?? [])].reverse().find((t) => t.kind === "function")?.id;
      return callId ? upsertTool(m, callId, { screenshotKey: ev.key }) : m;
    }
    case "search_start":
      return upsertTool(m, ev.id, (t) => ({ kind: "builtin", provider: ev.provider, name: ev.name, preview: ev.preview ?? t?.preview, status: "running" }));
    case "search_end":
      return upsertTool(m, ev.id, (t) => ({
        kind: "builtin",
        provider: ev.provider,
        name: ev.name,
        preview: ev.preview ?? t?.preview,
        status: ev.ok === false ? "error" : "done",
      }));
    case "file_saved":
      return { ...m, files: [...(m.files ?? []), ev.file] };
    case "citations":
      return { ...m, sources: mergeSources(m.sources, ev.urls.map((url) => ({ url }))) };
    case "sources":
      return { ...m, sources: mergeSources(m.sources, ev.items) };
    case "warning":
      return { ...m, notices: [...(m.notices ?? []), ev.message] };
    case "done":
      return {
        ...m,
        status: "done",
        mode: ev.mode,
        responseId: ev.responseId,
        promptVersion: ev.promptVersion,
        openCallIds: ev.openCallIds?.length ? ev.openCallIds : undefined,
        usage: ev.usage,
        notices: ev.notice ? [...(m.notices ?? []), ev.notice] : m.notices,
        tools: settleTools(m.tools, "done"),
      };
    case "error":
    case "failed":
      return { ...m, status: "error", error: ev.message, errorStatus: ev.status, errorSource: ev.source, tools: settleTools(m.tools, "error") };
    case "stopped":
      return { ...m, status: "stopped", tools: settleTools(m.tools, "error") };
    default:
      return m;
  }
}

function upsertTool(m: ChatMessage, id: string, patch: Partial<ToolTrace> | ((t?: ToolTrace) => Partial<ToolTrace>)): ChatMessage {
  const tools = [...(m.tools ?? [])];
  const idx = tools.findIndex((t) => t.id === id);
  const existing = idx === -1 ? undefined : tools[idx];
  const change = typeof patch === "function" ? patch(existing) : patch;
  if (existing) tools[idx] = { ...existing, ...change };
  else tools.push({ id, kind: "function", name: "tool", status: "running", offset: m.content.length, ...change });
  return { ...m, tools };
}

function settleTools(tools: ToolTrace[] | undefined, status: "done" | "error"): ToolTrace[] | undefined {
  return tools?.map((t) => (t.status === "running" || t.status === "pending" ? { ...t, status } : t));
}

function blobKeysOf(messages: ChatMessage[]): string[] {
  const keys: string[] = [];
  for (const m of messages) {
    for (const a of m.attachments ?? []) {
      if (a.kind === "image") keys.push(imageKey(a.id));
      else if (a.inline) keys.push(docTextKey(a.id));
    }
    for (const t of m.tools ?? []) if (t.screenshotKey) keys.push(t.screenshotKey);
    for (const f of m.files ?? []) keys.push(f.blobKey);
  }
  return keys;
}

function referencedBlobKeys(list: Conversation[]): Set<string> {
  return new Set(list.flatMap((c) => blobKeysOf(c.messages)));
}
