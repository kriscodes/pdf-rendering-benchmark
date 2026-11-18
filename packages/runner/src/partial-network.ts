/** Clock mapping and conservative accounting of a CDP network-event ledger. */
export interface CalibrationSample {
  beforeSeconds: number;
  pageNowMs: number;
  afterSeconds: number;
}

export interface TimeInterval {
  lowerSeconds: number;
  upperSeconds: number;
}

export interface CalibratedTimeInterval extends TimeInterval {
  clockResolutionMarginMs: number;
  assumption: string;
}

const CLOCK_ASSUMPTION = "The configured margin assumes a bound on page-clock quantization/coarsening; it is not a proven universal browser bound. Calibration also assumes a stable additive clock offset across the trial.";

export type EventTimeClass = "at-or-before" | "uncertain" | "after";
export type RequestPhase = "measurement" | "verificationUncertain" | "verification";
export type Headers = Record<string, string>;

interface EventBase {
  requestId: string;
  timestampSeconds: number;
}

export type NetworkEvent =
  | (EventBase & { kind: "request"; url: string; method: string; headers: Headers })
  | (EventBase & { kind: "response"; status: number; headers: Headers })
  | (EventBase & { kind: "data"; dataLength: number; encodedDataLength: number })
  | (EventBase & { kind: "finished"; encodedDataLength: number })
  | (EventBase & { kind: "failed"; errorText: string; canceled?: boolean });

export interface NetworkBucket {
  requestStarts: number;
  responseHeaders: number;
  dataEvents: number;
  reportedDataBytes: number;
  reportedEncodedDataBytes: number;
  loadingFinished: number;
  loadingFailed: number;
  finishedEncodedDataLength: number;
}

export type TemporalBuckets = Record<EventTimeClass, NetworkBucket>;

export interface RequestSummary {
  requestId: string;
  url: string;
  method: string;
  startedSeconds: number;
  renderTimeClass: EventTimeClass;
  phase: RequestPhase;
  rangeHeader: string | null;
  responseStatus: number | null;
  contentRange: string | null;
  observedRangeResponse: boolean;
  rangeEvidence: string;
  completed: boolean;
  failed: boolean;
  byRenderTime: TemporalBuckets;
}

export interface NetworkSummary {
  documentUrl: string;
  renderBoundary: TimeInterval;
  verificationBoundary: TimeInterval | null;
  accounting: string;
  requestCount: number;
  byRenderTime: TemporalBuckets;
  reportedDataAtRender: {
    atOrBeforeBytes: number;
    uncertainBytes: number;
    atOrBeforePlusUncertainBytes: number;
  };
  byRequestPhase: Record<RequestPhase, { requestCount: number; byRenderTime: TemporalBuckets }>;
  range: { requestCount: number; observed206Count: number };
  requests: RequestSummary[];
}

