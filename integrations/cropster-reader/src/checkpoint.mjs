// Overall time records checkpoint publication/finalisation. Every source section
// keeps its own actual observation time, including the first weekly capture.
export function cloneCheckpoint(observation, now = () => new Date()) {
  const result = structuredClone(observation);
  result.observedAt = now().toISOString();
  return result;
}

export async function emitCheckpoint(observation, onCapture, now = () => new Date()) {
  const snapshot = cloneCheckpoint(observation, now);
  if (typeof onCapture === "function") await onCapture(snapshot);
  return snapshot;
}
