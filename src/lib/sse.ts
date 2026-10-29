import type { StreamEvent } from "./types";

export type EventStream = {
  stream: ReadableStream<Uint8Array>;
  send(event: StreamEvent): void;
  ping(): void;
  close(): void;
  readonly closed: boolean;
};

/** Server side: a text/event-stream body that ignores writes after the client goes away. */
export function createEventStream(onCancel?: () => void): EventStream {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      closed = true;
      onCancel?.();
    },
  });

  const write = (chunk: string) => {
    if (closed || !controller) return;
    try {
      controller.enqueue(encoder.encode(chunk));
    } catch {
      closed = true;
    }
  };

  return {
    stream,
    send: (event) => write(`data: ${JSON.stringify(event)}\n\n`),
    ping: () => write(": ping\n\n"),
    close() {
      if (closed) return;
      closed = true;
      try {
        controller?.close();
      } catch {
        // already closed by the runtime
      }
    },
    get closed() {
      return closed;
    },
  };
}

/** Client side: parses `data:` lines from an SSE body. */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let searchFrom = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      // Search only the new tail so a large event (a base64 file) stays linear.
      while ((end = buffer.indexOf("\n\n", searchFrom)) !== -1) {
        const raw = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        searchFrom = 0;
        const data = raw
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (!data) continue;
        try {
          yield JSON.parse(data) as StreamEvent;
        } catch {
          // ignore a malformed event rather than dropping the stream
        }
      }
      searchFrom = Math.max(0, buffer.length - 1);
    }
  } finally {
    reader.releaseLock();
  }
}
