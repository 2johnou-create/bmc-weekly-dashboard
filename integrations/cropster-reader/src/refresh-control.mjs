// One coalesced explicit POST request. Polling never changes this state.
export function createRefreshControl() {
  let pending = false, accepting = true;
  return {
    request() { if (!accepting) return false; pending = true; return true; },
    take() { const requested = pending; pending = false; return requested; },
    hasPending: () => pending,
    isAccepting: () => accepting,
    sealIfIdle() { if (pending) return false; accepting = false; return true; },
    close() { accepting = false; },
  };
}
