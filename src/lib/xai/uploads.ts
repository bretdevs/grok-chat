import type OpenAI from "openai";
import { XAI_FILE_TTL_SECONDS, type UploadResult } from "@/lib/types";
import { docBlock } from "@/lib/doc-block";
import { extOf, mimeFromName } from "@/lib/mime";
import { describeError } from "./client";
import { documentText } from "./doc-text";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

export function isImageFile(file: File): boolean {
  const type = file.type.toLowerCase();
  return type ? IMAGE_TYPES.has(type) : IMAGE_EXTS.has(extOf(file.name));
}

export async function fileToDataUrl(file: File): Promise<string> {
  let type = file.type.toLowerCase();
  if (!IMAGE_TYPES.has(type)) type = mimeFromName(file.name);
  if (type === "image/jpg") type = "image/jpeg";
  return `data:${type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
}

/** Uploads a document to the xAI Files API with a 24h expiry and returns its file id. */
export async function uploadToXai(client: OpenAI, file: File, signal: AbortSignal, retries: number): Promise<string> {
  const fromName = mimeFromName(file.name);
  const type = fromName !== "application/octet-stream" ? fromName : file.type || fromName;
  const upload = file.type === type ? file : new File([await file.arrayBuffer()], file.name, { type });
  try {
    // xAI needs expires_after before the file part; the SDK writes multipart fields in key order.
    const created = await client.files.create(
      { expires_after: { anchor: "created_at", seconds: XAI_FILE_TTL_SECONDS }, purpose: "assistants", file: upload },
      { signal, maxRetries: retries },
    );
    return created.id;
  } catch (err) {
    const { status, message } = describeError(err);
    if (status !== 400 || !/expir/i.test(message)) throw err;
    const created = await client.files.create({ purpose: "assistants", file: upload }, { signal, maxRetries: retries });
    return created.id;
  }
}

/** Set once this endpoint has answered that it has no Files API; later uploads then skip the SDK's retries. */
let noFilesApi = false;

/** A document as the model gets it: an xAI file id, or its text when the endpoint has no Files API. */
export type PreparedDoc = { fileId: string } | { text: string };

export async function prepareDocument(client: OpenAI, file: File, signal: AbortSignal, retries: number): Promise<PreparedDoc> {
  try {
    return { fileId: await uploadToXai(client, file, signal, noFilesApi ? 0 : retries) };
  } catch (err) {
    // OpenAI-compatible gateways (new-api and its forks) answer 501 or 404 here, after checking the key.
    const { status } = describeError(err);
    if (signal.aborted || (status !== 404 && status !== 405 && status !== 501)) throw err;
    noFilesApi = true;
    return { text: await documentText(file) };
  }
}

export type PreparedUploads = { results: UploadResult[]; fileIds: string[]; images: string[]; docs: File[]; texts: string[] };

/** Ask mode: documents go to the Files API (or in as text where there is none), images become data URLs for input_image. */
export async function prepareXaiUploads(
  client: OpenAI,
  uploads: { file: File; key?: string }[],
  signal: AbortSignal,
  retries: number,
): Promise<PreparedUploads> {
  const prepared: PreparedUploads = { results: [], fileIds: [], images: [], docs: [], texts: [] };
  const settled = await Promise.all(
    uploads.map(async ({ file, key }) => {
      const kind = isImageFile(file) ? ("image" as const) : ("file" as const);
      const base = { key, name: file.name, bytes: file.size, kind };
      try {
        if (kind === "image") return { result: base, image: await fileToDataUrl(file) };
        const doc = await prepareDocument(client, file, signal, retries);
        if ("text" in doc) return { result: { ...base, inline: true }, text: docBlock(file.name, doc.text) };
        return { result: { ...base, fileId: doc.fileId }, doc: file };
      } catch (err) {
        if (signal.aborted) throw err;
        return { result: { ...base, error: describeError(err).message } };
      }
    }),
  );
  for (const item of settled) {
    prepared.results.push(item.result);
    if ("image" in item && item.image) prepared.images.push(item.image);
    if ("doc" in item && item.doc) prepared.docs.push(item.doc);
    if ("text" in item && item.text) prepared.texts.push(item.text);
    if ("fileId" in item.result && item.result.fileId) prepared.fileIds.push(item.result.fileId);
  }
  return prepared;
}

/** Plain-text view of documents for the Chat Completions fallback (best effort). */
export async function docsAsText(files: File[]): Promise<string> {
  const parts: string[] = [];
  for (const file of files) {
    try {
      parts.push(docBlock(file.name, await documentText(file)));
    } catch {
      parts.push(`(The attached file ${file.name} could not be read in this fallback mode.)`);
    }
  }
  return parts.join("\n\n");
}
