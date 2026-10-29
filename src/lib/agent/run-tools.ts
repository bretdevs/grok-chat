import { posix } from "node:path";
import { CommandExitError, TimeoutError, type CommandHandle, type Sandbox } from "e2b";
import { mimeFromName } from "@/lib/mime";
import { SANDBOX_HOME, WORK_DIR } from "@/lib/sandbox-paths";
import type { StreamEvent } from "@/lib/types";
import { clip, errorText } from "@/lib/utils";
import { shellQuote } from "./shell";

/** Cap on file text sent back to the model. */
export const MODEL_TEXT_LIMIT = 80_000;
/** Cap on tool output streamed to the browser. */
export const UI_TEXT_LIMIT = 20_000;

const MAX_DELIVER_BYTES = 25 * 1024 * 1024;
const MAX_READ_BYTES = 2_000_000;
const TMP_DIR = "/tmp/grok-chat";
const BROWSER_SCRIPT_PATH = `${TMP_DIR}/browser_open.py`;
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export type ToolContext = {
  sbx: Sandbox;
  callId: string;
  emit: (event: StreamEvent) => void;
  signal: AbortSignal;
  /** Epoch ms when the turn must stop; long commands are clamped to it. */
  deadline: number;
};

export type ToolOutcome = { ok: boolean; forModel: Record<string, unknown>; forUi: Record<string, unknown> };

export async function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  try {
    switch (name) {
      case "run_terminal_cmd":
        return await runTerminal(args, ctx);
      case "file":
        return await runFile(args, ctx);
      case "browser_open":
        return await browserOpen(args, ctx);
      case "get_sandbox_files":
        return await getSandboxFiles(args, ctx);
      default:
        return fail(`Unknown tool "${name}".`);
    }
  } catch (err) {
    return fail(errorText(err));
  }
}

export function fail(message: string, extra: Record<string, unknown> = {}): ToolOutcome {
  return { ok: false, forModel: { error: message, ...extra }, forUi: { error: message, ...extra } };
}

function ok(forModel: Record<string, unknown>, forUi: Record<string, unknown> = forModel): ToolOutcome {
  return { ok: true, forModel, forUi };
}

async function runTerminal(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const command = typeof args.command === "string" ? args.command.trim() : "";
  if (!command) return fail("command must be a non-empty string.");
  const cwd = resolvePath(args.cwd) ?? WORK_DIR;
  const secondsLeft = Math.floor((ctx.deadline - Date.now()) / 1000) - 5;
  const timeoutSec = Math.max(1, Math.min(clampNumber(args.timeout_sec, 1, 300, 60), secondsLeft));

  const stdout = new OutputBuffer(24_000, 36_000);
  const stderr = new OutputBuffer(8_000, 12_000);
  const live = liveOutput(ctx);
  const started = Date.now();
  let exitCode: number | null = null;
  let timedOut = false;
  let error: string | undefined;
  let handle: CommandHandle | undefined;
  const kill = () => {
    void handle?.kill().catch(() => false);
  };
  ctx.signal.addEventListener("abort", kill, { once: true });
  try {
    handle = await ctx.sbx.commands.run(command, {
      cwd,
      background: true,
      timeoutMs: timeoutSec * 1000,
      onStdout: (data) => {
        stdout.push(data);
        live(data);
      },
      onStderr: (data) => {
        stderr.push(data);
        live(data);
      },
    });
    if (ctx.signal.aborted) kill();
    exitCode = (await handle.wait()).exitCode;
  } catch (err) {
    if (err instanceof CommandExitError) {
      exitCode = err.exitCode;
      error = err.error || undefined;
    } else if (err instanceof TimeoutError || /timed? ?out|deadline/i.test(errorText(err))) {
      timedOut = true;
      kill();
    } else if (ctx.signal.aborted) {
      error = "Stopped by the user.";
    } else {
      throw err;
    }
  } finally {
    ctx.signal.removeEventListener("abort", kill);
  }

  const durationMs = Date.now() - started;
  const forModel: Record<string, unknown> = {
    command,
    cwd,
    exit_code: exitCode,
    stdout: stdout.toString(),
    stderr: stderr.toString(),
    duration_ms: durationMs,
  };
  if (timedOut) forModel.timed_out = `killed after ${timeoutSec}s`;
  if (error) forModel.error = error;
  return { ok: exitCode === 0 && !timedOut, forModel, forUi: { exitCode, durationMs, cwd, timedOut, error } };
}

