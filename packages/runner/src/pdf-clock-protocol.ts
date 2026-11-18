/** Fixed PDF observer integration: actual arms and nested interval analyses. */
import { createDeliverySchedule } from "./delivery-protocol.js";
import {
  calibrateOffset, mapPageTime,
  type CalibrationSample, type CalibratedTimeInterval,
} from "./partial-network.js";

export const PDF_CLOCK_POINTS = ["beforeRender", "afterRender", "afterVerification"] as const;
export type PdfClockPoint = (typeof PDF_CLOCK_POINTS)[number];
export interface PdfClockBurst { point: PdfClockPoint; samples: readonly CalibrationSample[]; }
export type PdfClockArm = "three" | "fifteen";
export function createPdfClockSchedule() {
  return [1, 2, 3].flatMap(session => createDeliverySchedule(0, 4).flatMap(entry => {
    const pairId = `session-${session}-block-${entry.block}-${entry.condition}`;
    const arms: PdfClockArm[] = (session + entry.block + entry.position) % 2 === 0 ? ["three", "fifteen"] : ["fifteen", "three"];
    return arms.map((arm, index) => ({ id: `${pairId}-${arm}`, session, block: entry.block,
      position: entry.position, condition: entry.condition, variant: entry.variant,
      rangeEnabled: entry.rangeEnabled, pairId, arm, armPosition: index + 1,
      bracketsPerPoint: arm === "three" ? 1 : 5 }));
  }));
}

export interface ClockMethodAnalysis {
  sampleCount: number;
  status: "passed" | "failed";
  reason: "invalid-input" | "non-overlap" | "width" | null;
  message: string | null;
  offset: CalibratedTimeInterval | null;
  boundary: CalibratedTimeInterval | null;
  widthMs: number | null;
  verificationBoundary: CalibratedTimeInterval | null;
}

function invalidInput(bursts: unknown, markerMs: number, verificationMs: number, bracketsPerPoint: number): string | null {
  if (![1, 5].includes(bracketsPerPoint)) return "Brackets per point must be exactly one or five.";
  if (!Number.isFinite(verificationMs) || verificationMs < markerMs) return "Verification must be finite and follow render.";
  if (!Number.isFinite(markerMs) || markerMs < 0) return "markerMs must be finite and nonnegative.";
  if (!Array.isArray(bursts) || bursts.length !== 3) return "Exactly three ordered clock bursts are required.";
  let previous: CalibrationSample | undefined;
  for (const [index, burst] of bursts.entries()) {
    if (burst === null || typeof burst !== "object" || burst.point !== PDF_CLOCK_POINTS[index]) {
      return "Clock points must be beforeRender, afterRender, afterVerification in that order.";
    }
    if (!Array.isArray(burst.samples) || burst.samples.length !== bracketsPerPoint) return "Each clock point must match the fixed arm budget.";
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
  return { sampleCount, status: "failed", reason, message, offset: null, boundary: null, widthMs: null, verificationBoundary: null };
}

function analyzeMethod(samples: readonly CalibrationSample[], markerMs: number, verificationMs: number): ClockMethodAnalysis {
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
    offset, boundary, widthMs, verificationBoundary: mapPageTime(verificationMs, offset, 1),
  };
}

/** Analyze all prescribed samples; width rejection does not erase a valid interval. */
export function analyzePdfClockBursts(bursts: unknown, markerMs: number, verificationMs: number, bracketsPerPoint: number) {
  const base = { rawInput: { bursts, markerMs, verificationMs, bracketsPerPoint }, resolutionMarginMs: 1, maximumBoundaryWidthMs: 5 } as const;
  const problem = invalidInput(bursts, markerMs, verificationMs, bracketsPerPoint);
  if (problem) return { ...base, reference: failed(0, "invalid-input", problem),
    candidate: bracketsPerPoint === 5 ? failed(0, "invalid-input", problem) : null };
  const ordered = bursts as readonly PdfClockBurst[];
  return { ...base,
    reference: analyzeMethod(ordered.map(burst => burst.samples[0]!), markerMs, verificationMs),
    candidate: bracketsPerPoint === 5 ? analyzeMethod(ordered.flatMap(burst => burst.samples), markerMs, verificationMs) : null,
  };
}
