import assert from "node:assert/strict";
import test from "node:test";
import {
  calibrateOffset, classifyEventTime, mapPageTime, summarizeNetwork,
  type Headers, type NetworkEvent,
} from "./partial-network.js";

const url = "http://127.0.0.1:1234/pdf/example.pdf";
const renderBoundary = { lowerSeconds: 10, upperSeconds: 10.02 };
function transfer(id: string, start: number, headers: Headers = {}, responseHeaders: Headers = {}, status = 200): NetworkEvent[] {
  return [
    { kind: "request", requestId: id, timestampSeconds: start, url, method: "GET", headers },
    { kind: "response", requestId: id, timestampSeconds: start + 0.1, status, headers: responseHeaders },
    { kind: "data", requestId: id, timestampSeconds: start + 0.2, dataLength: 1024, encodedDataLength: 512 },
    { kind: "finished", requestId: id, timestampSeconds: start + 0.3, encodedDataLength: 700 },
  ];
}

test("intersects clock calibration brackets and maps page milliseconds", () => {
  const offset = calibrateOffset([
    { beforeSeconds: 101, pageNowMs: 1000, afterSeconds: 101.02 },
    { beforeSeconds: 103.01, pageNowMs: 3000, afterSeconds: 103.03 },
  ], 0);
  assert.equal(offset.lowerSeconds, 100.01);
  assert.equal(offset.upperSeconds, 100.02);
  const mapped = mapPageTime(4500, offset, 0);
  assert.equal(mapped.lowerSeconds, 104.51);
  assert.equal(mapped.upperSeconds, 104.52);
  const negative = calibrateOffset([{ beforeSeconds: 1, pageNowMs: 2000, afterSeconds: 1 }], 0);
  assert.equal(negative.lowerSeconds, -1);
  assert.equal(negative.upperSeconds, -1);
});

test("explicit margins cover two page-clock quantization sources without claiming a universal bound", () => {
  const offset = calibrateOffset([{ beforeSeconds: 101, pageNowMs: 1000, afterSeconds: 101 }]);
  assert.equal(offset.clockResolutionMarginMs, 1);
  assert(Math.abs(offset.lowerSeconds - 99.999) < 1e-12);
  assert(Math.abs(offset.upperSeconds - 100.001) < 1e-12);
  const mapped = mapPageTime(2000, offset);
  assert(Math.abs(mapped.lowerSeconds - 101.998) < 1e-12);
  assert(Math.abs(mapped.upperSeconds - 102.002) < 1e-12);
  assert.match(mapped.assumption, /not a proven universal/);
  assert.equal(classifyEventTime(102.001, mapped), "uncertain");
  assert.throws(() => calibrateOffset([{ beforeSeconds: 1, pageNowMs: 0, afterSeconds: 1 }], -1), /nonnegative/);
  assert.throws(() => mapPageTime(0, offset, NaN), /finite/);
});

test("rejects missing, reversed, nonfinite, and nonoverlapping calibrations", () => {
  assert.throws(() => calibrateOffset([]), /At least one/);
  assert.throws(() => calibrateOffset([{ beforeSeconds: 2, pageNowMs: 0, afterSeconds: 1 }]), /reversed/);
  for (const field of ["beforeSeconds", "pageNowMs", "afterSeconds"] as const) {
    for (const value of [NaN, Infinity, -1]) {
      assert.throws(() => calibrateOffset([{ beforeSeconds: 1, pageNowMs: 1, afterSeconds: 2, [field]: value }]));
    }
  }
  assert.throws(() => calibrateOffset([
    { beforeSeconds: 1, pageNowMs: 0, afterSeconds: 2 },
    { beforeSeconds: 3, pageNowMs: 0, afterSeconds: 4 },
  ]), /do not overlap/);
  assert.throws(() => mapPageTime(Infinity, { lowerSeconds: 0, upperSeconds: 1 }), /finite/);
  assert.throws(() => mapPageTime(1, { lowerSeconds: 2, upperSeconds: 1 }), /reversed/);
});

