const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../js/board-2.0.1-ui.js"), "utf8");
const part = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function harness(overrides = {}) {
  let finishCount = 0;
  const context = {
    navModeLocked: false, panMode: false, tool: "strokeEraser", boardInteractionMode: "multi",
    penToolButton: { disabled: false }, eraserToolButton: { disabled: false },
    pixelEraserModeButton: { disabled: false }, strokeEraserModeButton: { disabled: false },
    pageModeToggleButton: { attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, classList: { toggle() {} } },
    navModeLockButton: { attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, classList: { toggle() {} } },
    finishActiveBoardInput() { finishCount += 1; },
    get finishCount() { return finishCount; },
    updateToolUI() {},
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(part("function setPanMode", "function setBoardInteractionMode") + part("function setNavigationModeLock", "function setBoardInteractionMode"), context);
  return context;
}

test("navigation lock blocks pan mode but keeps drawing tools available", () => {
  const app = harness();
  app.setNavigationModeLock(true);
  assert.equal(app.navModeLocked, true);
  assert.equal(app.panMode, false);
  assert.equal(app.tool, "strokeEraser");
  assert.equal(app.navModeLockButton.attributes["aria-pressed"], "true");
  assert.equal(app.navModeLockButton.attributes["aria-label"], "줌·패닝 잠금 해제");
  assert.equal(app.penToolButton.disabled, false);
  assert.equal(app.eraserToolButton.disabled, false);
  assert.equal(app.pixelEraserModeButton.disabled, false);
  assert.equal(app.strokeEraserModeButton.disabled, false);

  app.setPanMode(true);
  assert.equal(app.panMode, false);
  app.setNavigationModeLock(false);
  assert.equal(app.navModeLocked, false);
  assert.equal(app.panMode, false);
  assert.equal(app.tool, "pen");
  assert.equal(app.navModeLockButton.attributes["aria-pressed"], "false");
  assert.equal(app.navModeLockButton.attributes["aria-label"], "줌·패닝 잠금");
});

test("locking finishes the active navigation gesture before disabling navigation", () => {
  let cameraApplications = 0;
  const app = harness({ panMode: true, gestureActive: true, boardCamera: { x: 24, y: -8, scale: 1.4 }, applyBoardCamera() { cameraApplications += 1; } });
  app.setNavigationModeLock(true);
  assert.equal(app.finishCount >= 1, true);
  assert.deepEqual(app.boardCamera, { x: 24, y: -8, scale: 1.4 });
  assert.equal(cameraApplications, 0);
  assert.equal(app.panMode, false);
  assert.equal(app.navModeLocked, true);
});

test("automatic touch input is not claimed by navigation while the lock is on", () => {
  const app = { boardInteractionMode: "multi", navModeLocked: true, touched: false };
  vm.createContext(app);
  vm.runInContext(part("function automaticTouchDown", "function automaticTouchMove"), app);
  app.automaticTouchDown({ get pointerType() { app.touched = true; } });
  assert.equal(app.touched, false);
});

test("lost navigation capture dispatches its owned pointer to cleanup", () => {
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
