const test = require('node:test');
const assert = require('node:assert/strict');
const { createTracker } = require('../js/domain/history-taps.js');

function harness() {
  let now = 0, nextId = 0;
  const timers = new Map(), actions = [];
  const tracker = createTracker({
    now: () => now,
    setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { at: now + delay, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    onAction(action, context) { actions.push({ action, context }); },
  });
  function advance(ms) {
    const target = now + ms;
    while (true) {
      const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at; timers.delete(due[0]); due[1].fn();
    }
    now = target;
  }
  const point = (x = 0) => ({ x, y: 0 });
  function tap(context = 'page-a', reverse = false) {
    tracker.down(1, point(), context); advance(20);
    tracker.down(2, point(40), context); advance(40);
    const ids = reverse ? [2, 1] : [1, 2];
    for (const id of ids) tracker.up(id, point(id === 1 ? 0 : 40));
  }
  return { tracker, actions, advance, tap, point };
}

test('double tap waits 300ms; triple tap performs only redo', () => {
  for (const count of [2, 3]) {
    const h = harness();
    for (let i = 0; i < count; i++) { h.tap('a', i % 2 === 0); if (i < count - 1) h.advance(80); }
    if (count === 2) { h.advance(299); assert.deepEqual(h.actions, []); h.advance(1); }
    assert.deepEqual(h.actions, [{ action: count === 2 ? 'undo' : 'redo', context: 'a' }]);
    h.advance(1000); assert.equal(h.actions.length, 1);
  }
});

test('a third tap starting inside the gap suspends undo until it finishes', () => {
  const h = harness(); h.tap(); h.tap(); h.advance(280);
  h.tracker.down(1, h.point(), 'page-a'); h.advance(30);
  h.tracker.down(2, h.point(40), 'page-a'); h.advance(40);
  assert.deepEqual(h.actions, []);
  h.tracker.up(1, h.point()); h.tracker.up(2, h.point(40));
  assert.equal(h.actions[0].action, 'redo');
});

test('single taps and a lone finger never change history', () => {
  const h = harness(); h.tap(); h.advance(301); h.tap(); h.advance(301);
  h.tracker.down(1, h.point(), 'page-a'); h.tracker.up(1, h.point()); h.advance(500);
  assert.deepEqual(h.actions, []);
});

test('movement beyond 12px permanently rejects the sequence, including on release', () => {
  for (const onRelease of [false, true]) {
    const h = harness(); h.tap();
    h.tracker.down(1, h.point(), 'page-a'); h.tracker.down(2, h.point(40), 'page-a');
    assert.equal(h.tracker.isCandidate(), true);
    if (onRelease) h.tracker.up(1, h.point(13));
    else { h.tracker.move(1, h.point(13)); h.tracker.move(1, h.point()); }
    assert.equal(h.tracker.isCandidate(), false);
    h.tracker.up(1, h.point()); h.tracker.up(2, h.point(40));
    h.advance(500); assert.deepEqual(h.actions, []);
  }
});

test('long holds, late second contacts, third fingers, and cancellation discard pending history', () => {
  for (const reject of ['hold', 'late', 'third', 'cancel', 'reset']) {
    const h = harness(); h.tap(); h.tap();
    h.tracker.down(1, h.point(), 'page-a');
    if (reject === 'late') h.advance(121);
    h.tracker.down(2, h.point(40), 'page-a');
    if (reject === 'hold') h.advance(251);
    if (reject === 'third') h.tracker.down(3, h.point(80), 'page-a');
    if (reject === 'reset') h.tracker.cancel();
    h.tracker.up(1, h.point(), reject === 'cancel'); h.tracker.up(2, h.point(40)); h.tracker.up(3, h.point(80));
    h.advance(1000); assert.deepEqual(h.actions, [], reject);
  }
});

test('page objects isolate taps and explicit cancellation prevents delayed execution', () => {
  const h = harness(), a = { id: 'same' }, b = { id: 'same' };
  h.tap(a); h.tap(b); h.advance(301); assert.deepEqual(h.actions, []);
  h.tap(a); h.tap(a); h.tracker.cancel(); h.advance(301); assert.deepEqual(h.actions, []);
});

test('small jitter is accepted and configured contact join window is respected', () => {
  const h = harness(); h.tap();
  h.tracker.down(1, h.point(), 'page-a', 200); h.advance(150);
  h.tracker.down(2, h.point(40), 'page-a', 200);
  h.tracker.move(1, h.point(12)); h.tracker.up(2, h.point(45)); h.tracker.up(1, h.point(10));
  h.advance(300); assert.equal(h.actions[0].action, 'undo');
});
