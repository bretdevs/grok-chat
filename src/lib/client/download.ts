export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari needs the URL to live a moment after the click.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function downloadZip(entries: { path: string; blob: Blob }[], zipName: string): Promise<void> {
  const { zipSync } = await import("fflate");
  const files: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    let path = entry.path.replace(/^\/+/, "") || "file";
    const dot = path.lastIndexOf(".");
    for (let n = 2; files[path]; n++) {
      path = dot > 0 ? `${entry.path.slice(0, dot)} (${n})${entry.path.slice(dot)}` : `${entry.path} (${n})`;
    }
    files[path] = new Uint8Array(await entry.blob.arrayBuffer());
  }
  const zipped = zipSync(files, { level: 6 });
  downloadBlob(new Blob([new Uint8Array(zipped)], { type: "application/zip" }), zipName);
}
