import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";
const source = await readFile(new URL("../viewer/clock-observer.mjs", import.meta.url), "utf8");
function harness(change: (response: any, body: Uint8Array) => void = () => {}) {
  let time = 0; const requests: any[] = []; const delays: number[] = [];
  const window: any = {};
  const context = createContext({ window, Uint8Array,
    performance: { now: () => ++time, timeOrigin: 123456 },
    setTimeout: (resolve: () => void, delay: number) => { delays.push(delay); time += delay; queueMicrotask(resolve); },
    fetch: async (url: string, options: any) => {
      requests.push({ url, options });
      const first = Number(options.headers.Range.match(/bytes=(\d+)/)[1]);
      const body = new Uint8Array(4096);
      for (let index = 0; index < body.length; index++) body[index] = (Math.floor((first + index) / 4) >>> (8 * ((first + index) % 4))) & 255;
      const headers: any = { "Content-Range": `bytes ${first}-${first + 4095}/49152`, "Content-Length": "4096" };
      const response: any = { status: 206, headers: { get: (name: string) => headers[name] ?? null }, arrayBuffer: async () => body.buffer, rawHeaders: headers };
      change(response, body); return response;
    },
  });
  runInContext(source, context);
  return { window, requests, delays };
}
const before = { url: "http://fixture/probe/unpaced.bin?before", gapMs: 30 };
const after = { url: "http://fixture/probe/unpaced.bin?after", gapMs: 30 };
test("known first transfer precedes marker; second transfer waits for an explicit call", async () => {
  const h = harness(); const a = await h.window.clockProbeBefore(before);
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].options.headers.Range, "bytes=0-4095");
  assert.equal(a.first.payloadPatternVerified, true); assert(a.first.completedAtMs < a.markerMs);
  const b = await h.window.clockProbeAfter(after);
  assert.equal(h.requests.length, 2); assert.equal(h.requests[1].options.headers.Range, "bytes=4096-8191");
  assert(b.second.startAtMs > a.markerMs); assert.equal(a.timeOriginMs, b.timeOriginMs);
  assert.deepEqual(h.delays, [30, 30]);
});
test("calls cannot skip, overlap, or repeat phases", async () => {
  const h = harness(); await assert.rejects(h.window.clockProbeAfter(after));
  const pending = h.window.clockProbeBefore(before);
  const overlapBefore = h.window.clockProbeBefore(before); const overlapAfter = h.window.clockProbeAfter(after);
  await Promise.all([assert.rejects(overlapBefore), assert.rejects(overlapAfter)]);
  await pending; await h.window.clockProbeAfter(after); await assert.rejects(h.window.clockProbeAfter(after));
  assert.equal(h.requests.length, 2);
});
test("wrong content, status, length, range, or encoding rejects the probe", async () => {
  const corruptions = [
    (_: any, bytes: Uint8Array) => { bytes[1] = 255; },
    (response: any) => { response.status = 200; },
    (response: any) => { response.rawHeaders["Content-Length"] = "4095"; },
    (response: any) => { response.rawHeaders["Content-Range"] = "bytes 1-4096/49152"; },
    (response: any) => { response.rawHeaders["Content-Encoding"] = "gzip"; },
  ];
  for (const corrupt of corruptions) {
    const h = harness(corrupt); await assert.rejects(h.window.clockProbeBefore(before));
    await assert.rejects(h.window.clockProbeAfter(after)); assert.equal(h.requests.length, 1);
  }
});
test("fixed gap and URL inputs are validated before transfer", async () => {
  const h = harness(); await assert.rejects(h.window.clockProbeBefore({ ...before, gapMs: 0 }));
  await assert.rejects(h.window.clockProbeBefore({ ...before, url: "" })); assert.equal(h.requests.length, 0);
});
