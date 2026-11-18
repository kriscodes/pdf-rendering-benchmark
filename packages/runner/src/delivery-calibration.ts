import assert from "node:assert/strict";
import { PACING_PROFILE } from "./paced-server.js";

// Allows floating-point subtraction noise, not a meaningful scheduling overlap.
const EPSILON_MS = 1e-6;

function number(value: any, name: string): number {
  assert(typeof value === "number" && Number.isFinite(value) && value >= 0,
    `${name} must be a finite nonnegative number`);
  return value;
}

function bytes(value: any, name: string): number {
  number(value, name);
  assert(Number.isSafeInteger(value), `${name} must be a safe integer`);
  return value;
}

function within(value: number, minimum: number, maximum: number, name: string): void {
  assert(value >= minimum - EPSILON_MS && value <= maximum + EPSILON_MS,
    `${name}: ${value} is outside [${minimum}, ${maximum}]`);
}

function calibrationLimits(calibration: any) {
  const minimum = number(calibration.headerMinimumMs, "headerMinimumMs");
  const maximum = number(calibration.headerMaximumMs, "headerMaximumMs");
  assert(minimum <= maximum, "Header calibration bounds are reversed");
  return {
    minimum, maximum,
    earlyTolerance: number(calibration.minimumDurationToleranceMs, "minimumDurationToleranceMs"),
    lateTolerance: number(calibration.maximumWriteLatenessMs, "maximumWriteLatenessMs"),
  };
}