async function runFile(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const action = typeof args.action === "string" ? args.action : "";
  const path = resolvePath(args.path);
  if (!path) return fail("path is required.");
  if (!underHome(path)) return fail(`Paths must be under ${SANDBOX_HOME}. Use run_terminal_cmd for other locations.`);
  const { sbx } = ctx;

  switch (action) {
    case "read": {
      const info = await sbx.files.getInfo(path);
      if (info.type === "dir") return fail(`${path} is a directory. Use action "list".`);
      if (info.size > MAX_READ_BYTES) {
        return fail(`${path} is ${info.size} bytes. Read part of it with run_terminal_cmd (head, sed -n, grep).`);
      }
      const bytes = await sbx.files.read(path, { format: "bytes" });
      if (looksBinary(bytes)) {
        return fail(`${path} looks binary (${bytes.length} bytes). Inspect it with run_terminal_cmd or deliver it with get_sandbox_files.`);
      }
      const text = new TextDecoder().decode(bytes);
      return ok(
        { path, bytes: bytes.length, content: clip(text, MODEL_TEXT_LIMIT) },
        { path, bytes: bytes.length, content: clip(text, UI_TEXT_LIMIT) },
      );
    }
    case "write": {
      const content = typeof args.content === "string" ? args.content : "";
      await sbx.files.makeDir(posix.dirname(path));
      await sbx.files.write(path, content);
      return ok({ path, bytes: Buffer.byteLength(content), written: true });
    }
    case "edit": {
      const oldStr = typeof args.old_str === "string" ? args.old_str : "";
      const newStr = typeof args.new_str === "string" ? args.new_str : "";
      if (!oldStr) return fail("old_str is required for edit.");
      const current = await sbx.files.read(path);
      const at = current.indexOf(oldStr);
      if (at === -1) return fail("old_str not found");
      await sbx.files.write(path, current.slice(0, at) + newStr + current.slice(at + oldStr.length));
      const left = current.split(oldStr).length - 2;
      return ok(
        { path, replaced: 1, ...(left > 0 ? { other_matches_left: left } : {}) },
        { path, replaced: 1, oldStr: clip(oldStr, 4000), newStr: clip(newStr, 4000) },
      );
    }
    case "list": {
      const entries = await sbx.files.list(path);
      const shown = entries.slice(0, 500).map((e) => ({ name: e.name, type: e.type ?? "file", size: e.size }));
      return ok({ path, entries: shown, ...(entries.length > shown.length ? { total: entries.length } : {}) });
    }
    case "delete": {
      if (path === SANDBOX_HOME) return fail(`Refusing to delete ${SANDBOX_HOME}.`);
      await sbx.files.remove(path);
      return ok({ path, deleted: true });
    }
    case "mkdir": {
      await sbx.files.makeDir(path);
      return ok({ path, created: true });
    }
    default:
      return fail(`Unknown action "${action}". Use read, write, edit, list, delete or mkdir.`);
  }
}

