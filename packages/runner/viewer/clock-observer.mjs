// Known-event fixture only. No PDF loading, rendering, or background transfer.
let state = "ready";
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function input({ url, gapMs }) {
  if (typeof url !== "string" || !url || gapMs !== 30) throw new Error("Invalid fixed probe input");
}
async function fetchRange(url, first, last) {
  const startAtMs = performance.now();
  const response = await fetch(url, { headers: { Range: `bytes=${first}-${last}` } });
  const headersAtMs = performance.now();
  const body = new Uint8Array(await response.arrayBuffer());
  const completedAtMs = performance.now();
  const contentRange = response.headers.get("Content-Range");
  const contentLength = response.headers.get("Content-Length");
  const contentEncoding = response.headers.get("Content-Encoding") ?? "identity";
  if (response.status !== 206 || contentRange !== `bytes ${first}-${last}/49152`
    || contentLength !== "4096" || contentEncoding !== "identity" || body.length !== 4096
    || !body.every((value, index) => value === ((Math.floor((first + index) / 4) >>> (8 * ((first + index) % 4))) & 255))) {
    throw new Error("Known range transfer returned unexpected bytes or headers");
  }
  return { url, startAtMs, headersAtMs, completedAtMs, bytes: body.length, status: response.status,
    contentRange, contentLength, contentEncoding, payloadPatternVerified: true };
}
window.clockProbeBefore = async options => {
  if (state !== "ready") throw new Error("Before probe may run only once");
  input(options); state = "before-running";
  try {
    const first = await fetchRange(options.url, 0, 4095);
    await wait(options.gapMs);
    const markerMs = performance.now();
    state = "marker-returned";
    return { first, markerMs, timeOriginMs: performance.timeOrigin };
  } catch (error) { state = "failed"; throw error; }
};
window.clockProbeAfter = async options => {
  if (state !== "marker-returned") throw new Error("After probe requires a completed before probe and may run only once");
  input(options); state = "after-running";
  try {
    await wait(options.gapMs);
    const second = await fetchRange(options.url, 4096, 8191);
    state = "done";
    return { second, timeOriginMs: performance.timeOrigin };
  } catch (error) { state = "failed"; throw error; }
};
