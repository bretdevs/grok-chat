/** Appended to the system message on every request so replies can carry downloadable files. */
export const FILE_OUTPUT_PROTOCOL = `FILE OUTPUT PROTOCOL
When you generate a file the user should download, emit one or more blocks in this exact format and nothing else around the fences:

:::file{name="filename.ext"}
<raw file contents, no extra markdown fences inside unless they belong in the file>
:::

You may emit multiple :::file blocks in one reply.
Also keep a normal prose answer outside those blocks.
For binary-ish content (zip, png, pdf you generate as text/base64), use:

:::file{name="filename.ext" encoding="base64"}
<base64>
:::`;
