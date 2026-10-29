import { CommandExitError, type Sandbox } from "e2b";
import { UPLOAD_DIR } from "@/lib/sandbox-paths";
import { errorText } from "@/lib/utils";
import { UpstreamError } from "@/lib/xai/client";
import { safeFileName } from "./sandbox";
import { shellQuote } from "./shell";

/** Partial uploads are assembled here, out of sight of the model, then moved into /home/user/uploaded. */
const STAGING = "/home/user/.grok-chat-uploads";

/** Creates the staging folder and removes parts of uploads that stopped more than 30 minutes ago. */
export async function prepareSandboxUploads(sbx: Sandbox): Promise<void> {
  await run(sbx, `mkdir -p ${STAGING} && find ${STAGING} -type f -mmin +30 -delete`);
}

/**
 * Writes one chunk of a large upload. dd places it at its own offset, so chunks can
 * arrive in any order and in parallel, and the disk only ever holds one copy of the file.
 */
export async function writeSandboxChunk(sbx: Sandbox, uploadId: string, index: number, chunkBytes: number, data: ArrayBuffer): Promise<void> {
  const part = `${STAGING}/${uploadId}.${index}`;
  const target = `${STAGING}/${uploadId}.upload`;
  await sbx.files.write(part, data);
  await run(sbx, `dd if=${part} of=${target} bs=${chunkBytes} seek=${index} conv=notrunc 2>/dev/null && rm -f ${part}`);
}

/** Checks every byte arrived, then moves the file to /home/user/uploaded/<name>. */
export async function finishSandboxUpload(sbx: Sandbox, uploadId: string, rawName: string, size: number): Promise<{ path: string; bytes: number }> {
  const staged = `${STAGING}/${uploadId}.upload`;
  const info = await sbx.files.getInfo(staged).catch(() => null);
  if (!info || info.size < size) {
    throw new UpstreamError(`The upload is incomplete: ${info?.size ?? 0} of ${size} bytes arrived.`, 409, "server");
  }
  const path = `${UPLOAD_DIR}/${safeFileName(rawName)}`;
  const trim = info.size > size ? `truncate -s ${size} ${shellQuote(staged)} && ` : "";
  await run(sbx, `${trim}mkdir -p ${UPLOAD_DIR} && mv -f ${shellQuote(staged)} ${shellQuote(path)}`);
  return { path, bytes: size };
}

/** Deletes everything left from one upload (chunk parts and the partly assembled file). */
export async function cancelSandboxUpload(sbx: Sandbox, uploadId: string): Promise<void> {
  await run(sbx, `rm -f ${STAGING}/${uploadId}.*`);
}

async function run(sbx: Sandbox, command: string): Promise<void> {
  try {
    await sbx.commands.run(command, { timeoutMs: 120_000 });
  } catch (err) {
    const detail = err instanceof CommandExitError ? err.stderr || err.error || `exit ${err.exitCode}` : errorText(err);
    throw new Error(`Sandbox upload step failed: ${detail}`);
  }
}
