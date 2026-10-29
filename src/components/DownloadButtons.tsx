"use client";

import { Download, Eye, EyeOff, FileText, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { getBlob } from "@/lib/client/blob-store";
import { downloadBlob, downloadZip } from "@/lib/client/download";
import { isTextMime } from "@/lib/mime";
import { generatedFileBlob, type GeneratedFile } from "@/lib/parse-files";
import type { SandboxFile } from "@/lib/types";
import { formatBytes } from "@/lib/utils";

type Entry = {
  id: string;
  name: string;
  zipPath: string;
  size: number;
  mime: string;
  origin: "generated" | "sandbox";
  incomplete?: boolean;
  load: () => Promise<Blob | undefined>;
};

const PREVIEW_LIMIT = 300_000;

export function DownloadButtons({
  files,
  delivered,
  onError,
}: {
  files: GeneratedFile[];
  delivered: SandboxFile[];
  onError: (message: string) => void;
}) {
  const entries = useMemo<Entry[]>(
    () => [
      ...delivered.map((f) => ({
        id: f.id,
        name: f.name,
        zipPath: f.name,
        size: f.bytes,
        mime: f.mime,
        origin: "sandbox" as const,
        load: () => getBlob(f.blobKey),
      })),
      ...files.map((f, i) => ({
        id: `generated-${i}-${f.path}`,
        name: f.name,
        zipPath: f.path,
        size: f.size,
        mime: f.mime,
        origin: "generated" as const,
        incomplete: f.incomplete,
        load: async () => generatedFileBlob(f),
      })),
    ],
    [files, delivered],
  );
  const [zipping, setZipping] = useState(false);
  if (!entries.length) return null;

  const loadOrFail = async (entry: Entry) => {
    try {
      const blob = await entry.load();
      if (!blob) onError(`${entry.name} is no longer stored in this browser.`);
      return blob;
    } catch (err) {
      onError(`Couldn't build ${entry.name}: ${err instanceof Error ? err.message : "unknown error"}`);
      return undefined;
    }
  };

  const zipAll = async () => {
    setZipping(true);
    try {
      const parts: { path: string; blob: Blob }[] = [];
      for (const entry of entries) {
        const blob = await loadOrFail(entry);
        if (blob) parts.push({ path: entry.zipPath, blob });
      }
      if (parts.length) await downloadZip(parts, "files.zip");
    } finally {
      setZipping(false);
    }
  };

  return (
    <div className="mt-3 space-y-2">
      {entries.map((entry) => (
        <FileRow key={entry.id} entry={entry} load={loadOrFail} />
      ))}
      {entries.length >= 2 && (
        <button
          type="button"
          onClick={zipAll}
          disabled={zipping}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 hover:text-zinc-100 disabled:opacity-60"
        >
          {zipping ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          Download all (.zip)
        </button>
      )}
    </div>
  );
}

function FileRow({ entry, load }: { entry: Entry; load: (entry: Entry) => Promise<Blob | undefined> }) {
  const [preview, setPreview] = useState<{ text?: string; image?: string } | null>(null);
  const canPreview = (isTextMime(entry.mime) || entry.mime.startsWith("image/")) && entry.size <= PREVIEW_LIMIT * 10;

  const togglePreview = async () => {
    if (preview) return setPreview(null);
    const blob = await load(entry);
    if (!blob) return;
    if (entry.mime.startsWith("image/") && entry.mime !== "image/svg+xml") setPreview({ image: URL.createObjectURL(blob) });
    else setPreview({ text: (await blob.text()).slice(0, PREVIEW_LIMIT) });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50">
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-zinc-800 text-zinc-400">
          <FileText className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-zinc-100" title={entry.zipPath}>
            {entry.name}
          </div>
          <div className="text-xs text-zinc-500">
            {formatBytes(entry.size)} · {entry.origin === "sandbox" ? "from sandbox" : "generated"}
            {entry.incomplete ? " · may be cut off" : ""}
          </div>
        </div>
        {canPreview && (
          <button
            type="button"
            onClick={togglePreview}
            className="hidden items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 sm:inline-flex"
          >
            {preview ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            {preview ? "Hide" : "Preview"}
          </button>
        )}
        <button
          type="button"
          onClick={async () => {
            const blob = await load(entry);
            if (blob) downloadBlob(blob, entry.name);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white"
        >
          <Download className="size-3.5" />
          Download
        </button>
      </div>
      {preview?.text !== undefined && (
        <pre className="max-h-80 overflow-auto border-t border-zinc-800 bg-black/30 p-3 font-mono text-xs leading-relaxed text-zinc-300">{preview.text}</pre>
      )}
      {preview?.image && (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL
        <img src={preview.image} alt={entry.name} className="max-h-96 w-full border-t border-zinc-800 object-contain" />
      )}
    </div>
  );
}
