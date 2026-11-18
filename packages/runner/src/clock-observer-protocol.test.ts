import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOCK_POINTS, analyzeClockBursts, createClockObserverSchedule, type ClockBurst,
} from "./clock-observer-protocol.js";

function bursts(firstWidthSeconds = 0.0005, otherWidthSeconds = firstWidthSeconds): ClockBurst[] {
  return CLOCK_POINTS.map((point, pointIndex) => ({ point,
    samples: Array.from({ length: 5 }, (_, index) => {
      const beforeSeconds = (pointIndex * 5 + index) * 0.02;
      return { beforeSeconds, pageNowMs: beforeSeconds * 1000,
        afterSeconds: beforeSeconds + (index === 0 ? firstWidthSeconds : otherWidthSeconds) };
    }),
  }));
}

test("fixed schedule has three serial balanced sessions with U/P/U starts", () => {
  const schedule = createClockObserverSchedule();
  assert.equal(schedule.length, 36);
  assert.equal(new Set(schedule.map(entry => entry.id)).size, 36);
  assert.deepEqual(createClockObserverSchedule(), schedule);
  for (const session of [1, 2, 3]) {
    const rows = schedule.filter(entry => entry.session === session);
    assert.deepEqual(rows.map(entry => entry.probe), Array.from({ length: 12 }, (_, index) => index + 1));
    assert.equal(rows.filter(entry => entry.mode === "paced").length, 6);
    assert.equal(rows.filter(entry => entry.mode === "unpaced").length, 6);
    assert.equal(rows[0]!.mode, session === 2 ? "paced" : "unpaced");
    assert(rows.slice(1).every((row, index) => row.mode !== rows[index]!.mode));
  }
});

test("reference uses the first bracket of every point; candidate uses all fifteen", () => {
  const input = bursts(0.004, 0.0002);
  const snapshot = structuredClone(input);
  const result = analyzeClockBursts(input, 90);
  assert.deepEqual(input, snapshot);
  assert.equal(result.rawInput.bursts, input);
  assert.equal(result.reference.sampleCount, 3);
  assert.equal(result.candidate.sampleCount, 15);
  assert.equal(result.reference.reason, "width");
  assert(Math.abs(result.reference.widthMs! - 8) < 1e-9);
  assert.equal(result.candidate.status, "passed");
  assert(Math.abs(result.candidate.widthMs! - 4.2) < 1e-9);
  assert.equal(result.reference.offset!.clockResolutionMarginMs, 1);
  assert.equal(result.candidate.boundary!.clockResolutionMarginMs, 1);
  assert.match(result.candidate.boundary!.assumption, /not a proven universal/);
});

test("a valid candidate intersection cannot widen the valid reference boundary", () => {
  for (const otherWidth of [0.0001, 0.0003, 0.0005]) {
    const { reference, candidate } = analyzeClockBursts(bursts(0.0005, otherWidth), 90);
    assert.equal(reference.status, "passed");
    assert.equal(candidate.status, "passed");
    assert(candidate.widthMs! <= reference.widthMs!);
    assert(candidate.boundary!.lowerSeconds >= reference.boundary!.lowerSeconds);
    assert(candidate.boundary!.upperSeconds <= reference.boundary!.upperSeconds);
  }
});

test("widened calibration intervals may overlap even when the raw brackets do not", () => {
  const input = bursts();
  for (const sample of input[1]!.samples) sample.pageNowMs += 1.2;
  const result = analyzeClockBursts(input, 90);
  for (const method of [result.reference, result.candidate]) {
    assert.equal(method.status, "passed");
    assert(method.widthMs! > 2 && method.widthMs! < 4);
    assert(Math.abs(method.widthMs! - 3.3) < 1e-9);
  }
});

test("candidate does not discard an incompatible non-first sample", () => {
  const input = bursts();
  input[0]!.samples[1]!.pageNowMs += 10;
  const result = analyzeClockBursts(input, 90);
  assert.equal(result.reference.status, "passed");
  assert.equal(result.candidate.reason, "non-overlap");
  assert.equal(result.candidate.sampleCount, 15);
  assert.equal(result.candidate.widthMs, null);
  assert.equal(result.rawInput.bursts, input);
});

test("both disjoint intersections are recorded without abandoning the probe", () => {
  const input = bursts();
  input[1]!.samples[0]!.pageNowMs += 10;
  const result = analyzeClockBursts(input, 90);
  assert.equal(result.reference.reason, "non-overlap");
  assert.equal(result.candidate.reason, "non-overlap");
});

test("width gate stays at 5 ms with no tolerance added to acceptance", () => {
  const exact = analyzeClockBursts(bursts(0.001), 0);
  assert.equal(exact.reference.widthMs, 5);
  assert.equal(exact.reference.status, "passed");
  assert.equal(exact.candidate.status, "passed");
  const above = analyzeClockBursts(bursts(0.001001), 0);
  assert(above.reference.widthMs! > 5);
  assert.equal(above.reference.reason, "width");
  assert.equal(above.candidate.reason, "width");
});

test("incomplete or unordered input fails both methods and retains the supplied input", () => {
  const tooFew = bursts(); tooFew[0]!.samples = tooFew[0]!.samples.slice(0, 4);
  const tooMany = bursts(); tooMany[1]!.samples = [...tooMany[1]!.samples, { ...tooMany[1]!.samples[4]! }];
  const reversedPoints = [...bursts()].reverse();
  const reversedBracket = bursts(); reversedBracket[0]!.samples[1]!.afterSeconds = 0.019;
  const overlappingBrackets = bursts(); overlappingBrackets[0]!.samples[1]!.beforeSeconds = 0;
  const backwardsPageClock = bursts(); backwardsPageClock[1]!.samples[1]!.pageNowMs = 0;
  for (const input of [null, [], {}, bursts().slice(0, 2), tooFew, tooMany, reversedPoints,
    reversedBracket, overlappingBrackets, backwardsPageClock]) {
    const result = analyzeClockBursts(input, 90);
    assert.equal(result.reference.reason, "invalid-input");
    assert.equal(result.candidate.reason, "invalid-input");
    assert.equal(result.rawInput.bursts, input);
  }
});

test("nonfinite and negative clocks or markers cannot create interval evidence", () => {
  for (const field of ["beforeSeconds", "pageNowMs", "afterSeconds"] as const) {
    for (const value of [NaN, Infinity, -1]) {
      const input = bursts(); input[0]!.samples[0]![field] = value;
      assert.equal(analyzeClockBursts(input, 90).candidate.reason, "invalid-input");
    }
  }
  for (const marker of [NaN, Infinity, -1]) {
    assert.equal(analyzeClockBursts(bursts(), marker).reference.reason, "invalid-input");
  }
  const overflowing = CLOCK_POINTS.map(point => ({ point, samples: Array.from({ length: 5 }, () => (
    { beforeSeconds: Number.MAX_VALUE, afterSeconds: Number.MAX_VALUE, pageNowMs: 0 }
  )) }));
  const result = analyzeClockBursts(overflowing, Number.MAX_VALUE);
  assert.equal(result.reference.reason, "invalid-input");
  assert.equal(result.candidate.reason, "invalid-input");
});
