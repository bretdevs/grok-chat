import type { Source } from "@/lib/types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;

export function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** `response.citations`: every URL the model saw, as strings (or { url } objects). */
export function citationUrls(response: unknown): string[] {
  if (!isObj(response) || !Array.isArray(response.citations)) return [];
  return response.citations
    .map((c) => (typeof c === "string" ? c : isObj(c) && typeof c.url === "string" ? c.url : ""))
    .map(normalizeUrl)
    .filter((u): u is string => Boolean(u));
}

/** One `url_citation` annotation; numeric titles ("1") are inline markers, not page titles. */
export function annotationSource(annotation: unknown): Source | null {
  if (!isObj(annotation) || typeof annotation.url !== "string") return null;
  if (annotation.type !== undefined && annotation.type !== "url_citation") return null;
  const url = normalizeUrl(annotation.url);
  if (!url) return null;
  const title = typeof annotation.title === "string" && !/^\[?\d+\]?$/.test(annotation.title.trim()) ? annotation.title.trim() : undefined;
  return { url, title };
}

/** Annotations from the output_text parts of a message output item. */
export function annotationSources(item: unknown): Source[] {
  if (!isObj(item) || !Array.isArray(item.content)) return [];
  const out: Source[] = [];
  for (const part of item.content) {
    if (!isObj(part) || !Array.isArray(part.annotations)) continue;
    for (const ann of part.annotations) {
      const source = annotationSource(ann);
      if (source) out.push(source);
    }
  }
  return out;
}

/** `[[1]](https://...)` inline citations in reply text. */
export function inlineCitationUrls(text: string): string[] {
  const urls: string[] = [];
  for (const m of text.matchAll(/\[\[\d+\]\]\((https?:\/\/[^\s)]+)\)/g)) {
    const url = normalizeUrl(m[1]);
    if (url) urls.push(url);
  }
  return urls;
}

/** Dedupes by URL and keeps the first real title. */
export function mergeSources(existing: Source[] | undefined, incoming: Source[]): Source[] {
  const byUrl = new Map<string, Source>();
  for (const s of [...(existing ?? []), ...incoming]) {
    const url = normalizeUrl(s.url);
    if (!url) continue;
    const prev = byUrl.get(url);
    if (!prev) byUrl.set(url, { url, title: s.title });
    else if (!prev.title && s.title) prev.title = s.title;
  }
  return [...byUrl.values()];
}
