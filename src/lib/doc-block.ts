/** How a document's text sits in a message when it travels as text instead of a file. */
export function docBlock(name: string, text: string): string {
  return `--- file: ${name} ---\n${text}\n--- end of ${name} ---`;
}
