/** Fixed four-condition order and descriptive within-block contrasts. */
export const CONDITIONS = [
  { code: "A", id: "nonlinearized-range-enabled", variant: "nonlinearized", rangeEnabled: true },
  { code: "B", id: "linearized-range-enabled", variant: "linearized", rangeEnabled: true },
  { code: "C", id: "nonlinearized-range-disabled", variant: "nonlinearized", rangeEnabled: false },
  { code: "D", id: "linearized-range-disabled", variant: "linearized", rangeEnabled: false },
] as const;

export type Condition = (typeof CONDITIONS)[number]["id"];
export type DeliveryVariant = (typeof CONDITIONS)[number]["variant"];
export type DeliveryPhase = "warmup" | "measured";

export interface DeliveryTrial {
  id: string;
  phase: DeliveryPhase;
  block: number;
  position: 1 | 2 | 3 | 4;
  condition: Condition;
  variant: DeliveryVariant;
  rangeEnabled: boolean;
}

export interface DeliveryMeasurement extends DeliveryTrial {
  firstPageRenderMs: number;
}

export interface DeliveryStatistics {
  count: number;
  medianMs: number;
  minMs: number;
  maxMs: number;
  p25Ms: number;
  p75Ms: number;
}

export interface DeliveryContrast extends DeliveryStatistics {
  definition: string;
  blocks: { block: number; differenceMs: number }[];
}

export interface DeliverySummary {
  interpretation: "Descriptive statistics only; no inferential significance claim.";
  quantileMethod: "linear interpolation at (n - 1) * q";
  measuredBlocks: number;
  excludedWarmupBlocks: number;
  byCondition: Record<Condition, DeliveryStatistics>;
  pairedStructureEffect: {
    rangeEnabled: DeliveryContrast;
    rangeDisabled: DeliveryContrast;
  };
  pairedRangeEffect: Record<DeliveryVariant, DeliveryContrast>;
  differenceOfStructureEffects: DeliveryContrast;
}

const [A, B, C, D] = CONDITIONS;
const WILLIAMS_ROWS = [
  [A, B, D, C],
  [B, C, A, D],
  [C, D, B, A],
  [D, A, C, B],
] as const;

function validateBlockCounts(warmupBlocks: number, measuredBlocks: number): void {
  if (!Number.isSafeInteger(warmupBlocks) || warmupBlocks < 0 || warmupBlocks % 4 !== 0) {
    throw new Error("Warmup block count must be zero or a positive multiple of four.");
  }
  if (!Number.isSafeInteger(measuredBlocks) || measuredBlocks < 4 || measuredBlocks % 4 !== 0) {
    throw new Error("Measured block count must be a positive multiple of four.");
  }
}

/** Each phase starts a complete Williams cycle; block numbers restart at one. */
export function createDeliverySchedule(warmupBlocks = 4, measuredBlocks = 12): DeliveryTrial[] {
  validateBlockCounts(warmupBlocks, measuredBlocks);
  const trials: DeliveryTrial[] = [];
  for (const phase of ["warmup", "measured"] as const) {
    const count = phase === "warmup" ? warmupBlocks : measuredBlocks;
    for (let block = 1; block <= count; block++) {
      const row = WILLIAMS_ROWS[(block - 1) % 4]!;
      for (const [index, metadata] of row.entries()) {
        trials.push({
          id: `${phase}-${block}-${metadata.id}`,
          phase, block, position: (index + 1) as 1 | 2 | 3 | 4,
          condition: metadata.id, variant: metadata.variant, rangeEnabled: metadata.rangeEnabled,
        });
      }
    }
  }
  return trials;
}

function quantile(sorted: number[], q: number): number {
  const index = (sorted.length - 1) * q;
  const lower = sorted[Math.floor(index)];
  const upper = sorted[Math.ceil(index)];
  if (lower === undefined || upper === undefined) throw new Error("Cannot summarize empty measurements.");
  return lower + (upper - lower) * (index - Math.floor(index));
}

function describe(values: number[]): DeliveryStatistics {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.some(value => !Number.isFinite(value))) throw new Error("A computed contrast is not finite.");
  const statistics = {
    count: sorted.length,
    medianMs: quantile(sorted, 0.5), minMs: quantile(sorted, 0), maxMs: quantile(sorted, 1),
    p25Ms: quantile(sorted, 0.25), p75Ms: quantile(sorted, 0.75),
  };
  if (Object.values(statistics).some(value => !Number.isFinite(value))) {
    throw new Error("Computed descriptive statistics are not finite.");
  }
  return statistics;
}

/** Every contrast uses all four observations from the same measured block. */
export function summarizeDeliveryTrials(
  trials: readonly DeliveryMeasurement[], measuredBlocks = 12, expectedWarmupBlocks = 4,
): DeliverySummary {
  const expected = createDeliverySchedule(expectedWarmupBlocks, measuredBlocks);
  if (trials.length !== expected.length) {
    throw new Error(`Expected ${expected.length} total trials including warmups; got ${trials.length}.`);
  }
  for (const [index, trial] of trials.entries()) {
    const scheduled = expected[index]!;
    for (const key of ["id", "phase", "block", "position", "condition", "variant", "rangeEnabled"] as const) {
      if (trial[key] !== scheduled[key]) {
        throw new Error(`Trial ${index + 1}: ${key} differs from the complete Williams schedule.`);
      }
    }
    if (!Number.isFinite(trial.firstPageRenderMs) || trial.firstPageRenderMs < 0) {
      throw new Error("Render measurements must be finite and nonnegative, including excluded warmups.");
    }
  }
  const measured = trials.filter(trial => trial.phase === "measured");
  const byCondition = Object.fromEntries(CONDITIONS.map(({ id }) => [
    id, describe(measured.filter(trial => trial.condition === id).map(trial => trial.firstPageRenderMs)),
  ])) as Record<Condition, DeliveryStatistics>;
  const blocks: Record<Condition, number>[] = [];
  for (let block = 1; block <= measuredBlocks; block++) {
    const entries = measured.filter(trial => trial.block === block);
    // Exact schedule validation above guarantees one value of each condition.
    blocks.push(Object.fromEntries(entries.map(trial => [trial.condition, trial.firstPageRenderMs])) as Record<Condition, number>);
  }
  const contrast = (definition: string, calculate: (block: Record<Condition, number>) => number): DeliveryContrast => {
    const values = blocks.map((block, index) => ({ block: index + 1, differenceMs: calculate(block) }));
    return { definition, ...describe(values.map(value => value.differenceMs)), blocks: values };
  };
  return {
    interpretation: "Descriptive statistics only; no inferential significance claim.",
    quantileMethod: "linear interpolation at (n - 1) * q",
    measuredBlocks, excludedWarmupBlocks: expectedWarmupBlocks, byCondition,
    pairedStructureEffect: {
      rangeEnabled: contrast("linearized minus nonlinearized, range enabled", block => block[B.id] - block[A.id]),
      rangeDisabled: contrast("linearized minus nonlinearized, range disabled", block => block[D.id] - block[C.id]),
    },
    pairedRangeEffect: {
      nonlinearized: contrast("range enabled minus range disabled, nonlinearized", block => block[A.id] - block[C.id]),
      linearized: contrast("range enabled minus range disabled, linearized", block => block[B.id] - block[D.id]),
    },
    differenceOfStructureEffects: contrast(
      "(linearized minus nonlinearized) with range enabled minus (linearized minus nonlinearized) with range disabled",
      block => (block[B.id] - block[A.id]) - (block[D.id] - block[C.id]),
    ),
  };
}
