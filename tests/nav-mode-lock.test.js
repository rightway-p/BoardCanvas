const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../js/board-2.0.1-ui.js"), "utf8");
const part = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function harness() {
  const context = {
    navModeLocked: false, panMode: false, tool: "strokeEraser", boardInteractionMode: "multi",
    penToolButton: { disabled: false }, eraserToolButton: { disabled: false },
    pixelEraserModeButton: { disabled: false }, strokeEraserModeButton: { disabled: false },
    pageModeToggleButton: { setAttribute() {}, classList: { toggle() {} } },
    navModeLockButton: { attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, classList: { toggle() {} } },
    finishActiveBoardInput() { this.finished = (this.finished || 0) + 1; },
    updateToolUI() {},
  };
  vm.createContext(context);
  vm.runInContext(part("function setPanMode", "function setBoardInteractionMode") + part("function setNavigationModeLock", "function setBoardInteractionMode"), context);
  return context;
}

test("navigation lock stays on across mode attempts and unlock always returns to pen", () => {
  const app = harness();
  app.setNavigationModeLock(true);
  assert.equal(app.panMode, true);
  assert.equal(app.navModeLockButton.attributes["aria-pressed"], "true");
  assert.equal(app.penToolButton.disabled, true);
  assert.equal(app.eraserToolButton.disabled, true);
  app.setPanMode(false);
  assert.equal(app.panMode, true);
  app.setNavigationModeLock(false);
  assert.equal(app.panMode, false);
  assert.equal(app.tool, "pen");
  assert.equal(app.navModeLockButton.attributes["aria-pressed"], "false");
  assert.equal(app.penToolButton.disabled, false);
});

test("automatic touch input is dispatched to the lock navigation gesture before ink handling", () => {
  const app = { boardInteractionMode: "multi", navModeLocked: true, touched: false };
  vm.createContext(app);
  vm.runInContext(part("function automaticTouchDown", "function automaticTouchMove"), app);
  app.automaticTouchDown({ get pointerType() { app.touched = true; } });
  assert.equal(app.touched, false);
});

test("lost navigation capture dispatches the owned pointer to cleanup and keeps the lock", () => {
  const handler = part("function handleLostPointerCapture", "function startAutomaticTouchNavigation");
  const calls = [];
  const app = { activePanPointerId: 17, navModeLocked: true, automaticTouchSession: null, endPanOrZoom(event) { calls.push(event.pointerId); this.activePanPointerId = null; } };
  vm.createContext(app);
  vm.runInContext(handler, app);
  app.handleLostPointerCapture({ pointerId: 16 });
  assert.equal(app.activePanPointerId, 17);
  app.handleLostPointerCapture({ pointerId: 17 });
  assert.deepEqual(calls, [17]);
  assert.equal(app.navModeLocked, true);
});