function finite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite.`);
}

function nonnegative(value: number, name: string): void {
  finite(value, name);
  if (value < 0) throw new Error(`${name} must be nonnegative.`);
}

function interval(value: TimeInterval, name: string): void {
  finite(value.lowerSeconds, `${name}.lowerSeconds`);
  finite(value.upperSeconds, `${name}.upperSeconds`);
  if (value.lowerSeconds > value.upperSeconds) throw new Error(`${name} is reversed.`);
}

/** CDP Timestamp - page performance.now()/1000, bounded by each bracket. */
export function calibrateOffset(
  samples: readonly CalibrationSample[], clockResolutionMarginMs = 1,
): CalibratedTimeInterval {
  nonnegative(clockResolutionMarginMs, "clockResolutionMarginMs");
  const marginSeconds = clockResolutionMarginMs / 1000;
  if (samples.length === 0) throw new Error("At least one calibration sample is required.");
  let lower = -Infinity;
  let upper = Infinity;
  for (const sample of samples) {
    nonnegative(sample.beforeSeconds, "beforeSeconds");
    nonnegative(sample.pageNowMs, "pageNowMs");
    nonnegative(sample.afterSeconds, "afterSeconds");
    if (sample.beforeSeconds > sample.afterSeconds) throw new Error("Calibration bracket is reversed.");
    lower = Math.max(lower, sample.beforeSeconds - sample.pageNowMs / 1000 - marginSeconds);
    upper = Math.min(upper, sample.afterSeconds - sample.pageNowMs / 1000 + marginSeconds);
  }
  if (lower > upper) throw new Error("Calibration offset intervals do not overlap.");
  const result = { lowerSeconds: lower, upperSeconds: upper, clockResolutionMarginMs, assumption: CLOCK_ASSUMPTION };
  interval(result, "offset");
  return result;
}

export function mapPageTime(
  pageTimeMs: number, offset: TimeInterval, clockResolutionMarginMs = 1,
): CalibratedTimeInterval {
  nonnegative(pageTimeMs, "pageTimeMs");
  nonnegative(clockResolutionMarginMs, "clockResolutionMarginMs");
  interval(offset, "offset");
  const marginSeconds = clockResolutionMarginMs / 1000;
  const mapped = {
    lowerSeconds: pageTimeMs / 1000 + offset.lowerSeconds - marginSeconds,
    upperSeconds: pageTimeMs / 1000 + offset.upperSeconds + marginSeconds,
    clockResolutionMarginMs, assumption: CLOCK_ASSUMPTION,
  };
  interval(mapped, "mapped time");
  return mapped;
}

export function classifyEventTime(timestampSeconds: number, boundary: TimeInterval): EventTimeClass {
  nonnegative(timestampSeconds, "timestampSeconds");
  interval(boundary, "boundary");
  if (timestampSeconds <= boundary.lowerSeconds) return "at-or-before";
  if (timestampSeconds > boundary.upperSeconds) return "after";
  return "uncertain";
}

function emptyBuckets(): TemporalBuckets {
  const bucket = (): NetworkBucket => ({
    requestStarts: 0, responseHeaders: 0, dataEvents: 0,
    reportedDataBytes: 0, reportedEncodedDataBytes: 0,
    loadingFinished: 0, loadingFailed: 0, finishedEncodedDataLength: 0,
  });
  return { "at-or-before": bucket(), uncertain: bucket(), after: bucket() };
}

function record(bucket: NetworkBucket, event: NetworkEvent): void {
  switch (event.kind) {
    case "request": bucket.requestStarts++; break;
    case "response": bucket.responseHeaders++; break;
    case "data":
      bucket.dataEvents++;
      bucket.reportedDataBytes += event.dataLength;
      bucket.reportedEncodedDataBytes += event.encodedDataLength;
      break;
    case "finished":
      bucket.loadingFinished++;
      bucket.finishedEncodedDataLength += event.encodedDataLength;
      break;
    case "failed": bucket.loadingFailed++; break;
  }
}

function validateEvent(event: NetworkEvent): void {
  if (!event.requestId) throw new Error("Network event has no request ID.");
  nonnegative(event.timestampSeconds, "timestampSeconds");
  const bytes = (value: number): void => {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("CDP byte counts must be nonnegative safe integers.");
  };
  switch (event.kind) {
    case "request":
      if (!event.url || !event.method) throw new Error("Request URL and method are required.");
      break;
    case "response":
      if (!Number.isInteger(event.status) || event.status < 0 || event.status > 599) {
        throw new Error("Invalid HTTP response status.");
      }
      break;
    case "data": bytes(event.dataLength); bytes(event.encodedDataLength); break;
    case "finished": bytes(event.encodedDataLength); break;
    case "failed":
      if (!event.errorText) throw new Error("Failed request has no error text.");
      break;
    default: throw new Error("Unknown network event kind.");
  }
  if (event.kind === "request" || event.kind === "response") {
    if (event.headers === null || typeof event.headers !== "object"
        || !Object.values(event.headers).every(value => typeof value === "string")) {
      throw new Error("Network headers must contain strings.");
    }
  }
}

function header(headers: Headers, name: string): string | null {
  const values = Object.entries(headers)
    .filter(([key]) => key.toLowerCase() === name.toLowerCase()).map(([, value]) => value.trim());
  if (new Set(values).size > 1) throw new Error(`Conflicting ${name} headers.`);
  return values[0] ?? null;
}

function observedRange(
  request: Extract<NetworkEvent, { kind: "request" }>,
  response: Extract<NetworkEvent, { kind: "response" }> | undefined,
): { valid: boolean; reason: string } {
  const requested = header(request.headers, "range");
  if (requested === null) return { valid: false, reason: "No Range request header; advertised range support is not evidence of a range transfer." };
  if (request.method !== "GET") return { valid: false, reason: "Range evidence requires a GET request." };
  if (response?.status !== 206) return { valid: false, reason: "Range request has no observed 206 response." };
  const sent = /^bytes=(\d*)-(\d*)$/i.exec(requested);
  const received = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(header(response.headers, "content-range") ?? "");
  if (!sent || (!sent[1] && !sent[2]) || !received) {
    return { valid: false, reason: "Missing or unsupported single-range/Content-Range syntax; a numeric total is required." };
  }
  const start = BigInt(received[1]!);
  const end = BigInt(received[2]!);
  const total = BigInt(received[3]!);
  if (total <= 0n || start > end || end >= total) return { valid: false, reason: "Invalid Content-Range bounds." };
  let expectedStart: bigint;
  let expectedEnd: bigint;
  if (sent[1] === "") {
    const suffix = BigInt(sent[2]!);
    if (suffix <= 0n) return { valid: false, reason: "Invalid suffix range." };
    expectedStart = suffix < total ? total - suffix : 0n;
    expectedEnd = total - 1n;
  } else {
    expectedStart = BigInt(sent[1]!);
    const last = sent[2] === "" ? total - 1n : BigInt(sent[2]!);
    expectedEnd = last < total ? last : total - 1n;
  }
  if (start !== expectedStart || end !== expectedEnd) return { valid: false, reason: "Content-Range does not match the requested single range." };
  const length = header(response.headers, "content-length");
  if (length !== null && (!/^\d+$/.test(length) || BigInt(length) !== end - start + 1n)) {
    return { valid: false, reason: "Content-Length does not match Content-Range." };
  }
  return { valid: true, reason: "GET Range header and matching 206 Content-Range observed; completion is reported separately." };
}

/**
 * Uses CDP event timestamps, not callback arrival order. Counts reported data,
 * never true application/physical arrival bytes: CDP may coalesce data or emit
 * its event later than the bytes arrive. loadingFinished totals remain separate
 * from dataReceived sums and must not be added to them.
 */
export function summarizeNetwork(events: readonly NetworkEvent[], options: {
  documentUrl: string;
  renderBoundary: TimeInterval;
  verificationBoundary?: TimeInterval;
}): NetworkSummary {
  interval(options.renderBoundary, "renderBoundary");
  if (options.verificationBoundary) {
    interval(options.verificationBoundary, "verificationBoundary");
    if (options.verificationBoundary.upperSeconds < options.renderBoundary.lowerSeconds) {
      throw new Error("Verification boundary precedes render boundary.");
    }
  }
  if (!options.documentUrl) throw new Error("documentUrl is required.");
  const starts = new Map<string, Extract<NetworkEvent, { kind: "request" }>>();
  for (const event of events) {
    validateEvent(event);
    if (event.kind === "request") {
      if (starts.has(event.requestId)) throw new Error("Duplicate request ID start; redirects require a separate normalized ID.");
      starts.set(event.requestId, event);
    }
  }
  const byRenderTime = emptyBuckets();
  const phase = () => ({ requestCount: 0, byRenderTime: emptyBuckets() });
  const byRequestPhase = { measurement: phase(), verificationUncertain: phase(), verification: phase() };
  const requests: RequestSummary[] = [];
  for (const start of [...starts.values()].filter(event => event.url === options.documentUrl)
    .sort((a, b) => a.timestampSeconds - b.timestampSeconds || a.requestId.localeCompare(b.requestId))) {
    const ledger = events.filter(event => event.requestId === start.requestId);
    const responses = ledger.filter((event): event is Extract<NetworkEvent, { kind: "response" }> => event.kind === "response");
    if (responses.length > 1) throw new Error("Multiple response headers for one normalized request ID.");
    if (ledger.filter(event => event.kind === "finished" || event.kind === "failed").length > 1) {
      throw new Error("Multiple terminal events for one request ID.");
    }
    if (ledger.some(event => event.timestampSeconds < start.timestampSeconds)) {
      throw new Error("Network event timestamp precedes its request start.");
    }
    const verificationTime = options.verificationBoundary
      ? classifyEventTime(start.timestampSeconds, options.verificationBoundary) : "at-or-before";
    const requestPhase: RequestPhase = verificationTime === "after" ? "verification"
      : verificationTime === "uncertain" ? "verificationUncertain" : "measurement";
    const buckets = emptyBuckets();
    byRequestPhase[requestPhase].requestCount++;
    for (const event of ledger) {
      const timeClass = classifyEventTime(event.timestampSeconds, options.renderBoundary);
      record(buckets[timeClass], event);
      record(byRenderTime[timeClass], event);
      record(byRequestPhase[requestPhase].byRenderTime[timeClass], event);
    }
    const response = responses[0];
    const range = observedRange(start, response);
    requests.push({
      requestId: start.requestId, url: start.url, method: start.method,
      startedSeconds: start.timestampSeconds,
      renderTimeClass: classifyEventTime(start.timestampSeconds, options.renderBoundary),
      phase: requestPhase, rangeHeader: header(start.headers, "range"),
      responseStatus: response?.status ?? null,
      contentRange: response ? header(response.headers, "content-range") : null,
      observedRangeResponse: range.valid, rangeEvidence: range.reason,
      completed: ledger.some(event => event.kind === "finished"),
      failed: ledger.some(event => event.kind === "failed"),
      byRenderTime: buckets,
    });
  }
  return {
    documentUrl: options.documentUrl,
    renderBoundary: { ...options.renderBoundary },
    verificationBoundary: options.verificationBoundary ? { ...options.verificationBoundary } : null,
    accounting: "CDP dataReceived-reported bytes classified by event timestamp, conditional on the calibration clock-resolution and stable-offset assumptions. Interval categories bound event classification only, not true physical/application byte arrival; delayed/coalesced events can include earlier bytes. loadingFinished encoded totals are separate and must not be added to dataReceived sums. Verification phase is inferred from request-start timing, not a causal attribution of ongoing transfers.",
    requestCount: requests.length, byRenderTime,
    reportedDataAtRender: {
      atOrBeforeBytes: byRenderTime["at-or-before"].reportedDataBytes,
      uncertainBytes: byRenderTime.uncertain.reportedDataBytes,
      atOrBeforePlusUncertainBytes: byRenderTime["at-or-before"].reportedDataBytes + byRenderTime.uncertain.reportedDataBytes,
    },
    byRequestPhase,
    range: {
      requestCount: requests.filter(request => request.rangeHeader !== null).length,
      observed206Count: requests.filter(request => request.observedRangeResponse).length,
    },
    requests,
  };
}
