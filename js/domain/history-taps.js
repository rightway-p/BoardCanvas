(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BoardHistoryTaps = api;
})(typeof globalThis === "object" ? globalThis : window, function () {
  "use strict";

  function createTracker({ now, setTimeout, clearTimeout, onAction }) {
    const gapMs = 300, tapMs = 250, movementPx = 12;
    let attempt = null, count = 0, context = null, lastEnd = 0, timer = null;

    function clearTimer() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    }
    function resetSequence() {
      clearTimer();
      count = 0;
      context = null;
    }
    function cancel() {
      resetSequence();
      attempt = null;
    }
    function reject() {
      resetSequence();
      if (attempt) attempt.valid = false;
    }
    function down(id, point, page, joinWindowMs = 120, eventTimestamp) {
      if (!attempt) {
        if (page !== context || now() - lastEnd > gapMs) resetSequence();
        clearTimer();
        context = page;
        attempt = { started: now(), eventTimestamp, context: page, joinWindowMs, contacts: new Map(), total: 0, valid: true };
        timer = setTimeout(reject, tapMs);
      }
      const elapsed = Number.isFinite(attempt.eventTimestamp) && Number.isFinite(eventTimestamp)
        ? eventTimestamp - attempt.eventTimestamp : now() - attempt.started;
      if (attempt.total >= 2 || attempt.contacts.has(id) || page !== attempt.context || elapsed < 0 || elapsed > attempt.joinWindowMs) reject();
      attempt.total += 1;
      attempt.contacts.set(id, { ...point });
    }
    function move(id, point) {
      const origin = attempt?.contacts.get(id);
      if (origin && (!Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.hypot(point.x - origin.x, point.y - origin.y) > movementPx)) reject();
    }
    function up(id, point, cancelled = false, eventTimestamp) {
      if (!attempt?.contacts.has(id)) return;
      move(id, point);
      if (cancelled) reject();
      attempt.contacts.delete(id);
      if (attempt.contacts.size) return;
      const elapsed = Number.isFinite(attempt.eventTimestamp) && Number.isFinite(eventTimestamp)
        ? eventTimestamp - attempt.eventTimestamp : now() - attempt.started;
      const valid = attempt.valid && attempt.total === 2 && elapsed >= 0 && elapsed < tapMs;
      attempt = null;
      clearTimer();
      if (!valid) { resetSequence(); return; }
      count += 1;
      lastEnd = now();
      if (count === 3) {
        const page = context;
        resetSequence();
        onAction("redo", page);
      } else {
        timer = setTimeout(() => {
          const page = context, action = count === 2 ? "undo" : null;
          resetSequence();
          if (action) onAction(action, page);
        }, gapMs);
      }
    }
    return { down, move, up, cancel, reject, isCandidate: () => Boolean(attempt?.valid) };
  }

  return { createTracker };
});