test("classifies boundary endpoints conservatively", () => {
  assert.equal(classifyEventTime(9, renderBoundary), "at-or-before");
  assert.equal(classifyEventTime(10, renderBoundary), "at-or-before");
  assert.equal(classifyEventTime(10.01, renderBoundary), "uncertain");
  assert.equal(classifyEventTime(10.02, renderBoundary), "uncertain");
  assert.equal(classifyEventTime(10.03, renderBoundary), "after");
  assert.throws(() => classifyEventTime(NaN, renderBoundary), /finite/);
});

test("event arrival order does not affect timestamp classification or byte sums", () => {
  const events: NetworkEvent[] = [
    ...transfer("a", 9),
    { kind: "data", requestId: "a", timestampSeconds: 10.01, dataLength: 23, encodedDataLength: 13 },
    { kind: "data", requestId: "a", timestampSeconds: 10.03, dataLength: 100, encodedDataLength: 80 },
  ];
  // Delay the finish timestamp until after the added chunks, but deliver the
  // normalized events in reverse callback order to exercise ledger accounting.
  events[3]!.timestampSeconds = 10.04;
  const snapshot = structuredClone(events);
  const options = { documentUrl: url, renderBoundary };
  const summary = summarizeNetwork(events, options);
  assert.deepEqual(summarizeNetwork([...events].reverse(), options), summary);
  assert.deepEqual(events, snapshot);
  assert.deepEqual(summary.reportedDataAtRender, {
    atOrBeforeBytes: 1024, uncertainBytes: 23, atOrBeforePlusUncertainBytes: 1047,
  });
  assert.equal(summary.byRenderTime.after.reportedDataBytes, 100);
  assert.equal(summary.byRenderTime.after.loadingFinished, 1);
  assert.equal(summary.byRenderTime.after.finishedEncodedDataLength, 700);
  assert.equal(summary.byRenderTime["at-or-before"].reportedEncodedDataBytes, 512);
  assert.match(summary.accounting, /not true physical\/application byte arrival/);
});

test("verification-started traffic stays separate from ongoing measurement requests", () => {
  const events = [
    ...transfer("before", 9),
    ...transfer("uncertain", 11.01),
    ...transfer("verification", 12),
  ];
  const summary = summarizeNetwork(events, {
    documentUrl: url, renderBoundary,
    verificationBoundary: { lowerSeconds: 11, upperSeconds: 11.02 },
  });
  assert.equal(summary.byRequestPhase.measurement.requestCount, 1);
  assert.equal(summary.byRequestPhase.verificationUncertain.requestCount, 1);
  assert.equal(summary.byRequestPhase.verification.requestCount, 1);
  assert.equal(summary.byRequestPhase.verification.byRenderTime.after.reportedDataBytes, 1024);
  assert.equal(summary.byRenderTime["at-or-before"].reportedDataBytes, 1024);
  assert.equal(summary.byRenderTime.after.reportedDataBytes, 2048);
  assert.throws(() => summarizeNetwork(events, {
    documentUrl: url, renderBoundary, verificationBoundary: { lowerSeconds: 8, upperSeconds: 9 },
  }), /precedes/);
});

test("only the exact target URL is counted, including events arriving before its request callback", () => {
  const other = transfer("other", 9).map(event => event.kind === "request" ? { ...event, url: url + "?other" } : event);
  const summary = summarizeNetwork([...transfer("target", 9), ...other].reverse(), { documentUrl: url, renderBoundary });
  assert.equal(summary.requestCount, 1);
  assert.equal(summary.byRenderTime["at-or-before"].reportedDataBytes, 1024);
});

