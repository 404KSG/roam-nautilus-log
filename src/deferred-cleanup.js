/** Bulk hidden-UI retirement must not occupy the first visible fold frame. */
export function createDeferredCleanup(host) {
  const queue = [];
  let head = 0, frame = null, timer = null, fallback = null, scheduled = false, closed = false;
  const now = () => host.performance?.now?.() ?? Date.now();
  const cancel = () => {
    if (frame !== null) host.cancelAnimationFrame(frame);
    if (timer !== null) host.clearTimeout(timer);
    if (fallback !== null) host.clearTimeout(fallback);
    frame = timer = fallback = null;
  };
  const take = () => {
    const job = queue[head]; queue[head++] = null;
    try { job.resolve(job.work()); } catch (error) { job.reject(error); }
  };
  const drain = () => {
    timer = null;
    const started = now();
    do { take(); }
    while (head < queue.length && now() - started < 4 && !host.navigator?.scheduling?.isInputPending?.());
    if (head < queue.length) timer = host.setTimeout(drain, 0);
    else { queue.length = 0; head = 0; scheduled = false; }
  };
  const start = () => {
    cancel();
    if (!closed && head < queue.length) drain();
  };
  return {
    run(work) {
      if (closed) return Promise.resolve().then(work);
      const result = new Promise((resolve, reject) => queue.push({ work, resolve, reject }));
      if (!scheduled) {
        scheduled = true;
        // Two frames leave a paint opportunity before cleanup. The timeout
        // also retires watches if the page becomes hidden and RAF is suspended.
        fallback = host.setTimeout(start, 100);
        frame = host.requestAnimationFrame(() => {
          frame = host.requestAnimationFrame(() => { frame = null; timer = host.setTimeout(start, 0); });
        });
      }
      return result;
    },
    destroy() {
      closed = true; cancel();
      while (head < queue.length) take();
      queue.length = 0; head = 0; scheduled = false;
    },
  };
}
