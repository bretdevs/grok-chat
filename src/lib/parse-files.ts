import { mimeFromName } from "./mime";

export type GeneratedFile = {
  /** Download name (no folders). */
  name: string;
  /** Path inside a zip; may contain folders the model used. */
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  size: number;
  mime: string;
  /** The block was never closed, so the file may be cut off. */
  incomplete: boolean;
};

export type ParsedReply = {
  /** Markdown with file blocks removed. */
  text: string;
  files: GeneratedFile[];
  /** A block that is still streaming in. */
  pending: { name: string; size: number } | null;
};

const OPEN = /^ {0,3}:::file\s*\{([^}]*)\}\s*$/;
const DIRECTIVE_OPEN = /^ {0,3}:::[A-Za-z][\w-]*/;
const DIRECTIVE_CLOSE = /^ {0,3}:::\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const ATTR = /([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/g;
const PARTIAL_OPEN = /^ {0,3}:{1,3}(?:f(?:i(?:l(?:e(?:\{[^}]*)?)?)?)?)?$/;

type Fence = { char: string; len: number; at: number };

/**
 * Pulls `:::file{name="x"}` blocks (and the `FILE: name` + fenced code fallback) out of a reply.
 * With `streaming`, an unfinished block is reported as `pending` instead of leaking into the text.
 */
export function parseGeneratedFiles(input: string, opts: { streaming?: boolean } = {}): ParsedReply {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  const files: GeneratedFile[] = [];
  let pending: ParsedReply["pending"] = null;
  let fence: Fence | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const open = OPEN.exec(line);
    if (open) {
      const attrs = parseAttrs(open[1]);
      const close = findDirectiveClose(lines, i + 1);
      const body = lines.slice(i + 1, close === -1 ? lines.length : close).join("\n");
      // A fence opened right before the block is a wrapper the model added; drop it with its closer.
      let wrapper: Fence | null = null;
      if (fence && out.slice(fence.at + 1).every((l) => !l.trim())) {
        wrapper = fence;
        out.length = fence.at;
        fence = null;
      }
      if (close === -1 && opts.streaming) {
        pending = { name: cleanPath(attrs.name) || "file", size: body.length };
        break;
      }
      files.push(makeFile(attrs.name, attrs.encoding, body, close === -1, files.length));
      i = close === -1 ? lines.length : close + 1;
      if (wrapper) i = skipFenceClose(lines, i, wrapper);
      continue;
    }

    if (!fence) {
      const name = fallbackHeader(line);
      if (name) {
        let j = i + 1;
        while (j < lines.length && j <= i + 2 && !lines[j].trim()) j++;
        const f = j < lines.length ? FENCE.exec(lines[j]) : null;
        if (f && !(f[1][0] === "`" && f[2].includes("`"))) {
          const close = findFenceClose(lines, j + 1, f[1][0], f[1].length);
          const body = lines.slice(j + 1, close === -1 ? lines.length : close).join("\n");
          if (close === -1 && opts.streaming) {
            pending = { name: cleanPath(name), size: body.length };
            break;
          }
          files.push(makeFile(name, undefined, body, close === -1, files.length));
          i = close === -1 ? lines.length : close + 1;
          continue;
        }
        if (opts.streaming && j >= lines.length) {
          pending = { name: cleanPath(name), size: 0 };
          break;
        }
      }
    }

    // Track code fences in the prose so a wrapping fence can be recognised.
    const f = FENCE.exec(line);
    if (f) {
      if (!fence) {
        if (!(f[1][0] === "`" && f[2].includes("`"))) fence = { char: f[1][0], len: f[1].length, at: out.length };
      } else if (f[1][0] === fence.char && f[1].length >= fence.len && !f[2].trim()) {
        fence = null;
      }
    }
    out.push(line);
    i++;
  }

  // While streaming, hide a block opener that has only partly arrived.
  if (opts.streaming && !pending && out.length && PARTIAL_OPEN.test(out[out.length - 1])) out.pop();

  const text = out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .trimEnd();
  return { text, files, pending };
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of source.matchAll(ATTR)) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return attrs;
}

