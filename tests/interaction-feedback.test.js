const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../js/interaction-feedback.js');

function element() {
  const listeners = new Map(), classes = new Set();
  return {
    children: [], style: {}, hidden: false, textContent: '', attributes: {}, className: '',
    append(...children) { this.children.push(...children); },
    setAttribute(key, value) { this.attributes[key] = value; },
    classList: { toggle(key, on) { if (on) classes.add(key); else classes.delete(key); }, contains: key => classes.has(key) },
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); },
    emit(name, values = {}) { for (const fn of listeners.get(name) || []) fn({ type: name, isPrimary: true, pointerId: 1, pointerType: 'mouse', clientX: 180, clientY: 140, ...values }); },
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 600 }),
  };
}
function harness() {
  const root = element(), canvas = element(), window = element(), document = element();
  let clock = 0, next = 0;
  const timers = new Map();
  window.setTimeout = (fn, ms) => { const id = ++next; timers.set(id, { fn, at: clock + ms }); return id; };
  window.clearTimeout = id => timers.delete(id);
  document.createElement = () => element();
  const state = { tool: 'pen', panMode: false, passthrough: false, worldDiameter: 28, scale: 1, pixelRatio: 2, ownerId: null };
  const feedback = create({ root, canvas, document, window, getState: () => state });
  const find = name => root.children.find(el => el.className === name);
  function advance(ms) { clock += ms; for (const [id, t] of timers) if (t.at <= clock) { timers.delete(id); t.fn(); } }
  return { feedback, root, canvas, document, window, state, advance, find };
}

test('notifications replace each other and renew their timeout without intercepting input', () => {
  const h = harness(), toast = h.find('board-action-feedback');
  assert.equal(toast.hidden, true);
  assert.equal(toast.attributes.role, 'status');
  h.feedback.notify('실행 취소'); h.advance(1000);
  h.feedback.notify('다시 실행'); h.advance(500);
  assert.equal(toast.hidden, false); assert.equal(toast.textContent, '다시 실행');
  h.advance(1000); assert.equal(toast.hidden, true);
});

test('initial state is silent and tool notifications only occur on actual mode transitions', () => {
  const h = harness(), toast = h.find('board-action-feedback');
  h.feedback.refresh(); assert.equal(toast.hidden, true);
  h.state.tool = 'eraser'; h.feedback.refresh(); assert.equal(toast.textContent, '지우개');
  h.advance(1500); h.feedback.refresh(); assert.equal(toast.hidden, true);
  h.state.tool = 'strokeEraser'; h.feedback.refresh(); assert.equal(toast.textContent, '획 지우개');
});

test('eraser preview matches world diameter through zoom and DPR at the actual pointer center', () => {
  for (const scale of [0.5, 1, 3]) for (const pixelRatio of [1, 2]) {
    const h = harness(); Object.assign(h.state, { tool: 'eraser', worldDiameter: 14 * pixelRatio, scale, pixelRatio });
    h.canvas.emit('pointermove');
    const cursor = h.find('board-eraser-preview');
    assert.equal(cursor.hidden, false);
    assert.equal(cursor.style.width, `${14 * scale}px`); assert.equal(cursor.style.height, `${14 * scale}px`);
    assert.equal(cursor.style.left, '80px'); assert.equal(cursor.style.top, '90px');
    assert.equal(h.canvas.classList.contains('has-eraser-preview'), true);
    h.state.worldDiameter *= 2; h.feedback.refresh(); assert.equal(cursor.style.width, `${28 * scale}px`);
  }
});

test('touch preview has an above-finger label, ignores secondary contacts, and hides on release', () => {
  const h = harness(); h.state.tool = 'strokeEraser'; h.state.ownerId = 1;
  h.canvas.emit('pointerdown', { pointerType: 'touch' });
  const cursor = h.find('board-eraser-preview'), label = h.find('board-eraser-label');
  assert.equal(cursor.hidden, false); assert.equal(label.hidden, false);
  assert.equal(cursor.attributes['data-kind'], 'strokeEraser');
  h.canvas.emit('pointermove', { pointerId: 2, isPrimary: false, pointerType: 'touch', clientX: 400 });
  assert.equal(cursor.style.left, '80px');
  h.canvas.emit('pointerup', { pointerId: 2, isPrimary: false, pointerType: 'touch' }); assert.equal(cursor.hidden, false);
  h.canvas.emit('pointerup', { pointerType: 'touch' }); assert.equal(cursor.hidden, true); assert.equal(label.hidden, true);
});

test('leaving, cancellation, capture loss and blur remove the preview until fresh pointer input', () => {
  for (const event of ['pointerleave', 'pointercancel', 'lostpointercapture', 'blur']) {
    const h = harness(); h.state.tool = 'eraser'; h.canvas.emit('pointermove');
    (event === 'blur' ? h.window : h.canvas).emit(event);
    h.feedback.refresh(); assert.equal(h.find('board-eraser-preview').hidden, true, event);
  }
});

test('pan, passthrough and out-of-bounds points never display an eraser preview', () => {
  for (const state of [{ panMode: true }, { passthrough: true }, { tool: 'pen' }]) {
    const h = harness(); Object.assign(h.state, { tool: 'eraser', ...state });
    h.canvas.emit('pointermove'); assert.equal(h.find('board-eraser-preview').hidden, true);
  }
  const h = harness(); h.state.tool = 'eraser'; h.canvas.emit('pointermove', { clientX: 99 });
  assert.equal(h.find('board-eraser-preview').hidden, true);
});