async function browserOpen(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const url = typeof args.url === "string" ? args.url.trim() : "";
  if (!/^https?:\/\//i.test(url)) return fail("url must start with http:// or https://");
  const waitMs = clampNumber(args.wait_ms, 0, 30_000, 3000);
  const selector = typeof args.selector === "string" ? args.selector : "";
  const shot = `${TMP_DIR}/shot-${Date.now()}.png`;

  await ctx.sbx.files.write(BROWSER_SCRIPT_PATH, BROWSER_SCRIPT);
  const payload = Buffer.from(JSON.stringify({ url, wait_ms: waitMs, selector, shot })).toString("base64");
  const run = await runQuiet(ctx, `python3 ${BROWSER_SCRIPT_PATH} ${payload}`, 90 + Math.ceil(waitMs / 1000));
  let page = parseResult(run.stdout);

  if (!page?.ok) {
    // No Python, the script crashed, or its fetch failed: plain curl, converted to text here.
    const curl = await runQuiet(ctx, `curl -sSL --max-time 30 -A ${shellQuote(USER_AGENT)} ${shellQuote(url)} | head -c 3000000`, 45);
    if (!curl.stdout.trim()) {
      const reason = (typeof page?.error === "string" && page.error) || curl.stderr || run.stderr || "no response";
      return fail(`Could not open ${url}: ${clip(reason, 500)}`);
    }
    page = {
      ok: true,
      engine: "curl",
      url,
      title: titleFromHtml(curl.stdout),
      text: htmlToText(curl.stdout).slice(0, 20_000),
      note: "The headless browser was not available, so the page was fetched with curl. No JavaScript ran and there is no screenshot.",
    };
  }

  let screenshot = false;
  if (typeof page.screenshot === "string") {
    try {
      const bytes = await ctx.sbx.files.read(page.screenshot, { format: "bytes" });
      ctx.emit({ type: "screenshot", callId: ctx.callId, b64: Buffer.from(bytes).toString("base64"), mime: "image/png" });
      screenshot = true;
      await ctx.sbx.files.remove(page.screenshot).catch(() => undefined);
    } catch {
      // keep the text result even if the screenshot is unreadable
    }
  }

  const text = typeof page.text === "string" ? page.text : "";
  const note = typeof page.note === "string" ? page.note : undefined;
  return ok(
    {
      url: page.url,
      title: page.title,
      engine: page.engine,
      text,
      screenshot: screenshot ? "A PNG screenshot was shown to the user." : "none",
      ...(note ? { note } : {}),
    },
    { url: page.url, title: page.title, engine: page.engine, note, text: clip(text, 3000) },
  );
}

async function getSandboxFiles(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const paths = Array.isArray(args.paths) ? args.paths.filter((p): p is string => typeof p === "string") : [];
  if (!paths.length) return fail("paths must be a non-empty array of absolute paths.");
  const delivered: { name: string; path: string; bytes: number; mime: string }[] = [];
  const errors: { path: string; error: string }[] = [];

  for (const raw of paths.slice(0, 20)) {
    const path = resolvePath(raw);
    if (!path) {
      errors.push({ path: raw, error: "not a valid path" });
      continue;
    }
    try {
      const info = await ctx.sbx.files.getInfo(path);
      let source = path;
      let name = posix.basename(path) || "file";
      if (info.type === "dir") {
        // Zip folders with Python's zipfile module so no zip binary is needed.
        source = `${TMP_DIR}/${name}.zip`;
        const zip = await runQuiet(
          ctx,
          `mkdir -p ${TMP_DIR} && rm -f ${shellQuote(source)} && cd ${shellQuote(posix.dirname(path))} && python3 -m zipfile -c ${shellQuote(source)} ${shellQuote(name)}`,
          120,
        );
        if (zip.exitCode !== 0) throw new Error(`could not zip the folder: ${clip(zip.stderr, 300)}`);
        name = `${name}.zip`;
      }
      const size = source === path ? info.size : (await ctx.sbx.files.getInfo(source)).size;
      if (size > MAX_DELIVER_BYTES) {
        errors.push({ path, error: `${size} bytes is over the 25 MB limit` });
        continue;
      }
      const bytes = await ctx.sbx.files.read(source, { format: "bytes" });
      const mime = mimeFromName(name);
      ctx.emit({ type: "file", callId: ctx.callId, name, path, mime, bytes: bytes.length, b64: Buffer.from(bytes).toString("base64") });
      delivered.push({ name, path, bytes: bytes.length, mime });
    } catch (err) {
      errors.push({ path, error: errorText(err) });
    }
  }

  const summary = delivered.map((f) => `${f.name} (${f.bytes} bytes)`).join(", ");
  const forModel: Record<string, unknown> = {
    delivered_to_user: summary || "nothing",
    files: delivered.map(({ name, bytes, mime }) => ({ name, bytes, mime })),
  };
  if (errors.length) forModel.errors = errors;
  return { ok: delivered.length > 0, forModel, forUi: { files: delivered, errors } };
}

/** Keeps the start and the end of long command output. */
class OutputBuffer {
  private head = "";
  private tail = "";
  private dropped = 0;

  constructor(
    private readonly headMax: number,
    private readonly tailMax: number,
  ) {}

  push(chunk: string): void {
    let rest = chunk;
    if (this.head.length < this.headMax) {
      const take = rest.slice(0, this.headMax - this.head.length);
      this.head += take;
      rest = rest.slice(take.length);
    }
    if (!rest) return;
    this.tail += rest;
    if (this.tail.length > this.tailMax) {
      this.dropped += this.tail.length - this.tailMax;
      this.tail = this.tail.slice(-this.tailMax);
    }
  }

  toString(): string {
    return this.dropped ? `${this.head}\n…[${this.dropped} characters omitted]…\n${this.tail}` : this.head + this.tail;
  }
}

/** Streams command output to the browser, clipped to what the UI can render. */
function liveOutput(ctx: ToolContext): (data: string) => void {
  let sent = 0;
  let clipped = false;
  return (data) => {
    if (sent < UI_TEXT_LIMIT) {
      const piece = data.slice(0, UI_TEXT_LIMIT - sent);
      sent += piece.length;
      ctx.emit({ type: "tool_stdout", callId: ctx.callId, text: piece });
    } else if (!clipped) {
      clipped = true;
      ctx.emit({ type: "tool_stdout", callId: ctx.callId, text: "\n[output clipped here; the model still sees up to 80k characters]\n" });
    }
  };
}

async function runQuiet(ctx: ToolContext, command: string, timeoutSec: number): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const r = await ctx.sbx.commands.run(command, { timeoutMs: timeoutSec * 1000 });
    return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr };
  } catch (err) {
    if (err instanceof CommandExitError) return { exitCode: err.exitCode, stdout: err.stdout, stderr: err.stderr };
    return { exitCode: -1, stdout: "", stderr: errorText(err) };
  }
}

