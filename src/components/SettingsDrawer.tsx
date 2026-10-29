"use client";

import { Eye, EyeOff, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatState } from "@/lib/client/use-chat";
import { MODELS } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SettingsDrawer({ chat }: { chat: ChatState }) {
  const { settings, closeSettings, prefs, updatePrefs } = chat;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeSettings();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeSettings]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close settings" className="absolute inset-0 bg-black/60" onClick={closeSettings} />
      <aside role="dialog" aria-modal="true" aria-label="Settings" className="relative flex h-full w-full max-w-md flex-col border-l border-zinc-800 bg-[#0e0e10] shadow-2xl">
        <header className="flex items-center justify-between border-b border-zinc-800 px-5 pb-3 pt-[max(env(safe-area-inset-top),0.75rem)]">
          <h2 className="text-sm font-semibold text-zinc-100">Settings</h2>
          <button type="button" onClick={closeSettings} aria-label="Close" className="grid size-8 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 space-y-7 overflow-y-auto px-5 py-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
          {settings.error && <p className="rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">{settings.error}</p>}

          <Section title="API keys">
            <KeyField
              id="xai-key"
              label="xAI API key"
              value={chat.apiKey}
              onSave={chat.setApiKey}
              placeholder="xai-…"
              autoFocus={settings.focus === "xai" || (!settings.focus && !chat.apiKey)}
              warn={(v) => (v && !v.startsWith("xai-") ? "xAI keys usually start with xai-." : "")}
              hint={
                <>
                  Create one at{" "}
                  <a href="https://console.x.ai" target="_blank" rel="noopener noreferrer" className="text-zinc-300 underline underline-offset-2">
                    console.x.ai
                  </a>
                  .
                </>
              }
            />
            <KeyField
              id="e2b-key"
              label="E2B API key"
              value={chat.e2bKey}
              onSave={chat.setE2bKey}
              placeholder="e2b_…"
              autoFocus={settings.focus === "e2b"}
              hint={
                <>
                  Needed for Agent mode. Get one at{" "}
                  <a href="https://e2b.dev" target="_blank" rel="noopener noreferrer" className="text-zinc-300 underline underline-offset-2">
                    e2b.dev
                  </a>
                  .{chat.serverE2b ? " This server also has a fallback key, so it is optional here." : ""}
                </>
              }
            />
            <p className="text-xs leading-relaxed text-zinc-500">
              Keys are stored only in this browser. Each request sends them to this app&apos;s server, which passes them to xAI or E2B and does not store or log them.
            </p>
          </Section>

          <Section title="Model">
            <ModelPicker model={chat.model} onChange={chat.setModel} />
          </Section>

          <Section title="Search" hint="Search is switched on or off per conversation from the composer. These choose which tools it uses.">
            <SwitchRow label="Web search" checked={prefs.web} onChange={(web) => updatePrefs({ web })} />
            <SwitchRow label="X search" checked={prefs.x} onChange={(x) => updatePrefs({ x })} />
            <div className="grid grid-cols-2 gap-3 pb-2 pl-0.5">
              <DateField label="X posts from" value={prefs.xFrom} onChange={(xFrom) => updatePrefs({ xFrom })} />
              <DateField label="X posts before" value={prefs.xTo} onChange={(xTo) => updatePrefs({ xTo })} />
            </div>
            <SwitchRow label="Code interpreter" hint="xAI's hosted Python. Separate from the Agent sandbox." checked={prefs.code} onChange={(code) => updatePrefs({ code })} />
          </Section>

          <Section title="Sampling">
            <Slider label="Temperature (Ask)" min={0} max={2} step={0.05} value={prefs.temperatureAsk} onChange={(temperatureAsk) => updatePrefs({ temperatureAsk })} />
            <Slider label="Temperature (Agent)" min={0} max={2} step={0.05} value={prefs.temperatureAgent} onChange={(temperatureAgent) => updatePrefs({ temperatureAgent })} />
            <Slider label="Top p" min={0} max={1} step={0.01} value={prefs.topP} onChange={(topP) => updatePrefs({ topP })} />
          </Section>

          <Section title="Requests">
            <label htmlFor="extra-instructions" className="mb-1.5 block text-sm text-zinc-200">
              Extra instructions (appended to the API instructions field)
            </label>
            <textarea
              id="extra-instructions"
              value={chat.extraInstructions}
              onChange={(e) => chat.setExtraInstructions(e.target.value)}
              rows={4}
              className="w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none"
            />
            <SwitchRow
              label="Structured final answer (submit_result tool)"
              hint="The model can hand back its final answer through a tool call."
              checked={prefs.submitResult}
              onChange={(submitResult) => updatePrefs({ submitResult })}
            />
            <SwitchRow
              label="Network retry"
              hint="Retries up to twice on 429, 5xx or a stream that returns nothing."
              checked={prefs.networkRetry}
              onChange={(networkRetry) => updatePrefs({ networkRetry })}
            />
          </Section>

          <Section title="Data">
            <ClearAll count={chat.conversations.length} onClear={chat.clearAll} />
          </Section>
        </div>
      </aside>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-xs font-medium text-zinc-500">{title}</h3>
      {hint && <p className="mb-2 text-xs leading-relaxed text-zinc-600">{hint}</p>}
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function KeyField(p: {
  id: string;
  label: string;
  value: string;
  onSave: (value: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  warn?: (value: string) => string;
  hint: ReactNode;
}) {
  const [draft, setDraft] = useState(p.value);
  const [show, setShow] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (p.autoFocus) input.current?.focus();
  }, [p.autoFocus]);
  const trimmed = draft.trim();
  const warning = p.warn?.(trimmed);

  return (
    <div>
      <label htmlFor={p.id} className="mb-1.5 flex items-center justify-between text-sm text-zinc-200">
        {p.label}
        {p.value && trimmed === p.value && <span className="text-xs text-emerald-400">Saved</span>}
      </label>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          p.onSave(trimmed);
        }}
      >
        <div className="relative min-w-0 flex-1">
          <input
            ref={input}
            id={p.id}
            type={show ? "text" : "password"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={p.placeholder}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2 pl-3 pr-9 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide key" : "Show key"}
            className="absolute inset-y-0 right-0 grid w-9 place-items-center text-zinc-500 hover:text-zinc-200"
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <button
          type="submit"
          disabled={trimmed === p.value}
          className="shrink-0 rounded-lg bg-zinc-100 px-3 text-sm font-medium text-zinc-900 hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-500"
        >
          Save
        </button>
      </form>
      {warning && <p className="mt-1.5 text-xs text-amber-300/80">{warning}</p>}
      <p className="mt-1.5 text-xs text-zinc-500">
        {p.hint}
        {p.value && (
          <button
            type="button"
            onClick={() => {
              setDraft("");
              p.onSave("");
            }}
            className="ml-2 text-zinc-400 underline underline-offset-2 hover:text-zinc-200"
          >
            Remove
          </button>
        )}
      </p>
    </div>
  );
}

