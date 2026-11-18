import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import type { Asset, RequestRecord } from "./server.js";

export interface PacedAsset extends Asset {
  /** Opt in only PDF routes and the synthetic calibration asset. */
  paced?: boolean;
}

export const PACING_PROFILE = Object.freeze({
  responseHeaderDelayMs: 100,
  bytesPerSecond: 125000,
  maxQuantumBytes: 2048,
});

export interface BodyWrite {
  serializationStartedAtMs: number;
  scheduledForMs: number;
  writtenAtMs: number;
  bytes: number;
  cumulativeBytes: number;
}

export interface PacedRequestRecord extends RequestRecord {
  paced: boolean;
  contentRange: string | null;
  bodyBytesPlanned: number;
  /** Bytes supplied to Node response.write/end, not proven client receipt. */
  bodyBytesWritten: number;
  canceled: boolean;
  requestAtMs: number;
  headersScheduledForMs: number;
  headersAtMs: number | null;
  bodyStartedAtMs: number | null;
  endAtMs: number | null;
  completedAtMs: number | null;
  canceledAtMs: number | null;
  writes: BodyWrite[];
}

interface ResponseState {
  response: ServerResponse;
  record: PacedRequestRecord;
  body: Buffer;
  offset: number;
  queued: boolean;
  headerTimer?: ReturnType<typeof setTimeout>;
}

type ByteRange = { start: number; end: number } | "unsatisfiable" | null;

