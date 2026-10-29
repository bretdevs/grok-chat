export const SUBMIT_RESULT_NAME = "submit_result";

/** Structured final answer, like response_format but as a function tool. */
export const SUBMIT_RESULT_TOOL = {
  type: "function",
  name: SUBMIT_RESULT_NAME,
  description:
    "Submit the complete final assistant message the UI should display. Call exactly once when you are done. Put the full markdown answer in `text`.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string" },
    },
    required: ["text"],
  },
} as const;

/** The tool output that closes a submit_result call. */
export const SUBMIT_RESULT_OUTPUT = JSON.stringify({ ok: true });

export function parseSubmitText(args: string): string {
  try {
    const value: unknown = JSON.parse(args);
    if (value && typeof value === "object" && typeof (value as { text?: unknown }).text === "string") {
      return (value as { text: string }).text;
    }
  } catch {
    // incomplete or invalid JSON
  }
  return "";
}

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\", "/": "/" };

/** Decodes the `text` string out of submit_result arguments while they stream in. */
export class SubmitTextStream {
  private buffer = "";
  private pos = -1;
  private finished = false;
  shown = false;

  /** Returns the newly decoded characters. */
  push(chunk: string): string {
    this.buffer += chunk;
    if (this.finished) return "";
    if (this.pos < 0) {
      const m = /"text"\s*:\s*"/.exec(this.buffer);
      if (!m) return "";
      this.pos = m.index + m[0].length;
    }
    let out = "";
    while (this.pos < this.buffer.length) {
      const ch = this.buffer[this.pos];
      if (ch === '"') {
        this.finished = true;
        break;
      }
      if (ch !== "\\") {
        out += ch;
        this.pos++;
        continue;
      }
      if (this.pos + 1 >= this.buffer.length) break;
      const next = this.buffer[this.pos + 1];
      if (next === "u") {
        if (this.pos + 6 > this.buffer.length) break;
        out += String.fromCharCode(parseInt(this.buffer.slice(this.pos + 2, this.pos + 6), 16));
        this.pos += 6;
        continue;
      }
      out += ESCAPES[next] ?? next;
      this.pos += 2;
    }
    return out;
  }
}