function ModelPicker({ model, onChange }: { model: string; onChange: (model: string) => void }) {
  const known = (MODELS as readonly string[]).includes(model);
  const [custom, setCustom] = useState(known ? "" : model);
  const [usingCustom, setUsingCustom] = useState(!known);
  return (
    <div className="space-y-2">
      <select
        value={usingCustom ? "custom" : model}
        onChange={(e) => {
          if (e.target.value === "custom") return setUsingCustom(true);
          setUsingCustom(false);
          onChange(e.target.value);
        }}
        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none"
      >
        {MODELS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
        <option value="custom">Custom model id…</option>
      </select>
      {usingCustom && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (custom.trim()) onChange(custom.trim());
          }}
        >
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="grok-…"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
          />
          <button type="submit" className="rounded-lg bg-zinc-100 px-3 text-sm font-medium text-zinc-900 hover:bg-white">
            Use
          </button>
        </form>
      )}
    </div>
  );
}

function SwitchRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm text-zinc-200">{label}</div>
        {hint && <div className="mt-0.5 text-xs leading-relaxed text-zinc-500">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-zinc-100" : "bg-zinc-700")}
      >
        <span className={cn("absolute top-0.5 size-4 rounded-full transition-all", checked ? "left-[18px] bg-zinc-900" : "left-0.5 bg-zinc-300")} />
      </button>
    </div>
  );
}

function Slider({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  const id = label.toLowerCase().replace(/\W+/g, "-");
  return (
    <div>
      <label htmlFor={id} className="mb-1 flex items-center justify-between text-sm text-zinc-200">
        {label}
        <span className="font-mono text-xs text-zinc-400">{value.toFixed(2)}</span>
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-zinc-200" />
    </div>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-xs text-zinc-500">
      {label}
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 [color-scheme:dark] focus:border-zinc-600 focus:outline-none"
      />
    </label>
  );
}

function ClearAll({ count, onClear }: { count: number; onClear: () => void }) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);
  return (
    <div>
      <button
        type="button"
        disabled={!count}
        onClick={() => {
          if (!confirming) return setConfirming(true);
          setConfirming(false);
          onClear();
        }}
        className={cn(
          "rounded-lg border px-3 py-2 text-sm disabled:opacity-40",
          confirming ? "border-red-800 bg-red-950/60 text-red-200" : "border-zinc-800 text-zinc-300 hover:border-zinc-700",
        )}
      >
        {confirming ? `Delete ${count} conversation${count === 1 ? "" : "s"}?` : "Delete all conversations"}
      </button>
      <p className="mt-1.5 text-xs text-zinc-500">Also destroys their sandboxes.</p>
    </div>
  );
}
