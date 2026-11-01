import type { Sandbox } from "e2b";

const FENCE = /:::file\{name="([^"]+)"(?:\s+encoding="([^"]+)")?\}[\r\n]+([\s\S]*?):::/g;
const MD = /```(?:[\w.+-]+)?[^\n]*\n([\s\S]*?)```/g;
const FILE_LINE = /^FILE:\s*(\S+)\s*$/m;

export type Harvested = { path: string; bytes: number };

function safeName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() || "file.txt";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

export function extractArtifacts(text: string): { name: string; content: string }[] {
  const out: { name: string; content: string }[] = [];
  let m: RegExpExecArray | null;
  const fences = new RegExp(FENCE);
  while ((m = fences.exec(text))) {
    const raw = m[2] === "base64" ? Buffer.from(m[3].trim(), "base64").toString("utf8") : m[3];
    out.push({ name: safeName(m[1]), content: raw.replace(/\n$/, "") });
  }
  if (out.length) return out;

  const named = text.match(FILE_LINE);
  const blocks = [...text.matchAll(MD)].map((x) => x[1]);
  if (named && blocks.length) {
    out.push({ name: safeName(named[1]), content: blocks[0].replace(/\n$/, "") });
    return out;
  }
  if (blocks.length === 1 && blocks[0].split("\n").length >= 8) {
    const guess =
      /(?:save|write|create).{0,40}([a-zA-Z0-9._-]+\.(py|js|ts|sh|rs|go|rb|php|c|cpp|java|json|toml|yml|yaml|md|txt))/i.exec(text);
    out.push({ name: safeName(guess?.[1] ?? "output.txt"), content: blocks[0].replace(/\n$/, "") });
  }
  return out;
}

export async function writeArtifacts(sbx: Sandbox, text: string): Promise<Harvested[]> {
  const files = extractArtifacts(text);
  const written: Harvested[] = [];
  for (const f of files) {
    const path = `/home/user/out/${f.name}`;
    await sbx.files.write(path, f.content);
    written.push({ path, bytes: Buffer.byteLength(f.content) });
  }
  return written;
}

export async function listOut(sbx: Sandbox): Promise<string[]> {
  const r = await sbx.commands.run("find /home/user/out /home/user/work -type f 2>/dev/null | head -200");
  return r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}