function resolvePath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let p = raw.trim();
  if (p === "~") p = SANDBOX_HOME;
  else if (p.startsWith("~/")) p = SANDBOX_HOME + p.slice(1);
  if (!p.startsWith("/")) p = posix.join(WORK_DIR, p);
  const normalized = posix.normalize(p);
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

function underHome(path: string): boolean {
  return path === SANDBOX_HOME || path.startsWith(`${SANDBOX_HOME}/`);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

function parseResult(stdout: string): Record<string, unknown> | null {
  const line = stdout
    .split("\n")
    .reverse()
    .find((l) => l.startsWith("__RESULT__"));
  if (!line) return null;
  try {
    return JSON.parse(line.slice("__RESULT__".length)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function titleFromHtml(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? decodeEntities(m[1]).trim() : "";
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer|pre|table)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Runs inside the sandbox: Playwright when installed, otherwise a no-JavaScript fetch. */
const BROWSER_SCRIPT = String.raw`import base64, json, re, sys

args = json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))
url = args["url"]
wait_ms = int(args.get("wait_ms") or 0)
selector = args.get("selector") or None
shot = args["shot"]
LIMIT = 20000
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"


def emit(obj):
    sys.stdout.write("__RESULT__" + json.dumps(obj) + "\n")
    sys.stdout.flush()


def tidy(text):
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    return re.sub(r"\n\s*\n+", "\n\n", text).strip()


def fetch_without_js(note):
    import html.parser
    import urllib.request

    class Extract(html.parser.HTMLParser):
        SKIP = {"script", "style", "noscript", "template", "svg"}
        BLOCK = {"p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "section", "article", "header", "footer", "pre", "table"}

        def __init__(self):
            super().__init__()
            self.skip = 0
            self.parts = []
            self.title = ""
            self.in_title = False

        def handle_starttag(self, tag, attrs):
            if tag in self.SKIP:
                self.skip += 1
            elif tag == "title":
                self.in_title = True
            elif tag in self.BLOCK:
                self.parts.append("\n")

        def handle_endtag(self, tag):
            if tag in self.SKIP and self.skip:
                self.skip -= 1
            elif tag == "title":
                self.in_title = False
            elif tag in self.BLOCK:
                self.parts.append("\n")

        def handle_data(self, data):
            if self.in_title:
                self.title += data
            elif not self.skip:
                self.parts.append(data)

    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=30) as response:
        final_url = response.geturl()
        ctype = response.headers.get("content-type", "")
        raw = response.read(5000000)
    match = re.search(r"charset=([\w-]+)", ctype)
    body = raw.decode(match.group(1) if match else "utf-8", errors="replace")
    if "html" in ctype or body.lstrip()[:1] == "<":
        parser = Extract()
        parser.feed(body)
        text, title = "".join(parser.parts), parser.title.strip()
    else:
        text, title = body, ""
    emit({"ok": True, "engine": "urllib", "url": final_url, "title": title, "text": tidy(text)[:LIMIT], "note": note})


try:
    from playwright.sync_api import sync_playwright
except Exception:
    sync_playwright = None

if sync_playwright is None:
    try:
        fetch_without_js("Playwright is not installed in this sandbox, so no JavaScript ran and there is no screenshot. Install it with: pip install playwright && playwright install --with-deps chromium")
    except Exception as exc:
        emit({"ok": False, "error": f"{type(exc).__name__}: {exc}"})
    sys.exit(0)

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1280, "height": 800}, user_agent=UA)
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
        note = None
        if selector:
            try:
                page.wait_for_selector(selector, timeout=max(wait_ms, 1000) + 10000)
            except Exception:
                note = "The selector " + selector + " did not appear."
        if wait_ms:
            page.wait_for_timeout(wait_ms)
        title = page.title()
        try:
            text = page.inner_text("body")
        except Exception:
            text = ""
        page.screenshot(path=shot)
        result = {"ok": True, "engine": "playwright", "url": page.url, "title": title, "text": tidy(text)[:LIMIT], "screenshot": shot}
        if note:
            result["note"] = note
        browser.close()
        emit(result)
except Exception as exc:
    try:
        fetch_without_js("The headless browser failed (" + type(exc).__name__ + ": " + str(exc)[:200] + "), so the page was fetched without JavaScript and there is no screenshot.")
    except Exception as exc2:
        emit({"ok": False, "error": type(exc2).__name__ + ": " + str(exc2)})
`;