/** Finds the `:::` that closes a block, allowing nested directives such as `:::note`. */
function findDirectiveClose(lines: string[], start: number): number {
  let depth = 0;
  for (let k = start; k < lines.length; k++) {
    if (DIRECTIVE_CLOSE.test(lines[k])) {
      if (depth === 0) return k;
      depth--;
    } else if (DIRECTIVE_OPEN.test(lines[k])) {
      depth++;
    }
  }
  return -1;
}

function isFenceClose(line: string, char: string, len: number): boolean {
  const m = FENCE.exec(line);
  return !!m && m[1][0] === char && m[1].length >= len && !m[2].trim();
}

function findFenceClose(lines: string[], start: number, char: string, len: number): number {
  for (let k = start; k < lines.length; k++) if (isFenceClose(lines[k], char, len)) return k;
  return -1;
}

function skipFenceClose(lines: string[], from: number, wrapper: Fence): number {
  let j = from;
  while (j < lines.length && !lines[j].trim()) j++;
  return j < lines.length && isFenceClose(lines[j], wrapper.char, wrapper.len) ? j + 1 : from;
}

/** Matches `FILE: name.ext`, `**File:** \`name.ext\`` and similar headers. */
function fallbackHeader(line: string): string | null {
  const s = line
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/\*\*|__/g, "")
    .trim();
  const m = /^file\s*:\s*(?:`([^`]+)`|(\S+))\s*:?$/i.exec(s);
  if (!m) return null;
  const name = (m[1] ?? m[2]).trim();
  if (!name || name.length > 200) return null;
  return /[./]/.test(name) || /^(dockerfile|makefile|procfile|license|readme)$/i.test(name) ? name : null;
}

/** Removes folder tricks and characters that are invalid in file names. */
export function cleanPath(raw: string | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.replace(/[\u0000-\u001f<>:"|?*]/g, "_").trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/")
    .slice(-180);
}

function makeFile(
  rawName: string | undefined,
  encoding: string | undefined,
  body: string,
  incomplete: boolean,
  index: number,
): GeneratedFile {
  const path = cleanPath(rawName) || `file-${index + 1}.txt`;
  const name = path.split("/").pop() || path;
  const base64 = /^base64$/i.test(encoding ?? "");
  let content: string;
  if (base64) {
    content = body.replace(/\s+/g, "");
  } else {
    content = unwrapFence(body, name);
    if (content && !content.endsWith("\n")) content += "\n";
  }
  return {
    name,
    path,
    content,
    encoding: base64 ? "base64" : "utf8",
    size: base64 ? base64Size(content) : new TextEncoder().encode(content).length,
    mime: mimeFromName(name),
    incomplete,
  };
}

/** Strips one code fence wrapped around the whole file, unless the file is markdown. */
function unwrapFence(body: string, name: string): string {
  if (/\.(md|mdx|markdown)$/i.test(name)) return body;
  const lines = body.split("\n");
  let a = 0;
  let b = lines.length - 1;
  while (a <= b && !lines[a].trim()) a++;
  while (b > a && !lines[b].trim()) b--;
  if (b - a < 1) return body;
  const open = FENCE.exec(lines[a]);
  if (!open || /[`\s]/.test(open[2].trim())) return body;
  const char = open[1][0];
  const len = open[1].length;
  if (!isFenceClose(lines[b], char, len)) return body;
  for (let k = a + 1; k < b; k++) if (FENCE.exec(lines[k])?.[1][0] === char) return body;
  return lines.slice(a + 1, b).join("\n");
}

export function base64Size(b64: string): number {
  const s = b64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((s.length * 3) / 4) - pad);
}

export function decodeBase64(b64: string): Uint8Array<ArrayBuffer> {
  let s = b64
    .replace(/^data:[^,]*,/, "")
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/=+$/, "");
  if (s.length % 4 === 1) throw new Error("Invalid base64 data");
  s += "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  return bytes;
}

export function generatedFileBlob(file: GeneratedFile): Blob {
  if (file.encoding === "base64") return new Blob([decodeBase64(file.content)], { type: file.mime });
  const textual = file.mime.startsWith("text/") || /json|xml|javascript|yaml|svg|x-sh|sql/.test(file.mime);
  return new Blob([file.content], { type: textual ? `${file.mime};charset=utf-8` : file.mime });
}
