import assert from "node:assert/strict";
import test from "node:test";
import { auditCalibrationGroup, auditPacing } from "./delivery-calibration.js";

const config = {
  delivery: { responseHeaderDelayMs: 100, bytesPerSecond: 125000, maxQuantumBytes: 2048 },
  calibration: { rangeBytes: 65536, headerMinimumMs: 99, headerMaximumMs: 125,
    bodyMaximumSlowdown: 1.15, bodySlackMs: 25, minimumDurationToleranceMs: 1,
    clientServerToleranceMs: 25, maximumWriteLatenessMs: 25 },
};

function fixture(count = 1, lateness = 0.5) {
  const requests: any[] = Array.from({ length: count }, (_, index) => ({
    url: `/calibration.bin?request=${index}`, paced: true, completed: true,
    canceled: false, canceledAtMs: null, requestAtMs: 0, headersScheduledForMs: 100,
    headersAtMs: 100, bodyBytesPlanned: 65536, bodyBytesWritten: 65536,
    bodyStartedAtMs: null, endAtMs: null, completedAtMs: null, writes: [],
  }));
  let time = 100;
  for (let quantum = 0; quantum < 32; quantum++) {
    for (const request of requests) {
      const scheduled = time + 2048 / 125000 * 1000;
      const actual = scheduled + lateness;
      request.writes.push({ serializationStartedAtMs: time, scheduledForMs: scheduled,
        writtenAtMs: actual, bytes: 2048, cumulativeBytes: (quantum + 1) * 2048 });
      request.bodyStartedAtMs ??= actual;
      request.endAtMs = actual;
      request.completedAtMs = actual;
      time = actual;
    }
  }
  const browserResults = requests.map(request => ({
    url: `http://127.0.0.1:4321${request.url}`, startAtMs: 50000,
    headersAtMs: request.headersAtMs + 50000,
    finishedAtMs: request.endAtMs + 50000 + 3, bytes: 65536,
  }));
  return { requests, browserResults };
}

test("audits serial and shared concurrent pacing with URL-correlated browser results", () => {
  for (const count of [1, 2]) {
    const { requests, browserResults } = fixture(count);
    const result = auditCalibrationGroup(requests, browserResults.reverse(), config);
    assert.equal(result.totalBodyBytes, count * 65536);
    assert.equal(result.pacing.writeCount, count * 32);
    assert.equal(result.nominalBodyMs, count * 524.288);
    assert(Math.abs(result.disagreementMs - 3) < 1e-8);
    assert.equal(result.concurrentOverlapMs === null, count === 1);
  }
});

test("unpaced assets do not enter the shared body budget audit", () => {
  const { requests } = fixture();
  const result = auditPacing([{ paced: false, writes: [] }, ...requests], config.calibration);
  assert.equal(result.ignoredUnpacedRequestCount, 1);
  assert.equal(result.totalBodyBytes, 65536);
  assert.throws(() => auditPacing([{ paced: false }], config.calibration), /No paced requests/);
});

test("rejects aborted, incomplete, and missing body bytes", () => {
  for (const change of [{ canceled: true }, { completed: false }, { canceledAtMs: 600 },
    { bodyBytesWritten: 65535 }]) {
    const { requests } = fixture();
    Object.assign(requests[0], change);
    assert.throws(() => auditPacing(requests, config.calibration), /incomplete|canceled|written body/);
  }
  const { requests } = fixture();
  requests[0].writes.pop();
  assert.throws(() => auditPacing(requests, config.calibration), /ledger does not account/);
});

test("header delay bounds are inclusive and reject release outside tolerance", () => {
  for (const headerAt of [99, 125, 98.99, 125.01]) {
    const { requests } = fixture();
    const delta = headerAt - 100;
    requests[0].headersAtMs += delta;
    for (const field of ["bodyStartedAtMs", "endAtMs", "completedAtMs"]) requests[0][field] += delta;
    for (const write of requests[0].writes) {
      for (const field of ["serializationStartedAtMs", "scheduledForMs", "writtenAtMs"]) write[field] += delta;
    }
    if (headerAt === 99 || headerAt === 125) auditPacing(requests, config.calibration);
    else assert.throws(() => auditPacing(requests, config.calibration), /header delay/);
  }
});

