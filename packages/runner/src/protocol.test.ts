import assert from "node:assert/strict";
import test from "node:test";
import { createSchedule, summarizeTrials, type TrialMeasurement } from "./protocol.js";

function measurements(): TrialMeasurement[] {
  const values: Record<string, number> = {
    "1-nonlinearized": 10, "1-linearized": 16,
    "2-nonlinearized": 20, "2-linearized": 9,
    "3-nonlinearized": 30, "3-linearized": 31,
    "4-nonlinearized": 40, "4-linearized": 44,
  };
  return createSchedule(2, 4).map((trial) => ({
    ...trial,
    firstPageRenderMs: trial.phase === "warmup" ? 1_000_000 : values[`${trial.pair}-${trial.variant}`]!,
  }));
}

test("schedule is deterministic, balanced AB/BA and names phases separately", () => {
  const schedule = createSchedule(2, 10);
  assert.deepEqual(createSchedule(2, 10), schedule);
  assert.equal(schedule.length, 24);
  assert.equal(new Set(schedule.map((trial) => trial.id)).size, schedule.length);
  assert.deepEqual(schedule.slice(0, 4).map(({ variant }) => variant),
    ["nonlinearized", "linearized", "linearized", "nonlinearized"]);
  assert.deepEqual(schedule.slice(4, 8).map(({ pair, position, variant }) => [pair, position, variant]),
    [[1, 1, "nonlinearized"], [1, 2, "linearized"], [2, 1, "linearized"], [2, 2, "nonlinearized"]]);
  for (const variant of ["nonlinearized", "linearized"]) {
    const arm = schedule.filter((trial) => trial.phase === "measured" && trial.variant === variant);
    assert.equal(arm.length, 10);
    assert.equal(arm.filter((trial) => trial.position === 1).length, 5);
    assert.equal(arm.filter((trial) => trial.position === 2).length, 5);
  }
  assert.equal(createSchedule(0, 2).length, 4);
});

test("schedule rejects invalid or unbalanced counts", () => {
  for (const count of [-1, 0.5, NaN, Infinity]) {
    assert.throws(() => createSchedule(count, 2), /Warmup pair count/);
  }
  for (const count of [-2, 0, 1, 3, 2.5, NaN, Infinity]) {
    assert.throws(() => createSchedule(2, count), /Measured pair count/);
  }
});

test("summary excludes warmups and uses interpolated quartiles", () => {
  const trials = measurements();
  const snapshot = structuredClone(trials);
  const summary = summarizeTrials(trials, 4);
  assert.deepEqual(summary.byVariant.nonlinearized, {
    count: 4, medianMs: 25, minMs: 10, maxMs: 40, p25Ms: 17.5, p75Ms: 32.5,
  });
  assert.deepEqual(summary.byVariant.linearized, {
    count: 4, medianMs: 23.5, minMs: 9, maxMs: 44, p25Ms: 14.25, p75Ms: 34.25,
  });
  assert.equal(summary.quantileMethod, "linear interpolation at (n - 1) * q");
  assert.deepEqual(trials, snapshot, "summarization must not sort or rewrite raw evidence");
  assert.deepEqual(summarizeTrials(trials.filter((trial) => trial.phase === "measured"), 4), summary);
});

test("paired differences preserve signs regardless of alternating order", () => {
  assert.deepEqual(summarizeTrials(measurements(), 4).pairedDifference, {
    definition: "linearized minus nonlinearized", count: 4, medianMs: 2.5, minMs: -11, maxMs: 6,
  });
});

test("missing or extra measured trials cannot yield a summary", () => {
  const trials = measurements();
  assert.throws(() => summarizeTrials(trials.slice(0, -1), 4), /Expected 8 measured trials/);
  assert.throws(() => summarizeTrials([...trials, trials.at(-1)!], 4), /Expected 8 measured trials/);
  assert.throws(() => summarizeTrials(trials, 2), /Expected 4 measured trials/);
  assert.throws(() => summarizeTrials([], 0), /Measured pair count/);
});

test("duplicate arms, unexpected pairs and reordered samples are rejected", () => {
  const samples = measurements().filter((trial) => trial.phase === "measured");
  const duplicate = structuredClone(samples);
  duplicate[1] = { ...duplicate[0]! };
  assert.throws(() => summarizeTrials(duplicate, 4), /scheduled AB\/BA order/);
  const changedPair = structuredClone(samples);
  changedPair[0]!.pair = 5;
  assert.throws(() => summarizeTrials(changedPair, 4), /scheduled AB\/BA order/);
  const changedOrder = structuredClone(samples);
  [changedOrder[0], changedOrder[1]] = [changedOrder[1]!, changedOrder[0]!];
  assert.throws(() => summarizeTrials(changedOrder, 4), /scheduled AB\/BA order/);
  const changedArm = structuredClone(samples);
  changedArm[1]!.variant = "nonlinearized";
  assert.throws(() => summarizeTrials(changedArm, 4), /scheduled AB\/BA order/);
});

test("invalid durations are rejected, including discarded warmups", () => {
  for (const phase of ["warmup", "measured"]) {
    for (const duration of [-1, NaN, Infinity, -Infinity]) {
      const trials = measurements();
      trials.find((trial) => trial.phase === phase)!.firstPageRenderMs = duration;
      assert.throws(() => summarizeTrials(trials, 4), /finite and nonnegative/);
    }
  }
});

test("invalid trial metadata cannot be silently ignored", () => {
  const mutations = [
    { phase: "unknown" }, { pair: 0 }, { pair: 1.5 },
    { position: 3 }, { variant: "other" },
  ];
  for (const mutation of mutations) {
    const trials = measurements();
    Object.assign(trials[0]!, mutation);
    assert.throws(() => summarizeTrials(trials, 4), /Unexpected trial phase|Invalid trial pair/);
  }
});
