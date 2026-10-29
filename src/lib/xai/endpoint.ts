import type { ApiEndpoint } from "@/lib/types";

/** Override to point at a proxy, an OpenAI-compatible gateway or a local mock; the default is the public xAI API. */
export const XAI_BASE_URL = process.env.XAI_BASE_URL?.trim() || "https://api.x.ai/v1";
/** "on" or "off" overrides whether turns are chained with previous_response_id. */
const CHAIN = process.env.XAI_CHAIN_RESPONSES?.trim().toLowerCase();

export function apiEndpoint(): ApiEndpoint {
  let host = XAI_BASE_URL;
  try {
    host = new URL(XAI_BASE_URL).host;
  } catch {
    // not a URL; show it as given
  }
  const custom = host !== "api.x.ai";
  // Gateways may send each request to a different upstream account, where a previous_response_id doesn't exist.
  const chain = CHAIN === "on" ? true : CHAIN === "off" ? false : !custom;
  return { host, custom, chain };
}
