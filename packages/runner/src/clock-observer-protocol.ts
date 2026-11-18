/** Fixed observer diagnostic; every bracket is retained and both methods run. */
import {
  calibrateOffset, mapPageTime,
  type CalibrationSample, type CalibratedTimeInterval,
} from "./partial-network.js";

export const CLOCK_POINTS = ["beforeMarker", "afterMarker", "afterSecondTransfer"] as const;
export type ClockPoint = (typeof CLOCK_POINTS)[number];
export type ClockProbeMode = "unpaced" | "paced";

export interface ClockBurst {
  point: ClockPoint;
  samples: readonly CalibrationSample[];
}

export interface ClockObserverProbe {
  id: string;
  session: 1 | 2 | 3;
  probe: number;
  mode: ClockProbeMode;
}

export interface ClockMethodAnalysis {
  sampleCount: number;
  status: "passed" | "failed";
  reason: "invalid-input" | "non-overlap" | "width" | null;
  message: string | null;
  offset: CalibratedTimeInterval | null;
  boundary: CalibratedTimeInterval | null;
  widthMs: number | null;
}

export interface ClockBurstAnalysis {
  rawInput: { bursts: unknown; markerMs: number };
  resolutionMarginMs: 1;
  maximumBoundaryWidthMs: 5;
  reference: ClockMethodAnalysis;
  candidate: ClockMethodAnalysis;
}

/** Three sessions, twelve probes each, alternating U/P with U/P/U starts. */
export function createClockObserverSchedule(): ClockObserverProbe[] {
  const schedule: ClockObserverProbe[] = [];
  for (const session of [1, 2, 3] as const) {
    for (let probe = 1; probe <= 12; probe++) {
      const mode = (session + probe) % 2 === 0 ? "unpaced" : "paced";
      schedule.push({ id: `session-${session}-probe-${probe}-${mode}`, session, probe, mode });
    }
  }
  return schedule;
}

function invalidInput(bursts: unknown, markerMs: number): string | null {
  if (!Number.isFinite(markerMs) || markerMs < 0) return "markerMs must be finite and nonnegative.";
  if (!Array.isArray(bursts) || bursts.length !== 3) return "Exactly three ordered clock bursts are required.";
  let previous: CalibrationSample | undefined;
  for (const [index, burst] of bursts.entries()) {
    if (burst === null || typeof burst !== "object" || burst.point !== CLOCK_POINTS[index]) {
      return "Clock points must be beforeMarker, afterMarker, afterSecondTransfer in that order.";
    }
    if (!Array.isArray(burst.samples) || burst.samples.length !== 5) return "Each clock point requires exactly five samples.";
    for (const sample of burst.samples) {
      if (sample === null || typeof sample !== "object") return "Each sample must contain a finite ordered bracket.";
      for (const field of ["beforeSeconds", "pageNowMs", "afterSeconds"] as const) {
        if (typeof sample[field] !== "number" || !Number.isFinite(sample[field]) || sample[field] < 0) {
          return `${field} must be finite and nonnegative.`;
        }
      }
      if (sample.beforeSeconds > sample.afterSeconds) return "A calibration bracket is reversed.";
      if (previous && (previous.afterSeconds > sample.beforeSeconds || previous.pageNowMs > sample.pageNowMs)) {
        return "Calibration samples must follow collection order in both clocks.";
      }
      previous = sample as CalibrationSample;
    }
  }
  return null;
}

function failed(sampleCount: number, reason: "invalid-input" | "non-overlap", message: string): ClockMethodAnalysis {
  return { sampleCount, status: "failed", reason, message, offset: null, boundary: null, widthMs: null };
}

function analyzeMethod(samples: readonly CalibrationSample[], markerMs: number): ClockMethodAnalysis {
  let offset: CalibratedTimeInterval;
  try {
    offset = calibrateOffset(samples, 1);
  } catch (error) {
    // Input structure/order/values have already been checked. The remaining
    // calibration failure is an empty intersection, never grounds to omit a sample.
    return failed(samples.length, "non-overlap", String(error));
  }
  let boundary: CalibratedTimeInterval;
  try {
    boundary = mapPageTime(markerMs, offset, 1);
  } catch (error) {
    return failed(samples.length, "invalid-input", String(error));
  }
  const widthMs = (boundary.upperSeconds - boundary.lowerSeconds) * 1000;
  const passed = widthMs <= 5;
  return {
    sampleCount: samples.length, status: passed ? "passed" : "failed",
    reason: passed ? null : "width", message: passed ? null : "Clock boundary exceeds the unchanged 5 ms gate.",
    offset, boundary, widthMs,
  };
}

/**
 * Reference: index zero at each point. Candidate: all fifteen brackets.
 * The same 1 ms margin is used once for calibration and once for marker mapping.
 * Known transfer/event correctness is a separate gate owned by the caller.
 */
export function analyzeClockBursts(bursts: unknown, markerMs: number): ClockBurstAnalysis {
  const base = { rawInput: { bursts, markerMs }, resolutionMarginMs: 1, maximumBoundaryWidthMs: 5 } as const;
  const problem = invalidInput(bursts, markerMs);
  if (problem) {
    return { ...base, reference: failed(0, "invalid-input", problem), candidate: failed(0, "invalid-input", problem) };
  }
  const ordered = bursts as readonly ClockBurst[];
  return {
    ...base,
    reference: analyzeMethod(ordered.map(burst => burst.samples[0]!), markerMs),
    candidate: analyzeMethod(ordered.flatMap(burst => burst.samples), markerMs),
  };
}
