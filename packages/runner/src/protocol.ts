/** The controlled variants and serial, balanced order for the local pilot. */
export const VARIANTS = ["nonlinearized", "linearized"] as const;
export type Variant = (typeof VARIANTS)[number];
export type Phase = "warmup" | "measured";

export interface ScheduledTrial {
  id: string;
  phase: Phase;
  pair: number;
  position: 1 | 2;
  variant: Variant;
}

export interface TrialMeasurement {
  phase: Phase;
  pair: number;
  position: 1 | 2;
  variant: Variant;
  firstPageRenderMs: number;
}

export interface VariantSummary {
  count: number;
  medianMs: number;
  minMs: number;
  maxMs: number;
  p25Ms: number;
  p75Ms: number;
}

export interface TrialSummary {
  quantileMethod: "linear interpolation at (n - 1) * q";
  byVariant: Record<Variant, VariantSummary>;
  pairedDifference: {
    definition: "linearized minus nonlinearized";
    count: number;
    medianMs: number;
    minMs: number;
    maxMs: number;
  };
}

function requireMeasuredPairs(count: number): void {
  if (!Number.isSafeInteger(count) || count < 2 || count % 2 !== 0) {
    throw new Error("Measured pair count must be an even integer of at least 2.");
  }
}

function variantAt(pair: number, position: 1 | 2): Variant {
  const nonlinearizedFirst = pair % 2 === 1;
  return nonlinearizedFirst === (position === 1) ? "nonlinearized" : "linearized";
}

export function createSchedule(warmupPairs: number, measuredPairs: number): ScheduledTrial[] {
  if (!Number.isSafeInteger(warmupPairs) || warmupPairs < 0) {
    throw new Error("Warmup pair count must be a nonnegative integer.");
  }
  requireMeasuredPairs(measuredPairs);

  const schedule: ScheduledTrial[] = [];
  for (const phase of ["warmup", "measured"] as const) {
    const count = phase === "warmup" ? warmupPairs : measuredPairs;
    for (let pair = 1; pair <= count; pair += 1) {
      for (const position of [1, 2] as const) {
        const variant = variantAt(pair, position);
        schedule.push({ id: `${phase}-${pair}-${variant}`, phase, pair, position, variant });
      }
    }
  }
  return schedule;
}

function quantile(sorted: number[], q: number): number {
  const index = (sorted.length - 1) * q;
  const lower = sorted[Math.floor(index)];
  const upper = sorted[Math.ceil(index)];
  if (lower === undefined || upper === undefined) {
    throw new Error("Cannot summarize an empty set of measurements.");
  }
  return lower + (upper - lower) * (index - Math.floor(index));
}

function describe(values: number[]): VariantSummary {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    medianMs: quantile(sorted, 0.5),
    minMs: quantile(sorted, 0),
    maxMs: quantile(sorted, 1),
    p25Ms: quantile(sorted, 0.25),
    p75Ms: quantile(sorted, 0.75),
  };
}

/** Refuse partial or reordered runs; never turn missing samples into a summary. */
export function summarizeTrials(
  trials: readonly TrialMeasurement[],
  expectedMeasuredPairs: number,
): TrialSummary {
  requireMeasuredPairs(expectedMeasuredPairs);
  for (const trial of trials) {
    if (trial.phase !== "warmup" && trial.phase !== "measured") {
      throw new Error("Unexpected trial phase.");
    }
    if (!Number.isSafeInteger(trial.pair) || trial.pair < 1
        || (trial.position !== 1 && trial.position !== 2)
        || !VARIANTS.includes(trial.variant)) {
      throw new Error("Invalid trial pair, position, or variant.");
    }
    if (!Number.isFinite(trial.firstPageRenderMs) || trial.firstPageRenderMs < 0) {
      throw new Error("Render measurements must be finite and nonnegative.");
    }
  }

  const measured = trials.filter((trial) => trial.phase === "measured");
  if (measured.length !== expectedMeasuredPairs * 2) {
    throw new Error(`Expected ${expectedMeasuredPairs * 2} measured trials; got ${measured.length}.`);
  }
  for (const [index, trial] of measured.entries()) {
    const pair = Math.floor(index / 2) + 1;
    const position = index % 2 === 0 ? 1 : 2;
    if (trial.pair !== pair || trial.position !== position
        || trial.variant !== variantAt(pair, position)) {
      throw new Error("Measured trials must contain one of each variant per pair in scheduled AB/BA order.");
    }
  }

  const byVariant = {
    nonlinearized: describe(measured.filter((trial) => trial.variant === "nonlinearized")
      .map((trial) => trial.firstPageRenderMs)),
    linearized: describe(measured.filter((trial) => trial.variant === "linearized")
      .map((trial) => trial.firstPageRenderMs)),
  };
  const differences: number[] = [];
  for (let index = 0; index < measured.length; index += 2) {
    const first = measured[index];
    const second = measured[index + 1];
    if (first === undefined || second === undefined) {
      throw new Error("Incomplete measured pair.");
    }
    differences.push(first.variant === "linearized"
      ? first.firstPageRenderMs - second.firstPageRenderMs
      : second.firstPageRenderMs - first.firstPageRenderMs);
  }
  const paired = describe(differences);
  return {
    quantileMethod: "linear interpolation at (n - 1) * q",
    byVariant,
    pairedDifference: {
      definition: "linearized minus nonlinearized",
      count: paired.count,
      medianMs: paired.medianMs,
      minMs: paired.minMs,
      maxMs: paired.maxMs,
    },
  };
}
