import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface Asset {
  body: Buffer;
  contentType: string;
  range?: boolean;
}

export interface RequestRecord {
  method: string;
  url: string;
  range: string | null;
  status: number;
  /** Body bytes scheduled for this response; zero for HEAD. */
  responseBytes: number;
  completed: boolean;
}

type ByteRange = { start: number; end: number } | "unsatisfiable" | null;

function parseRange(header: string | undefined, length: number): ByteRange {
  if (header === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  // Ignore unsupported units, malformed fields, and multipart requests, serving
  // the complete representation with 200. A valid but impossible range gets 416.
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

/** Serve only the supplied in-memory assets, on an ephemeral loopback port. */
export async function startServer(assets: Map<string, Asset>): Promise<{
  origin: string;
  requests: RequestRecord[];
  close: () => Promise<void>;
}> {
  const requests: RequestRecord[] = [];
  const server = createServer((request, response) => {
    const method = request.method ?? "GET";
    const rawUrl = request.url ?? "/";
    let path: string | undefined;
    try {
      const parsed = new URL(rawUrl, "http://127.0.0.1");
      const rawPath = rawUrl.split(/[?#]/, 1)[0];
      // URL parsing normalizes dot segments. Reject such targets rather than
      // allowing a traversal-looking request to alias a whitelisted asset.
      if (rawPath === parsed.pathname) path = parsed.pathname;
    } catch {
      // Invalid request targets do not match any asset.
    }
    const asset = path === undefined ? undefined : assets.get(path);
    // Fresh contexts + CDP cache-disabled control reuse. The no-store streaming
    // failure observed in Chromium 151 is described in Playwright issue #42742.
    const headers: Record<string, string> = { "Cache-Control": "no-cache" };
    let status: number;
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
      status = 200;
      headers["Content-Type"] = asset.contentType;
      body = asset.body;
      if (asset.range) {
        headers["Accept-Ranges"] = "bytes";
        // HTTP Range applies to GET; HEAD describes the full representation.
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
    const record: RequestRecord = {
      method,
      url: rawUrl,
      range: request.headers.range ?? null,
      status,
      responseBytes: method === "HEAD" ? 0 : body.length,
      completed: false,
    };
    requests.push(record);
    response.once("finish", () => { record.completed = true; });
    response.writeHead(status, headers);
    response.end(method === "HEAD" ? undefined : body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  let closing: Promise<void> | undefined;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () => {
      closing ??= new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
      return closing;
    },
  };
}
