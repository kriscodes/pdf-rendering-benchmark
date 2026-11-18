import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import test from "node:test";
import { startServer, type Asset } from "./server.js";

const pdf = Buffer.from("0123456789");
const assets = () => new Map<string, Asset>([
  ["/pair.pdf", { body: pdf, contentType: "application/pdf", range: true }],
  ["/viewer.html", { body: Buffer.from("<canvas></canvas>"), contentType: "text/html" }],
  ["/empty.pdf", { body: Buffer.alloc(0), contentType: "application/pdf", range: true }],
]);

test("GET serves unchanged bytes with full-response headers and request evidence", async t => {
  const server = await startServer(assets());
  t.after(server.close);
  assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const response = await fetch(`${server.origin}/pair.pdf?trial=1`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("cache-control"), "no-cache");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("content-length"), "10");
  assert.equal(response.headers.get("content-encoding"), null);
  assert.equal(response.headers.get("etag"), null);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
  assert.deepEqual(server.requests, [{
    method: "GET", url: "/pair.pdf?trial=1", range: null, status: 200,
    responseBytes: 10, completed: true,
  }]);
});

test("HEAD reports full size without sending body, ignoring Range", async t => {
  const server = await startServer(assets());
  t.after(server.close);
  const response = await fetch(`${server.origin}/pair.pdf`, {
    method: "HEAD", headers: { Range: "bytes=1-3" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), "10");
  assert.equal(response.headers.get("content-range"), null);
  assert.equal(await response.text(), "");
  assert.equal(server.requests[0]?.responseBytes, 0);
  assert.equal(server.requests[0]?.completed, true);
});

test("single closed, open-ended and suffix ranges return precise slices", async t => {
  const server = await startServer(assets());
  t.after(server.close);
  const cases = [
    ["bytes=2-5", "2345", "bytes 2-5/10"],
    ["bytes=7-", "789", "bytes 7-9/10"],
    ["bytes=-3", "789", "bytes 7-9/10"],
    ["bytes=8-99", "89", "bytes 8-9/10"],
    ["bytes=-99", "0123456789", "bytes 0-9/10"],
    ["bytes=-999999999999999999999999", "0123456789", "bytes 0-9/10"],
  ] as const;
  for (const [range, expected, contentRange] of cases) {
    const response = await fetch(`${server.origin}/pair.pdf`, { headers: { Range: range } });
    assert.equal(response.status, 206, range);
    assert.equal(response.headers.get("content-range"), contentRange);
    assert.equal(response.headers.get("content-length"), String(expected.length));
    assert.equal(response.headers.get("cache-control"), "no-cache");
    assert.equal(response.headers.get("content-encoding"), null);
    assert.equal(await response.text(), expected);
    assert.equal(server.requests.at(-1)?.range, range);
    assert.equal(server.requests.at(-1)?.responseBytes, expected.length);
  }
});

test("valid unsatisfiable ranges return 416 and the representation length", async t => {
  const server = await startServer(assets());
  t.after(server.close);
  for (const range of ["bytes=10-", "bytes=5-2", "bytes=-0", "bytes=999999999999999999999999-"]) {
    const response = await fetch(`${server.origin}/pair.pdf`, { headers: { Range: range } });
    assert.equal(response.status, 416, range);
    assert.equal(response.headers.get("content-range"), "bytes */10");
    assert.equal(response.headers.get("content-length"), "0");
    assert.equal(await response.text(), "");
  }
  const empty = await fetch(`${server.origin}/empty.pdf`, { headers: { Range: "bytes=0-0" } });
  assert.equal(empty.status, 416);
  assert.equal(empty.headers.get("content-range"), "bytes */0");
  await empty.arrayBuffer();
});

test("malformed, multipart and unsupported ranges are ignored with full 200", async t => {
  const server = await startServer(assets());
  t.after(server.close);
  for (const range of ["bytes=", "bytes=-", "bytes=foo-bar", "bytes=0-1,4-5", "items=0-1"]) {
    const response = await fetch(`${server.origin}/pair.pdf`, { headers: { Range: range } });
    assert.equal(response.status, 200, range);
    assert.equal(response.headers.get("content-range"), null);
    assert.equal(await response.text(), pdf.toString());
  }
  const html = await fetch(`${server.origin}/viewer.html`, { headers: { Range: "bytes=0-1" } });
  assert.equal(html.status, 200);
  assert.equal(html.headers.get("accept-ranges"), null);
  assert.equal(await html.text(), "<canvas></canvas>");
});

test("only exact whitelisted paths are served; raw traversal targets return 404", async t => {
  const server = await startServer(assets());
  t.after(server.close);
  // http.request preserves raw dot segments that fetch normalizes client-side.
  for (const path of ["/missing.pdf", "/../pair.pdf", "/nested/../pair.pdf", "/%2e%2e/pair.pdf", "/%2fpair.pdf"]) {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(`${server.origin}/`, { path }, response => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      });
      request.on("error", reject);
      request.end();
    });
    assert.equal(status, 404, path);
  }
});

test("unsupported methods return 405 and Allow; close is idempotent", async () => {
  const server = await startServer(assets());
  try {
    const response = await fetch(`${server.origin}/pair.pdf`, { method: "POST" });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, HEAD");
    assert.equal(response.headers.get("cache-control"), "no-cache");
    await response.arrayBuffer();
  } finally {
    await server.close();
    await server.close();
  }
});
