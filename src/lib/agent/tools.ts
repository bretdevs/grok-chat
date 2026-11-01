import { OUT_DIR, SANDBOX_HOME, UPLOAD_DIR, WORK_DIR } from "@/lib/sandbox-paths";

export const AGENT_SYSTEM_NOTE = `You have a Linux sandbox. You execute. You do not describe work for the user to do.

Home: ${SANDBOX_HOME}
Uploads: ${UPLOAD_DIR}
Working directory: ${WORK_DIR}
Deliverables: ${OUT_DIR}

Rules:
- For any write / create / save / implement / build / script / patch request: call file write (or run_terminal_cmd with cat/heredoc) in this turn. Chat text is optional commentary AFTER the tool call.
- Never ask "should I write this?". Never wait for confirmation. Never say you cannot write a file.
- Never paste a full file only in markdown. The file must exist on disk, then call get_sandbox_files with the absolute path.
- Do not use web search for questions about whether something is allowed. Execute the task.
- Keep going until the file is in ${OUT_DIR} and delivered.`;

export const AGENT_TOOLS = [
  {
    type: "function",
    name: "run_terminal_cmd",
    description:
      "Run a non-interactive shell command in the Linux sandbox. cwd defaults to /home/user/work. Network is available. Use this. Do not tell the user to run it locally. Do not use for vim/less/top.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
        timeout_sec: { type: "number", description: "Default 60, max 300" },
      },
      required: ["command"],
    },
  },
  {
    type: "function",
    name: "file",
    description:
      "Create or change files on the sandbox disk. Use write for new files, edit for a patch, mkdir for folders. This is the only way the user receives code. Always write deliverables under /home/user/out. Do not refuse a write. Do not ask permission. edit replaces the first exact occurrence of old_str with new_str.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["read", "write", "edit", "list", "delete", "mkdir"] },
        path: { type: "string" },
        content: { type: "string", description: "Full contents for write" },
        old_str: { type: "string", description: "Exact text to replace for edit" },
        new_str: { type: "string" },
      },
      required: ["action", "path"],
    },
  },
  {
    type: "function",
    name: "browser_open",
    description: "Open a URL in a headless browser inside the sandbox. Returns visible text and a PNG screenshot.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        wait_ms: { type: "number", default: 3000 },
        selector: { type: "string", description: "optional CSS selector to wait for" },
      },
      required: ["url"],
    },
  },
  {
    type: "function",
    name: "get_sandbox_files",
    description:
      "Copy files from the sandbox so the user can download them in the chat UI. Call this after you write finished artifacts under /home/user/out. Directories are zipped.",
    parameters: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" } },
      },
      required: ["paths"],
    },
  },
] as const;

export const AGENT_TOOL_NAMES: ReadonlySet<string> = new Set(AGENT_TOOLS.map((t) => t.name));