test("range eligibility or a Range request alone never proves an observed range response", () => {
  const events = [
    ...transfer("advertised", 9, {}, { "Accept-Ranges": "bytes" }),
    ...transfer("ignored", 11, { Range: "bytes=0-1023" }, { "Accept-Ranges": "bytes" }),
    ...transfer("unsolicited", 12, {}, { "Content-Range": "bytes 0-1023/4096" }, 206),
    ...transfer("malformed", 13, { Range: "bytes=0-1023" }, { "Content-Range": "bytes 0-5000/4096" }, 206),
  ];
  const summary = summarizeNetwork(events, { documentUrl: url, renderBoundary });
  assert.deepEqual(summary.range, { requestCount: 2, observed206Count: 0 });
});

test("observed range transfer requires matching GET Range and valid 206 bounds", () => {
  const examples = [
    ["bytes=0-1023", "bytes 0-1023/4096"],
    ["bytes=3072-", "bytes 3072-4095/4096"],
    ["bytes=-1024", "bytes 3072-4095/4096"],
    ["bytes=3072-9999", "bytes 3072-4095/4096"],
  ];
  for (const [range, contentRange] of examples) {
    const summary = summarizeNetwork(transfer("r", 9, { rAnGe: range! }, {
      "content-range": contentRange!, "content-length": "1024",
    }, 206), { documentUrl: url, renderBoundary });
    assert.deepEqual(summary.range, { requestCount: 1, observed206Count: 1 });
    assert.equal(summary.requests[0]!.completed, true);
  }
  const invalidResponseHeaders: Headers[] = [
    { "Content-Range": "bytes 1-1024/4096" },
    { "Content-Range": "bytes 0-1023/*" },
    { "Content-Range": "bytes 0-1023/4096", "Content-Length": "1000" },
  ];
  for (const headers of invalidResponseHeaders) {
    const summary = summarizeNetwork(transfer("r", 9, { Range: "bytes=0-1023" }, headers, 206), { documentUrl: url, renderBoundary });
    assert.equal(summary.range.observed206Count, 0);
  }
});

test("failed requests are counted without pretending they completed", () => {
  const events: NetworkEvent[] = [
    { kind: "request", requestId: "bad", timestampSeconds: 9, url, method: "GET", headers: {} },
    { kind: "failed", requestId: "bad", timestampSeconds: 11, errorText: "net::ERR_ABORTED", canceled: true },
  ];
  const summary = summarizeNetwork(events, { documentUrl: url, renderBoundary });
  assert.equal(summary.byRenderTime.after.loadingFailed, 1);
  assert.equal(summary.byRenderTime.after.loadingFinished, 0);
  assert.equal(summary.requests[0]!.failed, true);
  assert.equal(summary.requests[0]!.completed, false);
});

test("invalid lengths, nonfinite times and ambiguous request identity fail closed", () => {
  const negative: NetworkEvent[] = transfer("a", 9);
  const data = negative.find(event => event.kind === "data")!;
  data.dataLength = -1;
  assert.throws(() => summarizeNetwork(negative, { documentUrl: url, renderBoundary }), /byte counts/);
  const missingTime = transfer("a", 9);
  missingTime[0]!.timestampSeconds = NaN;
  assert.throws(() => summarizeNetwork(missingTime, { documentUrl: url, renderBoundary }), /finite/);
  const repeated = transfer("a", 9);
  assert.throws(() => summarizeNetwork([...repeated, repeated[0]!], { documentUrl: url, renderBoundary }), /Duplicate request ID/);
  assert.throws(() => summarizeNetwork([...repeated, repeated[1]!], { documentUrl: url, renderBoundary }), /Multiple response/);
  assert.throws(() => summarizeNetwork([...repeated, repeated[3]!], { documentUrl: url, renderBoundary }), /Multiple terminal/);
  const backward = transfer("a", 9);
  backward[1]!.timestampSeconds = 8;
  assert.throws(() => summarizeNetwork(backward, { documentUrl: url, renderBoundary }), /precedes its request/);
});
