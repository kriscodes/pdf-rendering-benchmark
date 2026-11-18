import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { PACING_PROFILE, startPacedServer, type PacedAsset, type PacedRequestRecord } from "./paced-server.js";

const makeAssets = (size = 8192) => new Map<string, PacedAsset>([
  ["/a.pdf", { body: Buffer.alloc(size, 65), contentType: "application/pdf", range: true, paced: true }],
  ["/b.pdf", { body: Buffer.alloc(size, 66), contentType: "application/pdf", range: true, paced: true }],
  ["/calibration.bin", { body: Buffer.alloc(size, 67), contentType: "application/octet-stream", paced: true }],
  ["/worker.mjs", { body: Buffer.alloc(32768, 87), contentType: "text/javascript" }],
]);

async function get(origin: string, path: string, options: { method?: string; range?: string } = {}) {
  const startedAtMs = performance.now();
  const response = await fetch(`${origin}${path}`, {
    method: options.method ?? "GET",
    headers: options.range ? { Range: options.range } : {},
  });
  const headersAtMs = performance.now();
  const body = Buffer.from(await response.arrayBuffer());
  return { response, body, startedAtMs, headersAtMs, finishedAtMs: performance.now() };
}

function assertSerialized(records: PacedRequestRecord[]): void {
  const writes = records.flatMap(record => record.writes).sort((a, b) => a.writtenAtMs - b.writtenAtMs);
  for (const [index, write] of writes.entries()) {
    assert(write.bytes > 0 && write.bytes <= PACING_PROFILE.maxQuantumBytes);
    assert(Math.abs(write.scheduledForMs - write.serializationStartedAtMs - write.bytes / PACING_PROFILE.bytesPerSecond * 1000) < 0.0001);
    assert(write.writtenAtMs >= write.scheduledForMs, "No quantum may be released early");
    const previous = writes[index - 1];
    if (previous) assert(write.serializationStartedAtMs >= previous.writtenAtMs, "Concurrent responses must share one budget");
  }
  const first = writes[0];
  const last = writes.at(-1);
  assert(first && last);
  const bytes = writes.reduce((sum, write) => sum + write.bytes, 0);
  assert(last.writtenAtMs - first.serializationStartedAtMs >= bytes / PACING_PROFILE.bytesPerSecond * 1000 - 0.0001);
}

