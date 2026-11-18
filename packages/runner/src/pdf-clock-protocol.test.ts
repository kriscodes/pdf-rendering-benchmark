import test from "node:test";
import assert from "node:assert/strict";
import { PDF_CLOCK_POINTS, createPdfClockSchedule, analyzePdfClockBursts } from "./pdf-clock-protocol.js";
function bursts(count: number, width = .0004) {
  return PDF_CLOCK_POINTS.map((point, p) => ({ point, samples: Array.from({ length: count }, (_, i) => {
    const t = p + i / 20;
    return { beforeSeconds: 10 + t, pageNowMs: t * 1000, afterSeconds: 10 + t + width };
  }) }));
}
test("96-trial schedule preserves condition-pair Williams order and balanced actual arms", () => {
  const all = createPdfClockSchedule(); assert.equal(all.length, 96);
  assert.equal(new Set(all.map(x => x.id)).size, 96);
  for (let index = 0; index < all.length; index += 2) {
    const a = all[index]!; const b = all[index + 1]!;
    assert.equal(a.pairId, b.pairId); assert.equal(a.condition, b.condition);
    assert.equal(a.armPosition, 1); assert.equal(b.armPosition, 2); assert.notEqual(a.arm, b.arm);
    assert.equal(a.arm, (a.session + a.block + a.position) % 2 === 0 ? "three" : "fifteen");
  }
  for (const session of [1, 2, 3]) for (const condition of new Set(all.map(x => x.condition))) {
    const trials = all.filter(x => x.session === session && x.condition === condition);
    assert.equal(trials.length, 8);
    assert.deepEqual(trials.filter(x => x.arm === "three").map(x => x.position).sort(), [1, 2, 3, 4]);
    for (const arm of ["three", "fifteen"]) assert.equal(trials.filter(x => x.arm === arm && x.armPosition === 1).length, 2);
  }
  assert.equal(all.reduce((n, x) => n + x.bracketsPerPoint * 3, 0), 864);
});
test("actual low arm has exactly three samples and no invented candidate", () => {
  const r = analyzePdfClockBursts(bursts(1), 500, 1500, 1);
  assert.equal(r.reference.sampleCount, 3); assert.equal(r.reference.status, "passed"); assert.equal(r.candidate, null);
  assert(Math.abs(r.reference.verificationBoundary!.lowerSeconds - r.reference.boundary!.lowerSeconds - 1) < 1e-10);
});
test("high arm keeps first-index reference and all fifteen constraints", () => {
  const input = bursts(5, .002); input[0]!.samples[1]!.afterSeconds -= .0018;
  const r = analyzePdfClockBursts(input, 500, 1500, 5);
  assert.equal(r.reference.sampleCount, 3); assert.equal(r.reference.reason, "width");
  assert.equal(r.candidate!.sampleCount, 15); assert.equal(r.candidate!.status, "passed");
  assert(r.candidate!.widthMs! < r.reference.widthMs!); assert(r.reference.boundary);
});
test("an inconsistent non-first constraint cannot be silently removed", () => {
  const input = bursts(5); input[1]!.samples[2]!.pageNowMs += 10;
  const r = analyzePdfClockBursts(input, 500, 1500, 5);
  assert.equal(r.reference.status, "passed"); assert.equal(r.candidate!.reason, "non-overlap");
  assert.equal(r.candidate!.boundary, null); assert.equal(r.rawInput.bursts, input);
});
test("arm budgets, checkpoint order and marker order cannot change", () => {
  assert.equal(analyzePdfClockBursts(bursts(5), 500, 1500, 1).reference.reason, "invalid-input");
  assert.equal(analyzePdfClockBursts(bursts(1), 500, 1500, 5).candidate!.reason, "invalid-input");
  assert.equal(analyzePdfClockBursts(bursts(5).reverse(), 500, 1500, 5).reference.reason, "invalid-input");
  assert.equal(analyzePdfClockBursts(bursts(1), 500, 499, 1).reference.reason, "invalid-input");
  assert.equal(analyzePdfClockBursts(bursts(1), 500, 1500, 2).reference.reason, "invalid-input");
});
test("the unchanged gate is strict and failed widths keep both mapped boundaries", () => {
  const r = analyzePdfClockBursts(bursts(1, .001001), 500, 1500, 1);
  assert.equal(r.reference.reason, "width"); assert(r.reference.widthMs! > 5);
  assert(r.reference.boundary); assert(r.reference.verificationBoundary);
});
test("nonfinite, negative, reversed and out-of-order clocks reject the full input", () => {
  for (const corrupt of [(x: any) => { x[0].samples[0].pageNowMs = NaN; },
    (x: any) => { x[0].samples[0].beforeSeconds = -1; },
    (x: any) => { x[0].samples[0].afterSeconds = 0; },
    (x: any) => { x[1].samples[0].beforeSeconds = 9; }]) {
    const input = bursts(5); corrupt(input);
    const r = analyzePdfClockBursts(input, 500, 1500, 5);
    assert.equal(r.reference.reason, "invalid-input"); assert.equal(r.candidate!.reason, "invalid-input");
  }
});
