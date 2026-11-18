import assert from "node:assert/strict";
import test from "node:test";
import {
  CONDITIONS, createDeliverySchedule, summarizeDeliveryTrials,
  type Condition, type DeliveryMeasurement,
} from "./delivery-protocol.js";

const ids = {
  A: "nonlinearized-range-enabled", B: "linearized-range-enabled",
  C: "nonlinearized-range-disabled", D: "linearized-range-disabled",
} as const;

function measurements(): DeliveryMeasurement[] {
  const measured: Record<Condition, number[]> = {
    [ids.A]: [110, 120, 130, 140],
    [ids.B]: [106, 122, 124, 148],
    [ids.C]: [130, 130, 160, 140],
    [ids.D]: [128, 134, 159, 141],
  };
  return createDeliverySchedule(4, 4).map(trial => ({
    ...trial,
    firstPageRenderMs: trial.phase === "warmup" ? 1_000_000 : measured[trial.condition][trial.block - 1]!,
  }));
}

test("default schedule contains complete deterministic Williams cycles", () => {
  const schedule = createDeliverySchedule();
  assert.deepEqual(createDeliverySchedule(), schedule);
  assert.equal(schedule.length, 64);
  assert.equal(schedule.filter(trial => trial.phase === "warmup").length, 16);
  assert.equal(schedule.filter(trial => trial.phase === "measured").length, 48);
  assert.equal(new Set(schedule.map(trial => trial.id)).size, 64);
  const expectedRows = [
    [ids.A, ids.B, ids.D, ids.C], [ids.B, ids.C, ids.A, ids.D],
    [ids.C, ids.D, ids.B, ids.A], [ids.D, ids.A, ids.C, ids.B],
  ];
  for (const phase of ["warmup", "measured"]) {
    const trials = schedule.filter(trial => trial.phase === phase);
    for (let index = 0; index < trials.length; index += 4) {
      const block = trials.slice(index, index + 4);
      assert.deepEqual(block.map(trial => trial.condition), expectedRows[(index / 4) % 4]);
      assert.deepEqual(block.map(trial => trial.position), [1, 2, 3, 4]);
      assert(block.every(trial => trial.block === index / 4 + 1));
    }
  }
});

test("each measured condition occupies every position equally and each within-block predecessor is balanced", () => {
  const measured = createDeliverySchedule().filter(trial => trial.phase === "measured");
  for (const condition of Object.values(ids)) {
    const arm = measured.filter(trial => trial.condition === condition);
    assert.equal(arm.length, 12);
    for (const position of [1, 2, 3, 4]) assert.equal(arm.filter(trial => trial.position === position).length, 3);
  }
  const predecessors = new Map<string, number>();
  for (let index = 0; index < measured.length; index++) {
    if (index % 4 === 0) continue;
    const key = `${measured[index - 1]!.condition}->${measured[index]!.condition}`;
    predecessors.set(key, (predecessors.get(key) ?? 0) + 1);
  }
  assert.equal(predecessors.size, 12);
  assert([...predecessors.values()].every(count => count === 3));
  assert.deepEqual(CONDITIONS.map(({ code, id, variant, rangeEnabled }) => [code, id, variant, rangeEnabled]), [
    ["A", ids.A, "nonlinearized", true], ["B", ids.B, "linearized", true],
    ["C", ids.C, "nonlinearized", false], ["D", ids.D, "linearized", false],
  ]);
});

test("rejects incomplete cycle counts and permits explicitly zero warmups", () => {
  for (const warmups of [-4, 1, 2, 3, 4.5, NaN, Infinity]) {
    assert.throws(() => createDeliverySchedule(warmups, 12), /Warmup block count/);
  }
  for (const measured of [-4, 0, 1, 2, 3, 5, 4.5, NaN, Infinity]) {
    assert.throws(() => createDeliverySchedule(4, measured), /Measured block count/);
  }
  assert.equal(createDeliverySchedule(0, 4).length, 16);
});

