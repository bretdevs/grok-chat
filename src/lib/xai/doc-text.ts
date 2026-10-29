import { strFromU8, unzipSync } from "fflate";
import { extOf, isTextName } from "@/lib/mime";
import { clip, errorText } from "@/lib/utils";
import { UpstreamError } from "./client";

/** Characters of one document sent as text (about 50k tokens). */
const DOC_TEXT_LIMIT = 200_000;
/** Unzipped size cap for .docx / .pptx, so a zip bomb can't exhaust memory. */
const MAX_UNZIPPED_BYTES = 64 * 1024 * 1024;

/**
 * Plain text of a document, for endpoints without a Files API. Reads text files, PDF, DOCX and PPTX;
 * anything else gets an error that says what to do instead.
 */
export async function documentText(file: File): Promise<string> {
  const ext = extOf(file.name);
  let text: string;
  if (isTextName(file.name) || file.type.startsWith("text/")) text = await file.text();
  else if (ext === "pdf") text = await pdfText(file);
  else if (ext === "docx" || ext === "pptx") text = officeText(file.name, new Uint8Array(await file.arrayBuffer()), ext);
  else throw new UpstreamError(`This API endpoint has no file upload, and ${file.name} can't be sent as text. Attach text, PDF, DOCX or PPTX files, or use Agent mode.`, 415, "server");
  if (!text.trim()) throw new UpstreamError(`No text found in ${file.name}. Scanned documents need Agent mode.`, 422, "server");
  return clip(text, DOC_TEXT_LIMIT);
}

async function pdfText(file: File): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  try {
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { text } = await extractText(pdf, { mergePages: false });
    return text.map((page, i) => `[page ${i + 1}]\n${page.trim()}`).join("\n\n");
  } catch (err) {
    throw new UpstreamError(`Couldn't read ${file.name}: ${errorText(err)}`, 422, "server");
  }
}

/** Paragraph text from the document part of a .docx, or from each slide of a .pptx. */
function officeText(name: string, data: Uint8Array, ext: "docx" | "pptx"): string {
  const wanted = (path: string) => (ext === "docx" ? path === "word/document.xml" : /^ppt\/slides\/slide\d+\.xml$/.test(path));
  let total = 0;
  let parts: Record<string, Uint8Array>;
  try {
    parts = unzipSync(data, {
      filter: (f) => {
        if (!wanted(f.name)) return false;
        total += f.originalSize;
        if (total > MAX_UNZIPPED_BYTES) throw new Error("it unpacks to more than 64 MB");
        return true;
      },
    });
  } catch (err) {
    throw new UpstreamError(`Couldn't read ${name}: ${errorText(err)}`, 422, "server");
  }
  const slideNo = (path: string) => Number(/(\d+)\.xml$/.exec(path)?.[1] ?? 0);
  return Object.keys(parts)
    .sort((a, b) => slideNo(a) - slideNo(b))
    .map((path, i) => (ext === "pptx" ? `[slide ${i + 1}]\n${xmlText(strFromU8(parts[path]))}` : xmlText(strFromU8(parts[path]))))
    .join("\n\n");
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function xmlText(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<(?:w:br|a:br)\b[^>]*\/>/g, "\n")
    .replace(/<\/(?:w:p|a:p)>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:(lt|gt|amp|quot|apos)|#(x?)([0-9a-f]+));/gi, (_, named: string, hex: string, code: string) =>
      named ? ENTITIES[named.toLowerCase()] : String.fromCodePoint(parseInt(code, hex ? 16 : 10)),
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