test("requires exact quantum charge, bounded release lateness, and cumulative accounting", () => {
  for (const change of [
    { bytes: 2049 }, { scheduledForMs: 120 }, { writtenAtMs: 115 },
    { writtenAtMs: 142 }, { cumulativeBytes: 1 }, { writtenAtMs: NaN },
  ]) {
    const { requests } = fixture();
    Object.assign(requests[0].writes[0], change);
    assert.throws(() => auditPacing(requests, config.calibration));
  }
  auditPacing(fixture(1, -1).requests, config.calibration);
  auditPacing(fixture(1, 25).requests, config.calibration);
  assert.throws(() => auditPacing(fixture(1, -1.01).requests, config.calibration), /lateness/);
  assert.throws(() => auditPacing(fixture(1, 25.01).requests, config.calibration), /lateness/);
});

test("rejects concurrent responses with independent full-rate serialization budgets", () => {
  const left = fixture().requests[0];
  const right = structuredClone(left); right.url = "/calibration.bin?request=1";
  assert.throws(() => auditPacing([left, right], config.calibration), /Aggregate body serialization overlaps/);
});

test("aggregate audit uses actual releases and tolerates only floating-point overlap noise", () => {
  const { requests } = fixture(2);
  const firstB = requests[1].writes[0];
  firstB.serializationStartedAtMs -= 0.01;
  firstB.scheduledForMs -= 0.01;
  assert.throws(() => auditPacing(requests, config.calibration), /Aggregate body serialization overlaps/);
});

test("rejects calibration body spans outside declared minimum and maximum", () => {
  const tooFast = fixture(1, -1);
  assert.throws(() => auditCalibrationGroup(tooFast.requests, tooFast.browserResults, config), /aggregate body duration/);
  const tooSlow = fixture(1, 10);
  assert.throws(() => auditCalibrationGroup(tooSlow.requests, tooSlow.browserResults, config), /aggregate body duration/);
});

test("rejects per-response client/server disagreement even when group spans coincide", () => {
  const { requests, browserResults } = fixture(2);
  browserResults[0]!.headersAtMs += 30;
  assert.throws(() => auditCalibrationGroup(requests, browserResults, config), /response body-duration disagreement/);
});

test("requires concurrent server and browser response lifetimes to overlap", () => {
  const { requests, browserResults } = fixture(2, 0);
  // Keep the total span and per-response durations valid, but make the observed
  // browser responses sequential by moving the first header earlier and its end
  // earlier by the same amount. A permissive disagreement bound isolates overlap.
  browserResults[0]!.headersAtMs = 50000;
  browserResults[0]!.finishedAtMs = 50500;
  browserResults[1]!.headersAtMs = 50500;
  browserResults[1]!.finishedAtMs = 51150;
  const permissive = structuredClone(config);
  permissive.calibration.clientServerToleranceMs = 1000;
  assert.throws(() => auditCalibrationGroup(requests, browserResults, permissive), /did not overlap/);
});

test("rejects wrong bytes, missing observations, invalid clocks, and ambiguous URLs", () => {
  for (const mutation of [
    (values: any[]) => { values[0].bytes--; },
    (values: any[]) => { values.pop(); },
    (values: any[]) => { values[0].headersAtMs = NaN; },
    (values: any[]) => { values[0].finishedAtMs = 0; },
    (values: any[]) => { values[0].url = "http://127.0.0.1/missing"; },
    (values: any[]) => { values[1].url = values[0].url; },
  ]) {
    const { requests, browserResults } = fixture(2);
    mutation(browserResults);
    assert.throws(() => auditCalibrationGroup(requests, browserResults, config));
  }
});

test("rejects a declared delivery profile that differs from implemented pacing", () => {
  const { requests, browserResults } = fixture();
  const changed = structuredClone(config);
  changed.delivery.bytesPerSecond = 250000;
  assert.throws(() => auditCalibrationGroup(requests, browserResults, changed), /delivery profile differs/);
});
