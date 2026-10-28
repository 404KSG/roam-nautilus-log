/** Normalized native-style horizontal gestures. No DOM, graph or editor APIs. */
function deskWheelDelta(event, { line = 16, page = 600 } = {}) {
  const scale = event.deltaMode === 1 ? line : event.deltaMode === 2 ? page : 1;
  const finite = value => Number.isFinite(value) ? value : 0;
  let x = finite(event.deltaX) * scale;
  let y = finite(event.deltaY) * scale;
  // Some mice keep Shift-wheel on deltaY; others already translate it to X.
  // Never apply the conversion twice or reinterpret an ordinary vertical wheel.
  if (event.shiftKey && x === 0) { x = y; y = 0; }
  return { x, y };
}

function createDeskWheel({ step, progress = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let dx = 0, dy = 0, last = -Infinity, locked = null, direction = 0;
  let momentumSeen = false, shifted = null, timer = null, timerGeneration = 0, destroyed = false;
  const clearIdle = () => { timerGeneration += 1; if (timer !== null) clearTimer(timer); timer = null; };
  const reset = () => {
    clearIdle(); dx = dy = 0; last = -Infinity; locked = null; direction = 0;
    momentumSeen = false; shifted = null; progress(null);
  };
  const handle = (event, metrics) => {
    if (destroyed) return false;
    if (event.ctrlKey || event.metaKey || event.defaultPrevented || event.isComposing) { reset(); return false; }
    const { x, y } = deskWheelDelta(event, metrics);
    const momentum = typeof event.momentum === 'boolean' ? event.momentum : event.nativeEvent?.momentum;
    const hasMomentum = typeof momentum === 'boolean';
    const idle = hasMomentum ? 100 : 300;
    const horizontal = Math.abs(x) > Math.abs(y);
    if (momentum === true) {
      momentumSeen = true;
      clearIdle();
      if (!locked) progress(null);
      return horizontal;
    }
    if (!x && !y) return false;
    const stamp = Number.isFinite(event.timeStamp) ? event.timeStamp : 0;
    const shift = Boolean(event.shiftKey);
    const reversal = locked && direction && x && Math.sign(x) !== direction && Math.abs(x) >= 10;
    if (stamp - last > idle || hasMomentum && momentumSeen || reversal || shifted !== null && shifted !== shift) reset();
    last = stamp; shifted = shift; momentumSeen = false;
    if (locked) return locked === 'horizontal' && horizontal;
    dx += x; dy += y;
    if (Math.abs(dx) >= 70 && Math.abs(dx) > Math.abs(dy)) {
      clearIdle(); locked = 'horizontal'; direction = Math.sign(dx);
      // The view clears old motion when selection changes. Do not issue a
      // delayed reset against the newly mounted editor after a successful step.
      if (step(dx > 0 ? -1 : 1) === false) progress(null);
      return true;
    }
    if (Math.abs(dy) >= 70 && Math.abs(dy) > 2 * Math.abs(dx)) {
      clearIdle(); locked = 'vertical'; progress(null); return false;
    }
    if (Math.abs(dx) > Math.abs(dy)) progress(dx);
    else progress(null);
    clearIdle();
    const generation = timerGeneration;
    timer = setTimer(() => {
      if (destroyed || generation !== timerGeneration) return;
      timer = null; progress(null);
    }, idle + 20);
    return horizontal;
  };
  return { handle, reset, destroy() { reset(); destroyed = true; } };
}

module.exports = { deskWheelDelta, createDeskWheel };
