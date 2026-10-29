export const SANDBOX_HOME = "/home/user";
export const UPLOAD_DIR = "/home/user/uploaded";
export const WORK_DIR = "/home/user/work";
export const OUT_DIR = "/home/user/out";

/** Appended to a user turn whose attachments were copied into the sandbox. */
export function sandboxBlock(files: { path: string; bytes: number }[]): string {
  return [
    "[sandbox]",
    "uploads:",
    ...files.map((f) => `- ${f.path} (${f.bytes} bytes)`),
    `cwd: ${WORK_DIR}`,
    `write artifacts to ${OUT_DIR} then call get_sandbox_files`,
    "[/sandbox]",
  ].join("\n");
}
