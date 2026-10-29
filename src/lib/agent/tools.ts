import { OUT_DIR, SANDBOX_HOME, UPLOAD_DIR, WORK_DIR } from "@/lib/sandbox-paths";

/** Appended to the system message when Agent is on. */
export const AGENT_SYSTEM_NOTE = `You have an isolated Linux sandbox.
Home: ${SANDBOX_HOME}
Uploads: ${UPLOAD_DIR}
Working directory: ${WORK_DIR}
Deliverables: ${OUT_DIR}

Use run_terminal_cmd for shell. Use file for read/write/edit.
After you finish writing files the user should download, call get_sandbox_files with those absolute paths.
Use browser_open when a page needs JS; otherwise curl/python in the terminal is fine.
Be concrete. Prefer doing the work over describing the work.
Do not ask the user to run commands locally — you have the sandbox.
Keep going until the task is done or you are blocked.`;

export const AGENT_TOOLS = [
  {
    type: "function",
    name: "run_terminal_cmd",
    description:
      "Run a non-interactive shell command in the Linux sandbox. cwd defaults to /home/user/work. Network is available. Use for installing packages, running scripts, git, python, node, compiling, tests. Do not use for long interactive programs (vim, less, top).",
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
      "Read, write, edit, list, or delete files in the sandbox filesystem. Paths must be absolute, under /home/user. edit replaces the first exact occurrence of old_str with new_str.",
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
    description:
      "Open a URL in a headless browser inside the sandbox. Returns visible text and a PNG screenshot. Use for reading web pages that need JS.",
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
      "Copy files from the sandbox so the user can download them in the chat UI. Call this after you write finished artifacts under /home/user/out or similar. Directories are zipped.",
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
