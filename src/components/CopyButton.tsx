"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cn, copyText } from "@/lib/utils";

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        if (!(await copyText(text))) return;
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={cn("inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100", className)}
      aria-label={copied ? "Copied" : label}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      <span>{copied ? "Copied" : label}</span>
    </button>
  );
}