/** Audit all paced records together so simultaneous responses cannot each claim a full budget. */
export function auditPacing(requests: any[], calibration: any) {
  assert(Array.isArray(requests), "Requests must be an array");
  const paced = requests.filter(request => request?.paced === true);
  assert(paced.length > 0, "No paced requests to audit");
  const limits = calibrationLimits(calibration);
  const allWrites: any[] = [];
  const perRequest = paced.map((request, index) => {
    const label = `Paced request ${index} (${request.url})`;
    assert(request.completed === true && request.canceled === false
      && request.canceledAtMs === null, `${label}: incomplete or canceled response`);
    const requestAt = number(request.requestAtMs, `${label}.requestAtMs`);
    const headersAt = number(request.headersAtMs, `${label}.headersAtMs`);
    const scheduledHeaders = number(request.headersScheduledForMs, `${label}.headersScheduledForMs`);
    within(scheduledHeaders - requestAt, PACING_PROFILE.responseHeaderDelayMs,
      PACING_PROFILE.responseHeaderDelayMs, `${label}: header scheduling delay`);
    const headerDelayMs = headersAt - requestAt;
    within(headerDelayMs, limits.minimum, limits.maximum, `${label}: header delay`);
    const planned = bytes(request.bodyBytesPlanned, `${label}.bodyBytesPlanned`);
    const written = bytes(request.bodyBytesWritten, `${label}.bodyBytesWritten`);
    assert.equal(written, planned, `${label}: written body differs from planned bytes`);
    assert(Array.isArray(request.writes), `${label}: missing write ledger`);
    let cumulative = 0;
    let previousWrittenAt = headersAt;
    let maximumLatenessMs = 0;
    for (const [writeIndex, write] of request.writes.entries()) {
      const writeLabel = `${label} write ${writeIndex}`;
      const length = bytes(write.bytes, `${writeLabel}.bytes`);
      assert(length > 0 && length <= PACING_PROFILE.maxQuantumBytes, `${writeLabel}: invalid write quantum`);
      const started = number(write.serializationStartedAtMs, `${writeLabel}.serializationStartedAtMs`);
      const scheduled = number(write.scheduledForMs, `${writeLabel}.scheduledForMs`);
      const actual = number(write.writtenAtMs, `${writeLabel}.writtenAtMs`);
      assert(started >= previousWrittenAt - EPSILON_MS, `${writeLabel}: serialization starts before preceding release`);
      const nominalMs = length / PACING_PROFILE.bytesPerSecond * 1000;
      within(scheduled - started, nominalMs, nominalMs, `${writeLabel}: serialization duration`);
      within(actual - scheduled, -limits.earlyTolerance, limits.lateTolerance, `${writeLabel}: write release lateness`);
      assert(actual >= started - EPSILON_MS, `${writeLabel}: release precedes serialization start`);
      cumulative += length;
      assert.equal(write.cumulativeBytes, cumulative, `${writeLabel}: inconsistent cumulative byte count`);
      maximumLatenessMs = Math.max(maximumLatenessMs, actual - scheduled);
      previousWrittenAt = actual;
      allWrites.push({ ...write, requestIndex: index });
    }
    assert.equal(cumulative, planned, `${label}: write ledger does not account for the body`);
    if (planned > 0) {
      within(number(request.bodyStartedAtMs, `${label}.bodyStartedAtMs`),
        request.writes[0].writtenAtMs, request.writes[0].writtenAtMs, `${label}: first body release`);
    } else {
      assert.equal(request.bodyStartedAtMs, null, `${label}: empty response has a body start`);
    }
    const endAt = number(request.endAtMs, `${label}.endAtMs`);
    const completedAt = number(request.completedAtMs, `${label}.completedAtMs`);
    assert(endAt >= previousWrittenAt - EPSILON_MS && completedAt >= endAt - EPSILON_MS,
      `${label}: invalid completion ordering`);
    return { url: request.url, bodyBytes: written, headerDelayMs,
      bodyDurationMs: endAt - headersAt, writeCount: request.writes.length, maximumWriteLatenessMs: maximumLatenessMs };
  });

  allWrites.sort((a, b) => a.writtenAtMs - b.writtenAtMs);
  for (let index = 1; index < allWrites.length; index++) {
    assert(allWrites[index].serializationStartedAtMs >= allWrites[index - 1].writtenAtMs - EPSILON_MS,
      "Aggregate body serialization overlaps a preceding release (independent budgets or catch-up burst)");
  }
  const lateness = allWrites.map(write => write.writtenAtMs - write.scheduledForMs);
  return {
    status: "passed", profile: { ...PACING_PROFILE },
    pacedRequestCount: paced.length, ignoredUnpacedRequestCount: requests.length - paced.length,
    totalBodyBytes: perRequest.reduce((sum, request) => sum + request.bodyBytes, 0),
    writeCount: allWrites.length,
    headerDelayMs: { minimum: Math.min(...perRequest.map(request => request.headerDelayMs)),
      maximum: Math.max(...perRequest.map(request => request.headerDelayMs)) },
    maximumWriteLatenessMs: Math.max(0, ...lateness),
    maximumEarlyReleaseMs: Math.max(0, ...lateness.map(value => -value)),
    aggregateSerializationOverlapToleranceMs: EPSILON_MS,
    requests: perRequest,
    interpretation: "Server response.write release accounting; not proof of browser receipt. One shared serialization budget, with declared timing tolerances.",
  };
}

function requestTarget(url: any): string {
  assert(typeof url === "string" && url.length > 0, "Calibration request URL is missing");
  const parsed = new URL(url, "http://calibration.invalid");
  return parsed.pathname + parsed.search;
}

