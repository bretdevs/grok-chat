import { MAX_SANDBOX_FILE_BYTES, MAX_XAI_FILE_BYTES, type UploadLimits } from "./types";

const MiB = 1024 * 1024;

/** Vercel functions reject request bodies over 4.5 MB; a normal Node server has no such cap. */
export function uploadLimits(): UploadLimits {
  const vercel = Boolean(process.env.VERCEL);
  return {
    chunkBytes: (vercel ? 4 : 16) * MiB,
    maxRequestBytes: vercel ? 4_400_000 : 64 * MiB,
    xaiFileBytes: MAX_XAI_FILE_BYTES,
    sandboxFileBytes: MAX_SANDBOX_FILE_BYTES,
  };
}
