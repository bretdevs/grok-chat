"use client";

import { FileText, X } from "lucide-react";
import { useBlobUrl } from "@/lib/client/blob-store";
import { cn, formatBytes } from "@/lib/utils";

export type Chip = {
  id: string;
  name: string;
  size: number;
  kind: "image" | "file";
  /** Object URL for a file still in the composer. */
  previewUrl?: string;
  /** Blob-store key for a sent image. */
  blobKey?: string;
  detail?: string;
};

export function FileChips({ items, onRemove, align = "start" }: { items: Chip[]; onRemove?: (id: string) => void; align?: "start" | "end" }) {
  return (
    <div className={cn("flex flex-wrap gap-2", align === "end" && "justify-end")}>
      {items.map((item) => (
        <FileChip key={item.id} item={item} onRemove={onRemove} />
      ))}
    </div>
  );
}

function FileChip({ item, onRemove }: { item: Chip; onRemove?: (id: string) => void }) {
  const stored = useBlobUrl(item.previewUrl ? undefined : item.blobKey);
  const thumb = item.previewUrl ?? stored;
  return (
    <div className="relative flex max-w-[16rem] items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/80 py-1.5 pl-1.5 pr-3 text-xs">
      {item.kind === "image" && thumb ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL
        <img src={thumb} alt="" className="size-9 shrink-0 rounded-lg object-cover" />
      ) : (
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-zinc-800 text-zinc-400">
          <FileText className="size-4" />
        </div>
      )}
      <div className="min-w-0">
        <div className="truncate text-zinc-200" title={item.name}>
          {item.name}
        </div>
        <div className="truncate text-zinc-500" title={item.detail}>
          {formatBytes(item.size)}
          {item.detail ? ` · ${item.detail}` : ""}
        </div>
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          aria-label={`Remove ${item.name}`}
          className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}