/** Full experiment config; URLs correlate client/server records when supplied. */
export function auditCalibrationGroup(requests: any[], browserResults: any[], config: any) {
  assert.deepEqual(config.delivery, PACING_PROFILE, "Calibration delivery profile differs from the server profile");
  const pacing = auditPacing(requests, config.calibration);
  const paced = requests.filter(request => request?.paced === true);
  assert(Array.isArray(browserResults) && browserResults.length === paced.length,
    "Calibration client/server request counts differ");
  const expectedBytes = bytes(config.calibration.rangeBytes, "rangeBytes");
  assert(expectedBytes > 0, "Calibration range must contain bytes");
  const tolerance = number(config.calibration.clientServerToleranceMs, "clientServerToleranceMs");
  const minimumTolerance = number(config.calibration.minimumDurationToleranceMs, "minimumDurationToleranceMs");
  const slowdown = number(config.calibration.bodyMaximumSlowdown, "bodyMaximumSlowdown");
  assert(slowdown >= 1, "Maximum slowdown must be at least one");
  const slack = number(config.calibration.bodySlackMs, "bodySlackMs");
  const used = new Set<any>();
  const paired = browserResults.map((browser, index) => {
    const candidates = browser.url === undefined ? [paced[index]]
      : paced.filter(request => requestTarget(request.url) === requestTarget(browser.url));
    assert(candidates.length === 1 && !used.has(candidates[0]),
      "Calibration URLs do not identify unique server requests");
    const server = candidates[0]; used.add(server);
    const startAt = number(browser.startAtMs, "browser.startAtMs");
    const headersAt = number(browser.headersAtMs, "browser.headersAtMs");
    const finishedAt = number(browser.finishedAtMs, "browser.finishedAtMs");
    assert(startAt <= headersAt && headersAt <= finishedAt, "Browser calibration timestamps are out of order");
    assert.equal(bytes(browser.bytes, "browser.bytes"), expectedBytes, "Browser calibration body length differs");
    assert.equal(server.bodyBytesPlanned, expectedBytes, "Server calibration range length differs");
    const serverBodyMs = server.endAtMs - server.headersAtMs;
    const browserBodyMs = finishedAt - headersAt;
    const disagreementMs = Math.abs(serverBodyMs - browserBodyMs);
    assert(disagreementMs <= tolerance + EPSILON_MS, "Client/server response body-duration disagreement exceeds tolerance");
    return { server, browser, summary: { url: server.url, bytes: browser.bytes,
      serverBodyMs, browserBodyMs, disagreementMs, browserHeaderDelayMs: headersAt - startAt } };
  });
  const serverStart = Math.min(...paired.map(pair => pair.server.headersAtMs));
  const serverEnd = Math.max(...paired.map(pair => pair.server.endAtMs));
  const browserStart = Math.min(...paired.map(pair => pair.browser.headersAtMs));
  const browserEnd = Math.max(...paired.map(pair => pair.browser.finishedAtMs));
  const serverBodyMs = serverEnd - serverStart;
  const browserBodyMs = browserEnd - browserStart;
  const nominalBodyMs = pacing.totalBodyBytes / PACING_PROFILE.bytesPerSecond * 1000;
  const minimumBodyMs = nominalBodyMs - minimumTolerance;
  const maximumBodyMs = nominalBodyMs * slowdown + slack;
  within(serverBodyMs, minimumBodyMs, maximumBodyMs, "Server aggregate body duration");
  within(browserBodyMs, minimumBodyMs, maximumBodyMs, "Browser aggregate body duration");
  assert(Math.abs(serverBodyMs - browserBodyMs) <= tolerance + EPSILON_MS,
    "Client/server aggregate body-duration disagreement exceeds tolerance");
  const serverOverlapMs = Math.min(...paired.map(pair => pair.server.endAtMs))
    - Math.max(...paired.map(pair => pair.server.headersAtMs));
  const browserOverlapMs = Math.min(...paired.map(pair => pair.browser.finishedAtMs))
    - Math.max(...paired.map(pair => pair.browser.headersAtMs));
  if (paired.length > 1) {
    assert(serverOverlapMs > EPSILON_MS && browserOverlapMs > EPSILON_MS,
      "Concurrent calibration responses did not overlap");
  }
  return { status: "passed", requestCount: paired.length, totalBodyBytes: pacing.totalBodyBytes,
    nominalBodyMs, minimumBodyMs, maximumBodyMs, serverBodyMs, browserBodyMs,
    disagreementMs: Math.abs(serverBodyMs - browserBodyMs),
    concurrentOverlapMs: paired.length > 1 ? { server: serverOverlapMs, browser: browserOverlapMs } : null,
    responses: paired.map(pair => pair.summary), pacing,
    interpretation: "Body spans use earliest headers through final body end in each clock domain. Content, status, and CDP identity checks are caller responsibilities.",
  };
}
