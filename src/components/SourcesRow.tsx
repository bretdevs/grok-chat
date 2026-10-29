"use client";

import { Globe } from "lucide-react";
import { useState } from "react";
import type { Source } from "@/lib/types";
import { hostOf } from "@/lib/xai/citations";

const VISIBLE = 6;

export function SourcesRow({ sources }: { sources: Source[] }) {
  const [all, setAll] = useState(false);
  if (!sources.length) return null;
  const shown = all ? sources : sources.slice(0, VISIBLE);
  return (
    <div className="mt-3">
      <div className="mb-1.5 text-xs text-zinc-500">Sources</div>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((source) => (
          <SourceChip key={source.url} source={source} />
        ))}
        {sources.length > VISIBLE && (
          <button
            type="button"
            onClick={() => setAll((v) => !v)}
            className="rounded-full border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-100"
          >
            {all ? "Show less" : `+${sources.length - VISIBLE} more`}
          </button>
        )}
      </div>
    </div>
  );
}

function SourceChip({ source }: { source: Source }) {
  const host = hostOf(source.url);
  const [iconFailed, setIconFailed] = useState(false);
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      title={source.title ? `${source.title}\n${source.url}` : source.url}
      className="inline-flex max-w-[15rem] items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 py-1 pl-1.5 pr-2.5 text-xs text-zinc-300 hover:border-zinc-700 hover:text-zinc-100"
    >
      {iconFailed ? (
        <Globe className="size-3.5 shrink-0 text-zinc-500" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- tiny third-party favicon
        <img
          src={`https://icons.duckduckgo.com/ip3/${host}.ico`}
          alt=""
          width={14}
          height={14}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setIconFailed(true)}
          className="size-3.5 shrink-0 rounded-sm"
        />
      )}
      <span className="truncate">{host}</span>
    </a>
  );
}
