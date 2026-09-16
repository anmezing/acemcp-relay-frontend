import { describe, expect, it, vi } from "vitest";
import { JsonBodyTooLargeError, readBoundedJson } from "./bounded-json";

describe("bounded JSON streams", () => {
  it("cancels an oversized chunked stream before reading its remaining data", async () => {
    const cancel = vi.fn();
    let chunks = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { chunks++; controller.enqueue(new Uint8Array(8)); }, cancel,
    }, { highWaterMark: 0 });
    await expect(readBoundedJson(new Response(body), 10)).rejects.toBeInstanceOf(JsonBodyTooLargeError);
    expect(chunks).toBe(2);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("decodes UTF-8 split across chunks and applies a byte limit", async () => {
    const bytes = new TextEncoder().encode('{"text":"中文"}');
    const body = new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } });
    await expect(readBoundedJson(new Response(body), bytes.length)).resolves.toEqual({ text: "中文" });
  });
  it("cancels a stalled body when its caller aborts", async () => {
    const cancel = vi.fn();
    const controller = new AbortController();
    const response = new Response(new ReadableStream({ cancel }));
    const promise = readBoundedJson(response, 100, controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
