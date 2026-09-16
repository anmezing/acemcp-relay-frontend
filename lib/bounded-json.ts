export class JsonBodyTooLargeError extends Error {
  constructor() { super("JSON body exceeds byte limit"); this.name = "JsonBodyTooLargeError"; }
}

export async function readBoundedJson(source: Pick<Response, "body" | "headers">, maxBytes: number, signal?: AbortSignal): Promise<unknown> {
  if (!source.body) throw new SyntaxError("Empty JSON body");
  const reader = source.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let bytes = 0;
  const onAbort = () => { void reader.cancel(signal?.reason).catch(() => undefined); };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    signal?.throwIfAborted();
    const declared = Number(source.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) throw new JsonBodyTooLargeError();
    for (;;) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new JsonBodyTooLargeError();
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return JSON.parse(parts.join(""));
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
    signal?.removeEventListener("abort", onAbort);
  }
}
