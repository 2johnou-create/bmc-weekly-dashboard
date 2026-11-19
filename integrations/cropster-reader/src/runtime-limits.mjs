export function createLimiter(maximum) {
  let active = 0, stopped = null;
  const waiting = [];
  const acquire = () => {
    if (stopped) return Promise.reject(stopped);
    if (active < maximum) { active++; return Promise.resolve(); }
    return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
  };
  const release = () => {
    const next = waiting.shift();
    if (next) next.resolve(); // Transfer the reserved slot directly to this waiter.
    else active--;
  };
  const limit = async run => {
    await acquire();
    try { if (stopped) throw stopped; return await run(); }
    finally { release(); }
  };
  limit.cancel = error => {
    if (stopped) return;
    stopped = error;
    for (const waiter of waiting.splice(0)) waiter.reject(error);
  };
  return limit;
}

// Cleanup must not hold an entire capture or semaphore slot indefinitely. Any
// settled close (including an already-closed target error) finishes cleanup.
export async function settlesWithin(run, milliseconds) {
  let timer;
  const done = Promise.resolve().then(run).then(() => true, () => true);
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(false), milliseconds); });
  try { return await Promise.race([done, timeout]); }
  finally { clearTimeout(timer); }
}
