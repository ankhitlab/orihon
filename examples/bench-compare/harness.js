export function yieldToBrowser() {
  return globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise(resolve => setTimeout(resolve, 0));
}

/** Cooperative adapter work; pauses are intentionally included in wall-clock load time. */
export async function mapInChunks(values, convert, { signal, progress = () => {}, chunkSize = 2000,
  yieldTask = yieldToBrowser } = {}) {
  const result = new Array(values.length);
  for (let start = 0; start < values.length; start += chunkSize) {
    signal?.throwIfAborted();
    const end = Math.min(values.length, start + chunkSize);
    for (let i = start; i < end; i++) result[i] = convert(values[i], i);
    progress(end, values.length);
    if (end < values.length) await yieldTask();
  }
  signal?.throwIfAborted();
  return result;
}

/** No elapsed-time failure: users may cancel a slow but valid native operation. */
export function waitForEvent(target, event, { signal, ready = () => true, start = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const off = (type, handler) => target.un ? target.un(type, handler) : target.off(type, handler);
    const cleanup = () => { off(event, finish); signal?.removeEventListener('abort', abort); };
    const finish = () => { if (ready()) { cleanup(); resolve(); } };
    const abort = () => { cleanup(); reject(signal.reason); };
    if (signal?.aborted) { reject(signal.reason); return; }
    target.on(event, finish);
    signal?.addEventListener('abort', abort, { once: true });
    try { start(); } catch (error) { cleanup(); reject(error); }
  });
}

export function summarizeResources(entries) {
  // Keep repeated requests: transfer is traffic, not unique installed package size.
  const available = entries.filter(entry => entry.decodedBodySize > 0 || entry.encodedBodySize > 0);
  return {
    requests: entries.length,
    knownRequests: available.length,
    transferBytes: available.reduce((sum, entry) => sum + entry.transferSize, 0),
    encodedBytes: available.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
    decodedBytes: available.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
    complete: entries.length > 0 && available.length === entries.length,
  };
}

export function rotatedOrder(ids, repetition) {
  if (!ids.length) return [];
  const offset = repetition % ids.length;
  return [...ids.slice(offset), ...ids.slice(0, offset)];
}
