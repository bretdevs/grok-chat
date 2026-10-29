const TYPES: Record<string, string> = {
  txt: "text/plain",
  text: "text/plain",
  log: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  mdx: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  jsonl: "application/x-ndjson",
  ndjson: "application/x-ndjson",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  toml: "application/toml",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  py: "text/x-python",
  sh: "application/x-sh",
  sql: "application/sql",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  pdf: "application/pdf",
  zip: "application/zip",
  gz: "application/gzip",
  tgz: "application/gzip",
  tar: "application/x-tar",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
  wasm: "application/wasm",
};

const TEXT_EXTS = new Set(
  (
    "txt text log md markdown mdx rst adoc org tex bib csv tsv json jsonl ndjson xml yaml yml toml ini cfg conf env " +
    "properties html htm css scss sass less js mjs cjs jsx ts tsx mts cts vue svelte astro py pyi rb go rs java kt kts " +
    "scala swift c h cc cpp cxx hpp cs php pl pm lua r dart ex exs erl hs clj elm sh bash zsh fish ps1 bat sql graphql " +
    "gql proto tf hcl gradle dockerfile makefile gitignore editorconfig svg"
  ).split(" "),
);

const TEXT_NAMES = new Set(["dockerfile", "makefile", "procfile", "license", "readme", "gemfile", "rakefile"]);

export function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function extOf(name: string): string {
  const base = baseName(name);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function isTextName(name: string): boolean {
  const ext = extOf(name);
  return ext ? TEXT_EXTS.has(ext) : TEXT_NAMES.has(baseName(name).toLowerCase());
}

/** Content type from the file extension; browsers often report the wrong one (.ts is "video/mp2t"). */
export function mimeFromName(name: string): string {
  const ext = extOf(name);
  if (ext && TYPES[ext]) return TYPES[ext];
  return isTextName(name) ? "text/plain" : "application/octet-stream";
}

export function isTextMime(mime: string): boolean {
  return mime.startsWith("text/") || /json|xml|yaml|toml|javascript|x-sh|sql|svg/.test(mime);
}