async function until(predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + 1000;
  while (!predicate()) {
    assert(performance.now() < deadline, "Timed out waiting for server evidence");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test("paced body preserves bytes, delays headers and charges the complete first quantum", { timeout: 5000 }, async t => {
  const server = await startPacedServer(makeAssets(6145));
  t.after(server.close);
  const result = await get(server.origin, "/a.pdf?trial=one");
  assert.equal(result.response.status, 200);
  assert.equal(result.response.headers.get("cache-control"), "no-cache");
  assert.equal(result.response.headers.get("content-length"), "6145");
  assert.equal(result.response.headers.get("accept-ranges"), "bytes");
  assert.equal(result.response.headers.get("content-encoding"), null);
  assert.deepEqual(result.body, Buffer.alloc(6145, 65));
  const record = server.requests[0]!;
  assert.equal(record.url, "/a.pdf?trial=one");
  assert.equal(record.bodyBytesPlanned, 6145);
  assert.equal(record.bodyBytesWritten, 6145);
  assert.equal(record.responseBytes, 6145);
  assert(record.completed && !record.canceled);
  assert(record.headersAtMs !== null && record.bodyStartedAtMs !== null && record.endAtMs !== null && record.completedAtMs !== null);
  assert(record.headersAtMs - record.requestAtMs >= 100);
  assert(result.headersAtMs - result.startedAtMs >= 95);
  assert.deepEqual(record.writes.map(write => write.bytes), [2048, 2048, 2048, 1]);
  assert(record.writes[0]!.serializationStartedAtMs >= record.headersAtMs);
  assert(record.bodyStartedAtMs - record.headersAtMs >= 2048 / 125000 * 1000);
  assertSerialized([record]);
});

test("range and HEAD behavior matches baseline while paying only the applicable body budget", { timeout: 5000 }, async t => {
  const asset: PacedAsset = { body: Buffer.from("0123456789"), contentType: "application/pdf", range: true, paced: true };
  const server = await startPacedServer(new Map([["/a.pdf", asset]]));
  t.after(server.close);
  for (const [range, status, body, contentRange] of [
    ["bytes=2-5", 206, "2345", "bytes 2-5/10"],
    ["bytes=7-", 206, "789", "bytes 7-9/10"],
    ["bytes=-3", 206, "789", "bytes 7-9/10"],
    ["bytes=10-", 416, "", "bytes */10"],
    ["bytes=0-1,4-5", 200, "0123456789", null],
    ["bytes=bad", 200, "0123456789", null],
  ] as const) {
    const result = await get(server.origin, "/a.pdf", { range });
    assert.equal(result.response.status, status, range);
    assert.equal(result.body.toString(), body);
    assert.equal(result.response.headers.get("content-range"), contentRange);
    const record = server.requests.at(-1)!;
    assert.equal(record.contentRange, contentRange);
    assert.equal(record.bodyBytesWritten, body.length);
    assert(record.headersAtMs! - record.requestAtMs >= 100);
  }
  const head = await get(server.origin, "/a.pdf", { method: "HEAD", range: "bytes=2-5" });
  assert.equal(head.response.status, 200);
  assert.equal(head.response.headers.get("content-length"), "10");
  assert.equal(head.response.headers.get("content-range"), null);
  assert.equal(head.body.length, 0);
  const record = server.requests.at(-1)!;
  assert(record.headersAtMs! - record.requestAtMs >= 100);
  assert.equal(record.bodyBytesPlanned, 0);
  assert.equal(record.bodyBytesWritten, 0);
  assert.equal(record.bodyStartedAtMs, null);
  assert.deepEqual(record.writes, []);
});

test("simultaneous paced responses share aggregate capacity with round-robin releases", { timeout: 5000 }, async t => {
  const server = await startPacedServer(makeAssets(16384));
  t.after(server.close);
  const [a, b] = await Promise.all([get(server.origin, "/a.pdf"), get(server.origin, "/b.pdf")]);
  assert.equal(a.body.length, 16384);
  assert.equal(b.body.length, 16384);
  assertSerialized(server.requests);
  const bothReady = Math.max(...server.requests.map(record => record.headersAtMs!));
  const firstEnded = Math.min(...server.requests.map(record => record.endAtMs!));
  const shared = server.requests.flatMap(record => record.writes.map(write => ({ ...write, url: record.url })))
    .filter(write => write.serializationStartedAtMs >= bothReady && write.writtenAtMs < firstEnded)
    .sort((left, right) => left.writtenAtMs - right.writtenAtMs);
  assert(shared.length >= 4);
  for (let index = 1; index < shared.length; index++) assert.notEqual(shared[index]!.url, shared[index - 1]!.url);
});

test("an event-loop stall produces no catch-up burst", { timeout: 5000 }, async t => {
  const server = await startPacedServer(makeAssets(6144));
  t.after(server.close);
  await new Promise<void>((resolve, reject) => {
    const request = httpRequest(`${server.origin}/a.pdf`, response => {
      let stalled = false;
      response.on("data", () => {
        if (!stalled) {
          stalled = true;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60);
        }
      });
      response.on("end", resolve);
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end();
  });
  const record = server.requests[0]!;
  assert.equal(record.writes.length, 3);
  assert(record.writes[1]!.writtenAtMs - record.writes[0]!.writtenAtMs >= 50);
  assertSerialized([record]);
});

test("worker traffic bypasses both header delay and the paced body queue", { timeout: 5000 }, async t => {
  const server = await startPacedServer(makeAssets(32768));
  t.after(server.close);
  const paced = get(server.origin, "/calibration.bin");
  await until(() => server.requests.some(record => record.paced));
  const worker = await get(server.origin, "/worker.mjs");
  assert.equal(worker.body.length, 32768);
  const record = server.requests.find(request => request.url === "/worker.mjs")!;
  assert.equal(record.paced, false);
  assert.equal(record.headersScheduledForMs, record.requestAtMs);
  assert(record.headersAtMs! - record.requestAtMs < 50);
  assert.equal(record.writes.length, 1);
  assert.equal(record.writes[0]!.bytes, 32768);
  assert.equal(record.writes[0]!.scheduledForMs, record.writes[0]!.writtenAtMs);
  assert(record.completedAtMs! < server.requests.find(request => request.paced)!.headersScheduledForMs);
  await paced;
});

test("cancellation clears delayed headers and queued writes; a later idle transfer starts a fresh budget", { timeout: 5000 }, async t => {
  const server = await startPacedServer(makeAssets(16384));
  t.after(server.close);
  const early = httpRequest(`${server.origin}/a.pdf?early=1`);
  early.on("error", () => {});
  early.end();
  await until(() => server.requests.length === 1);
  early.destroy();
  await until(() => server.requests[0]!.canceled);
  assert.equal(server.requests[0]!.headersAtMs, null);
  assert.equal(server.requests[0]!.bodyBytesWritten, 0);

  await new Promise<void>((resolve, reject) => {
    const request = httpRequest(`${server.origin}/a.pdf?mid=1`, response => {
      response.once("data", () => request.destroy());
      response.once("close", resolve);
    });
    request.on("error", error => { if (!request.destroyed) reject(error); });
    request.end();
  });
  const mid = server.requests[1]!;
  await until(() => mid.canceled);
  assert(mid.bodyBytesWritten > 0 && mid.bodyBytesWritten < mid.bodyBytesPlanned);
  assert(!mid.completed && mid.canceledAtMs !== null);
  const stoppedAt = mid.bodyBytesWritten;
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(mid.bodyBytesWritten, stoppedAt);
  const fresh = await get(server.origin, "/b.pdf");
  assert.equal(fresh.body.length, 16384);
  assertSerialized([server.requests[2]!]);
  assert(server.requests[2]!.writes[0]!.serializationStartedAtMs >= server.requests[2]!.headersAtMs!);
});

test("whitelist/method errors are unpaced and shutdown cancels active delayed requests without hanging", { timeout: 5000 }, async () => {
  const server = await startPacedServer(makeAssets());
  try {
    const missing = await get(server.origin, "/missing");
    assert.equal(missing.response.status, 404);
    const post = await get(server.origin, "/a.pdf", { method: "POST" });
    assert.equal(post.response.status, 405);
    assert.equal(post.response.headers.get("allow"), "GET, HEAD");
    const traversal = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(`${server.origin}/`, { path: "/../a.pdf" }, response => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      });
      request.on("error", reject);
      request.end();
    });
    assert.equal(traversal, 404);
    assert(server.requests.every(record => !record.paced));
    const active = httpRequest(`${server.origin}/a.pdf`);
    active.on("error", () => {});
    active.end();
    await until(() => server.requests.at(-1)?.paced === true);
    await server.close();
    await server.close();
    const record = server.requests.at(-1)!;
    assert(record.canceled && !record.completed);
    assert.equal(record.headersAtMs, null);
    assert.equal(record.bodyBytesWritten, 0);
  } finally {
    await server.close();
  }
});
