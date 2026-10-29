import "server-only";
import fs from "node:fs";
import path from "node:path";

const FALLBACK = `You are a helpful assistant.`;

function load(): string {
  const inline = process.env.SYSTEM_PROMPT?.trim();
  if (inline) return inline;

  const filePath = process.env.SYSTEM_PROMPT_PATH || path.join(process.cwd(), "secrets", "system-prompt.txt");
  try {
    const text = fs.readFileSync(filePath, "utf8").trim();
    if (text) return text;
  } catch {
    /* missing file is fine — local overlay is optional until you add it */
  }

  return FALLBACK;
}

export const SYSTEM_PROMPT = load();
