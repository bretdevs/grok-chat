import type { ApiEndpoint } from "@/lib/types";

/** Override to point at a proxy, an OpenAI-compatible gateway or a local mock; the default is the public xAI API. */
export const XAI_BASE_URL = process.env.XAI_BASE_URL?.trim() || "https://api.x.ai/v1";

export function apiEndpoint(): ApiEndpoint {
  let host = XAI_BASE_URL;
  try {
    host = new URL(XAI_BASE_URL).host;
  } catch {
    // not a URL; show it as given
  }
  return { host, custom: host !== "api.x.ai" };
}