function parseRange(header: string | undefined, length: number): ByteRange {
  if (header === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  // Same policy as the baseline: malformed/multipart/unsupported units are
  // ignored with full 200; valid but impossible single ranges get 416.
  if (!match || (!match[1] && !match[2])) return null;
  const size = BigInt(length);
  if (size === 0n) return "unsatisfiable";
  const first = match[1] ?? "";
  const last = match[2] ?? "";
  let start: bigint;
  let end: bigint;
  if (first === "") {
    const suffix = BigInt(last);
    if (suffix === 0n) return "unsatisfiable";
    start = suffix < size ? size - suffix : 0n;
    end = size - 1n;
  } else {
    start = BigInt(first);
    end = last === "" ? size - 1n : BigInt(last);
    if (start >= size || end < start) return "unsatisfiable";
    if (end >= size) end = size - 1n;
  }
  return { start: Number(start), end: Number(end) };
}

/**
 * One aggregate, round-robin body budget for all paced responses. Each quantum
 * waits its complete serialization interval, including the first. Every next
 * interval starts at actual callback time, so a stalled event loop cannot cause
 * catch-up bursts. No credit accumulates when the paced queue is idle.
 *
 * The delay is an artificial response-header delay, not a claim of simulated
 * round-trip latency. Times use this Node process's performance.now() clock.
 */
export async function startPacedServer(assets: Map<string, PacedAsset>): Promise<{
  origin: string;
  requests: PacedRequestRecord[];
  profile: typeof PACING_PROFILE;
  close: () => Promise<void>;
}> {
  const requests: PacedRequestRecord[] = [];
  const active = new Set<ResponseState>();
  let queue: ResponseState[] = [];
  let closing = false;
  let closePromise: Promise<void> | undefined;
  let bodyTimer: ReturnType<typeof setTimeout> | undefined;
  let pending: { state: ResponseState; bytes: number; startedAtMs: number; dueAtMs: number } | undefined;

  const isActive = (state: ResponseState) => !state.record.canceled && !state.record.completed && !state.response.destroyed;

  function enqueue(state: ResponseState): void {
    if (closing || !isActive(state) || state.queued) return;
    state.queued = true;
    queue.push(state);
    schedule();
  }

  function cancel(state: ResponseState): void {
    if (state.record.completed || state.record.canceled) return;
    state.record.canceled = true;
    state.record.canceledAtMs = performance.now();
    clearTimeout(state.headerTimer);
    state.headerTimer = undefined;
    queue = queue.filter(candidate => candidate !== state);
    state.queued = false;
    active.delete(state);
    if (pending?.state === state) {
      clearTimeout(bodyTimer);
      bodyTimer = undefined;
      pending = undefined;
    }
    schedule();
  }

  function end(state: ResponseState): void {
    state.record.endAtMs = performance.now();
    state.response.end();
  }

  function schedule(): void {
    if (closing || pending) return;
    let state = queue.shift();
    while (state && !isActive(state)) {
      state.queued = false;
      state = queue.shift();
    }
    if (!state) return;
    state.queued = false;
    const bytes = Math.min(PACING_PROFILE.maxQuantumBytes, state.body.length - state.offset);
    const startedAtMs = performance.now();
    pending = {
      state, bytes, startedAtMs,
      dueAtMs: startedAtMs + bytes / PACING_PROFILE.bytesPerSecond * 1000,
    };
    bodyTimer = setTimeout(writePending, Math.ceil(pending.dueAtMs - startedAtMs));
  }

  function writePending(): void {
    const quantum = pending;
    if (!quantum || closing) return;
    // Timer rounding must not make even a short final quantum arrive early.
    const remaining = quantum.dueAtMs - performance.now();
    if (remaining > 0) {
      bodyTimer = setTimeout(writePending, Math.ceil(remaining));
      return;
    }
    pending = undefined;
    bodyTimer = undefined;
    const { state, bytes, startedAtMs, dueAtMs } = quantum;
    if (!isActive(state)) {
      schedule();
      return;
    }
    try {
      const writtenAtMs = performance.now();
      const chunk = state.body.subarray(state.offset, state.offset + bytes);
      const writable = state.response.write(chunk);
      state.offset += bytes;
      state.record.bodyStartedAtMs ??= writtenAtMs;
      state.record.bodyBytesWritten += bytes;
      state.record.writes.push({
        serializationStartedAtMs: startedAtMs, scheduledForMs: dueAtMs,
        writtenAtMs, bytes, cumulativeBytes: state.record.bodyBytesWritten,
      });
      if (state.offset === state.body.length) {
        end(state);
      } else if (writable) {
        enqueue(state);
      } else {
        // Backpressure pauses this response, not the aggregate scheduler.
        state.response.once("drain", () => enqueue(state));
      }
    } catch {
      cancel(state);
      state.response.destroy();
    }
    schedule();
  }

  const server = createServer((request, response) => {
    const requestAtMs = performance.now();
    const method = request.method ?? "GET";
    const rawUrl = request.url ?? "/";
    let pathname: string | undefined;
    try {
      const parsed = new URL(rawUrl, "http://127.0.0.1");
      if (rawUrl.split(/[?#]/, 1)[0] === parsed.pathname) pathname = parsed.pathname;
    } catch { /* Invalid targets cannot match the whitelist. */ }
    const asset = pathname === undefined ? undefined : assets.get(pathname);
    const headers: Record<string, string> = { "Cache-Control": "no-cache" };
    let status = 200;
    let body: Buffer;
    if (method !== "GET" && method !== "HEAD") {
      status = 405;
      headers.Allow = "GET, HEAD";
      headers["Content-Type"] = "text/plain; charset=utf-8";
      body = Buffer.from("Method not allowed");
    } else if (!asset) {
      status = 404;
      headers["Content-Type"] = "text/plain; charset=utf-8";
      body = Buffer.from("Not found");
    } else {
      headers["Content-Type"] = asset.contentType;
      body = asset.body;
      if (asset.range) {
        headers["Accept-Ranges"] = "bytes";
        const range = method === "GET" ? parseRange(request.headers.range, body.length) : null;
        if (range === "unsatisfiable") {
          status = 416;
          headers["Content-Range"] = `bytes */${body.length}`;
          body = Buffer.alloc(0);
        } else if (range) {
          status = 206;
          headers["Content-Range"] = `bytes ${range.start}-${range.end}/${body.length}`;
          body = body.subarray(range.start, range.end + 1);
        }
      }
    }
    headers["Content-Length"] = String(body.length);
    const paced = asset?.paced === true && (method === "GET" || method === "HEAD");
    const bodyBytesPlanned = method === "HEAD" ? 0 : body.length;
    const record: PacedRequestRecord = {
      method, url: rawUrl, range: request.headers.range ?? null, status,
      responseBytes: bodyBytesPlanned, completed: false,
      paced, contentRange: headers["Content-Range"] ?? null,
      bodyBytesPlanned, bodyBytesWritten: 0, canceled: false,
      requestAtMs, headersScheduledForMs: requestAtMs + (paced ? PACING_PROFILE.responseHeaderDelayMs : 0),
      headersAtMs: null, bodyStartedAtMs: null, endAtMs: null,
      completedAtMs: null, canceledAtMs: null, writes: [],
    };
    requests.push(record);
    const state: ResponseState = { response, record, body, offset: 0, queued: false };
    active.add(state);
    response.once("finish", () => {
      if (record.canceled) return;
      record.completed = true;
      record.completedAtMs = performance.now();
      active.delete(state);
    });
    response.once("close", () => { if (!record.completed) cancel(state); });
    response.once("error", () => { cancel(state); response.destroy(); });

    function sendHeaders(): void {
      if (closing || !isActive(state)) return;
      const remaining = record.headersScheduledForMs - performance.now();
      if (remaining > 0) {
        state.headerTimer = setTimeout(sendHeaders, Math.ceil(remaining));
        return;
      }
      state.headerTimer = undefined;
      try {
        record.headersAtMs = performance.now();
        response.writeHead(status, headers);
        if (paced) {
          response.flushHeaders();
          // HEAD and empty/416 responses pay header delay, but no body budget.
          if (bodyBytesPlanned === 0) end(state);
          else enqueue(state);
        } else {
          if (bodyBytesPlanned > 0) {
            const writtenAtMs = performance.now();
            record.bodyStartedAtMs = writtenAtMs;
            record.bodyBytesWritten = bodyBytesPlanned;
            record.writes.push({ serializationStartedAtMs: writtenAtMs, scheduledForMs: writtenAtMs,
              writtenAtMs, bytes: bodyBytesPlanned, cumulativeBytes: bodyBytesPlanned });
          }
          record.endAtMs = performance.now();
          response.end(method === "HEAD" ? undefined : body);
        }
      } catch {
        cancel(state);
        response.destroy();
      }
    }
    sendHeaders();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`, requests, profile: PACING_PROFILE,
    close: () => {
      closePromise ??= new Promise<void>((resolve, reject) => {
        closing = true;
        clearTimeout(bodyTimer);
        bodyTimer = undefined;
        pending = undefined;
        for (const state of active) {
          cancel(state);
          state.response.destroy();
        }
        queue = [];
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
      return closePromise;
    },
  };
}