test("descriptive condition summaries exclude every warmup and leave raw trials untouched", () => {
  const trials = measurements();
  const snapshot = structuredClone(trials);
  const summary = summarizeDeliveryTrials(trials, 4);
  assert.deepEqual(summary.byCondition[ids.A], {
    count: 4, medianMs: 125, minMs: 110, maxMs: 140, p25Ms: 117.5, p75Ms: 132.5,
  });
  assert.equal(summary.byCondition[ids.B].medianMs, 123);
  assert.equal(summary.byCondition[ids.C].medianMs, 135);
  assert.equal(summary.byCondition[ids.D].medianMs, 137.5);
  assert(Object.values(summary.byCondition).every(condition => condition.count === 4));
  assert.equal(summary.excludedWarmupBlocks, 4);
  assert.equal(summary.measuredBlocks, 4);
  assert.match(summary.interpretation, /no inferential significance claim/);
  assert.equal(summary.quantileMethod, "linear interpolation at (n - 1) * q");
  assert.deepEqual(trials, snapshot);
});

test("all contrasts are paired within labeled blocks with explicit correct signs", () => {
  const summary = summarizeDeliveryTrials(measurements(), 4);
  const structures = summary.pairedStructureEffect;
  assert.deepEqual(structures.rangeEnabled.blocks, [
    { block: 1, differenceMs: -4 }, { block: 2, differenceMs: 2 },
    { block: 3, differenceMs: -6 }, { block: 4, differenceMs: 8 },
  ]);
  assert.equal(structures.rangeEnabled.medianMs, -1);
  assert.equal(structures.rangeEnabled.minMs, -6);
  assert.equal(structures.rangeEnabled.maxMs, 8);
  assert.equal(structures.rangeEnabled.p25Ms, -4.5);
  assert.equal(structures.rangeEnabled.p75Ms, 3.5);
  assert.deepEqual(structures.rangeDisabled.blocks.map(block => block.differenceMs), [-2, 4, -1, 1]);
  assert.equal(structures.rangeDisabled.medianMs, 0);
  assert.deepEqual(summary.pairedRangeEffect.nonlinearized.blocks.map(block => block.differenceMs), [-20, -10, -30, 0]);
  assert.deepEqual(summary.pairedRangeEffect.linearized.blocks.map(block => block.differenceMs), [-22, -12, -35, 7]);
  assert.equal(summary.pairedRangeEffect.nonlinearized.medianMs, -15);
  assert.equal(summary.pairedRangeEffect.linearized.medianMs, -17);
  assert.deepEqual(summary.differenceOfStructureEffects.blocks.map(block => block.differenceMs), [-2, -2, -5, 7]);
  assert.equal(summary.differenceOfStructureEffects.medianMs, -2);
  assert.notEqual(summary.differenceOfStructureEffects.medianMs,
    structures.rangeEnabled.medianMs - structures.rangeDisabled.medianMs,
    "median of paired interactions is not the subtraction of marginal medians");
});

test("missing trials, missing whole warmup blocks, extra samples, and duplicate arms fail", () => {
  const trials = measurements();
  assert.throws(() => summarizeDeliveryTrials(trials.slice(0, -1), 4), /Expected 32 total trials/);
  assert.throws(() => summarizeDeliveryTrials([...trials, trials.at(-1)!], 4), /Expected 32 total trials/);
  const measuredOnly = trials.filter(trial => trial.phase === "measured");
  assert.throws(() => summarizeDeliveryTrials(measuredOnly, 4), /Expected 32 total trials/);
  assert.equal(summarizeDeliveryTrials(measuredOnly, 4, 0).excludedWarmupBlocks, 0);
  const duplicate = structuredClone(trials);
  duplicate[17] = { ...duplicate[16]! };
  assert.throws(() => summarizeDeliveryTrials(duplicate, 4), /complete Williams schedule/);
});

test("reordering or altering block, phase, position, condition and delivery metadata fails", () => {
  const mutations = [
    { block: 5 }, { phase: "warmup" }, { position: 4 }, { condition: ids.B },
    { variant: "linearized" }, { rangeEnabled: false }, { id: "unexpected-id" },
  ];
  for (const mutation of mutations) {
    const trials = measurements();
    Object.assign(trials[16]!, mutation);
    assert.throws(() => summarizeDeliveryTrials(trials, 4), /complete Williams schedule/);
  }
  const reordered = measurements();
  [reordered[16], reordered[17]] = [reordered[17]!, reordered[16]!];
  assert.throws(() => summarizeDeliveryTrials(reordered, 4), /complete Williams schedule/);
});

test("nonfinite and negative measurements are rejected in measured and excluded warmup trials", () => {
  for (const index of [0, 16]) {
    for (const value of [-1, NaN, Infinity, -Infinity]) {
      const trials = measurements();
      trials[index]!.firstPageRenderMs = value;
      assert.throws(() => summarizeDeliveryTrials(trials, 4), /finite and nonnegative/);
    }
  }
});
