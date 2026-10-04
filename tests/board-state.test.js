const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const boardState = require("../js/domain/board-state.js");

test("pan fit button tracks pan mode and fits PDF to the available board viewport", () => {
  const source = fs.readFileSync(require.resolve("../js/board-2.0.1-ui.js"), "utf8");
  const fitSource = source.slice(source.indexOf("function boardPageFitCamera"), source.indexOf("function boardWorkSnapshot"));
  const positionSource = source.slice(source.indexOf("function updatePanFitButton"), source.indexOf("function setPanMode"));
  const button = { hidden: true, style: {} };
  let finished = false, applied = false;
  const context = {
    panMode: false, overlayMousePassthrough: false,
    toolbarLayout: { placement: "right" },
    toolbar: { getBoundingClientRect: () => ({ left: 120, right: 148, top: 20, bottom: 300, width: 28, height: 280 }) },
    panFitButton: button,
    pageModeToggleButton: { getBoundingClientRect: () => ({ left: 90, right: 118, top: 40, bottom: 68, width: 28, height: 28 }) },
    window: { innerWidth: 500, innerHeight: 400 },
    boardWrapper: { getBoundingClientRect: () => ({ width: 300, height: 200 }) },
    currentBoardPage: () => ({ kind: "pdf", pdfContentBounds: { x: 0, y: 0, width: 600, height: 400 } }),
    pixelRatio: 1, boardCamera: {},
    finishActiveBoardInput() { finished = true; },
    saveBoardPageView() {}, applyBoardCamera() { applied = true; }, scheduleSessionAutosave() {},
  };
  vm.createContext(context);
  vm.runInContext(`${fitSource}\n${positionSource}`, context);
  context.updatePanFitButton();
  assert.equal(button.hidden, true);
  context.panMode = true;
  context.updatePanFitButton();
  assert.equal(button.hidden, false);
  assert.equal(button.style.left, "88px");
  assert.equal(button.style.top, "40px");
  context.fitCurrentBoardPage();
  assert.equal(finished, true);
  assert.equal(context.boardCamera.scale, 0.5);
  assert.equal(context.boardCamera.x, 0);
  assert.equal(context.boardCamera.y, 0);
  assert.equal(applied, true);
  context.currentBoardPage = () => ({ kind: "blank" });
  context.fitCurrentBoardPage();
  assert.deepEqual({ ...context.boardCamera }, { x: 0, y: 0, scale: 1 });
  assert.equal(button.hidden, false);
  context.overlayMousePassthrough = true;
  context.updatePanFitButton();
  assert.equal(button.hidden, true);
});

test("PDF fit follows rendered page bounds through portrait and landscape resizes, preserving manual views and ink", () => {
  const source = fs.readFileSync(require.resolve("../js/board-2.0.1-ui.js"), "utf8");
  const fitSource = source.slice(source.indexOf("function boardPageFitCamera"), source.indexOf("function boardWorkSnapshot"));
  let viewport = { width: 640, height: 720 };
  const ink = [{ color: "#123456", points: [{ x: 31, y: 47 }] }];
  const page = { kind: "pdf", pdfContentBounds: { x: 300, y: 100, width: 600, height: 1000 }, strokes: structuredClone(ink) };
  const context = {
    boardPageSequence: [page], boardPageIndex: 0, pixelRatio: 2, boardCamera: { x: 0, y: 0, scale: 1 },
    currentBoardPage: () => page,
    boardWrapper: { getBoundingClientRect: () => viewport },
    finishActiveBoardInput() {}, saveBoardPageView() {}, applyBoardCamera() {}, scheduleSessionAutosave() {}
  };
  vm.createContext(context);
  vm.runInContext(fitSource, context);

  for (const size of [{ width: 400, height: 500 }, { width: 800, height: 600 }, { width: 400, height: 500 }]) {
    const oldViewport = { ...viewport };
    assert.equal(context.fitCurrentBoardPage(), true);
    const cameraBeforeResize = { ...context.boardCamera };
    assert.equal(context.isCurrentBoardPageFitted(oldViewport, 2), true);
    viewport = size;
    assert.equal(context.refitBoardPageAfterViewportResize(oldViewport, 2), true);
    const bounds = page.pdfContentBounds;
    const left = bounds.x / 2 * context.boardCamera.scale + context.boardCamera.x;
    const top = bounds.y / 2 * context.boardCamera.scale + context.boardCamera.y;
    const width = bounds.width / 2 * context.boardCamera.scale;
    const height = bounds.height / 2 * context.boardCamera.scale;
    assert.ok(left >= -0.01 && top >= -0.01);
    assert.ok(left + width <= viewport.width + 0.01 && top + height <= viewport.height + 0.01);
    assert.notDeepEqual(context.boardCamera, cameraBeforeResize);
    assert.deepEqual(page.strokes, ink);
  }

  const oldViewport = { ...viewport };
  context.boardCamera = { x: 17, y: 29, scale: 1.35 };
  const manualCamera = { ...context.boardCamera };
  viewport = { width: 500, height: 700 };
  assert.equal(context.refitBoardPageAfterViewportResize(oldViewport, 2), false);
  assert.deepEqual(context.boardCamera, manualCamera);
  assert.deepEqual(page.strokes, ink);

  for (const bounds of [{ x: 100, y: 50, width: 1200, height: 800 }, { x: 40, y: 80, width: 700, height: 1200 }]) {
    page.pdfContentBounds = bounds;
    for (const size of [{ width: 400, height: 500 }, { width: 800, height: 600 }, { width: 400, height: 500 }]) {
      const before = { ...viewport };
      context.fitCurrentBoardPage();
      viewport = size;
      assert.equal(context.refitBoardPageAfterViewportResize(before, 2), true);
      const left = bounds.x / 2 * context.boardCamera.scale + context.boardCamera.x;
      const top = bounds.y / 2 * context.boardCamera.scale + context.boardCamera.y;
      const width = bounds.width / 2 * context.boardCamera.scale;
      const height = bounds.height / 2 * context.boardCamera.scale;
      assert.ok(left >= -0.01 && top >= -0.01);
      assert.ok(left + width <= viewport.width + 0.01 && top + height <= viewport.height + 0.01);
      assert.deepEqual(page.strokes, ink);
    }
  }
});

test("PDF minimum zoom follows fit after viewport changes and keeps the center world point", () => {
  const source = fs.readFileSync(require.resolve("../js/board-2.0.1-ui.js"), "utf8");
  const fitSource = source.slice(source.indexOf("function boardPageFitCamera"), source.indexOf("function boardWorkSnapshot"));
  let viewport = { width: 400, height: 600 };
  const page = { kind: "pdf", pdfContentBounds: { x: 100, y: 50, width: 800, height: 1000 } };
  let saves = 0, applies = 0;
  const context = {
    pixelRatio: 1, boardCamera: { x: 13, y: -27, scale: 0.35 }, currentBoardPage: () => page,
    boardWrapper: { getBoundingClientRect: () => viewport }, BoardState: boardState,
    saveBoardPageView() { saves += 1; }, applyBoardCamera() { applies += 1; }, scheduleSessionAutosave() {}
  };
  vm.createContext(context);
  vm.runInContext(fitSource, context);
  const anchor = { x: 200, y: 300 };
  const worldAtAnchor = boardState.pointToWorld(anchor, context.boardCamera);
  const initialMin = context.minimumBoardZoomScale();
  const zoomed = context.zoomBoardCameraAt(context.boardCamera, anchor, initialMin / 0.35, initialMin);
  assert.equal(zoomed.scale, initialMin);
  assert.deepEqual(boardState.pointToWorld(anchor, zoomed), worldAtAnchor);
  assert.equal(context.enforcePdfZoomMinimum(), true);
  assert.equal(context.boardCamera.scale, initialMin);
  assert.equal(saves, 1);
  assert.equal(applies, 1);

  viewport = { width: 900, height: 1200 };
  const resizedCenter = { x: viewport.width / 2, y: viewport.height / 2 };
  const worldBeforeClamp = boardState.pointToWorld(resizedCenter, context.boardCamera);
  const resizedMin = context.minimumBoardZoomScale();
  assert.ok(resizedMin > initialMin);
  assert.equal(context.enforcePdfZoomMinimum(), true);
  assert.equal(context.boardCamera.scale, resizedMin);
  assert.deepEqual(boardState.pointToWorld(resizedCenter, context.boardCamera), worldBeforeClamp);

  context.boardCamera.scale = resizedMin + 0.3;
  const manual = { ...context.boardCamera };
  assert.equal(context.enforcePdfZoomMinimum(), false);
  assert.equal(context.boardCamera.x, manual.x);
  assert.equal(context.boardCamera.y, manual.y);
  assert.equal(context.boardCamera.scale, manual.scale);
  context.currentBoardPage = () => ({ kind: "blank" });
  assert.equal(context.minimumBoardZoomScale(), 0.2);
  assert.equal(context.zoomBoardCameraAt({ x: 0, y: 0, scale: 0.5 }, anchor, 0.01).scale, 0.2);
});

test("PDF fit remains the exact minimum below 0.2 while the opt-in floor allows zooming below fit", () => {
  const source = fs.readFileSync(require.resolve("../js/board-2.0.1-ui.js"), "utf8");
  const fitSource = source.slice(source.indexOf("function boardPageFitCamera"), source.indexOf("function boardWorkSnapshot"));
  const storage = new Map();
  const context = {
    pixelRatio: 1, PDF_ZOOM_SETTING_KEY: "board.settings.allowPdfZoomBelowFit.v1",
    window: { localStorage: { getItem: (key) => storage.get(key) || null } },
    currentBoardPage: () => ({ kind: "pdf", pdfContentBounds: { x: 0, y: 0, width: 1600, height: 2000 } }),
    boardWrapper: { getBoundingClientRect: () => ({ width: 240, height: 300 }) },
    boardCamera: { x: 0, y: 0, scale: 0.1 }, BoardState: boardState,
    saveBoardPageView() {}, applyBoardCamera() {}, scheduleSessionAutosave() {}
  };
  vm.createContext(context);
  vm.runInContext(fitSource, context);
  assert.equal(context.minimumBoardZoomScale(), 0.15);
  assert.equal(context.enforcePdfZoomMinimum(), true);
  assert.equal(context.boardCamera.scale, 0.15);

  storage.set("board.settings.allowPdfZoomBelowFit.v1", "true");
  assert.equal(context.minimumBoardZoomScale(), 0.03);
  context.boardCamera.scale = 0.01;
  assert.equal(context.enforcePdfZoomMinimum(), true);
  assert.equal(context.boardCamera.scale, 0.03);
});

test("below-fit zoom preference defaults off, persists on the device, and clamps when disabled", () => {
  const source = fs.readFileSync(require.resolve("../js/board-2.0.1-ui.js"), "utf8");
  const preferences = source.slice(source.indexOf("function isPdfZoomBelowFitAllowed"), source.indexOf("function minimumBoardZoomScale"));
  const storage = new Map();
  let didClamp = false;
  const createContext = () => {
    const context = { window: { localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) } },
      enforcePdfZoomMinimum() { didClamp = true; } };
    vm.createContext(context);
    vm.runInContext(`const PDF_ZOOM_SETTING_KEY = "board.settings.allowPdfZoomBelowFit.v1"; ${preferences}`, context);
    return context;
  };
  const first = createContext();
  assert.equal(first.isPdfZoomBelowFitAllowed(), false);
  first.setPdfZoomBelowFitAllowed(true);
  assert.equal(storage.get("board.settings.allowPdfZoomBelowFit.v1"), "true");
  assert.equal(createContext().isPdfZoomBelowFitAllowed(), true);
  const restored = createContext();
  restored.setPdfZoomBelowFitAllowed(false);
  assert.equal(restored.isPdfZoomBelowFitAllowed(), false);
  assert.equal(didClamp, true);
});

test("settings Tab trap redirects escaped focus and omits hidden category controls", () => {
  const source = fs.readFileSync(require.resolve("../js/events-init.js"), "utf8");
  const start = source.indexOf('document.addEventListener("keydown", (event) => {');
  const end = source.indexOf("setupRuntimeErrorLogging();", start);
  const hiddenControl = { hidden: false, closest: () => ({}), getAttribute: () => null, getClientRects: () => [{ }], focus() { this.focused = true; } };
  const first = { hidden: false, closest: () => null, getAttribute: () => null, getClientRects: () => [{}], focus() { this.focused = true; } };
  const last = { hidden: false, closest: () => null, getAttribute: () => null, getClientRects: () => [{}], focus() { this.focused = true; } };
  let keydown;
  const context = {
    document: { activeElement: {}, addEventListener(_name, handler) { keydown = handler; }, getElementById: () => null },
    documentPopup: { querySelectorAll: () => [hiddenControl, first, last] },
    closeSettingsButton: { focus() {} },
    isDocumentPopupOpen: () => true,
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const pressTab = (shiftKey) => ({ key: "Tab", shiftKey, preventDefault() { this.prevented = true; } });
  const forward = pressTab(false);
  keydown(forward);
  assert.equal(forward.prevented, true);
  assert.equal(first.focused, true);
  assert.equal(hiddenControl.focused, undefined);
  context.document.activeElement = {};
  const backward = pressTab(true);
  keydown(backward);
  assert.equal(backward.prevented, true);
  assert.equal(last.focused, true);
});

test("setCanvasSize raises a restored below-fit PDF view to the current floor and preserves its center point", () => {
  const uiSource = fs.readFileSync(require.resolve("../js/board-2.0.1-ui.js"), "utf8");
  const fitSource = uiSource.slice(uiSource.indexOf("function boardPageFitCamera"), uiSource.indexOf("function boardWorkSnapshot"));
  const renderSource = fs.readFileSync(require.resolve("../js/render-doc-draw.js"), "utf8");
  const sizeSource = renderSource.slice(renderSource.indexOf("function setCanvasSize()"), renderSource.indexOf("function getCanvasPoint"));
  const page = { kind: "pdf", pdfContentBounds: { x: 100, y: 50, width: 800, height: 1000 } };
  let viewport = { width: 400, height: 600 };
  const context = {
    boardPageSequence: [page], boardPageIndex: 0, currentBoardPage: () => page,
    boardCamera: { x: 13, y: -27, scale: 0.35 }, pixelRatio: 1,
    boardWrapper: { getBoundingClientRect: () => viewport },
    canvas: { width: 400, height: 600 }, backgroundCanvas: { width: 400, height: 600 },
    ctx: {}, quality: { dprCap: 2 }, window: { devicePixelRatio: 1 }, BoardState: boardState,
    redrawAllStrokes() {}, scheduleSessionAutosave() {}, renderBoardBackground() {}, schedulePdfPageRerender() {},
    finishActiveBoardInput() {}, saveBoardPageView() {}, applyBoardCamera() {}
  };
  vm.createContext(context);
  vm.runInContext(fitSource, context);
  vm.runInContext("let lastCanvasCssViewport = { width: 400, height: 600 };", context);
  vm.runInContext(sizeSource, context);
  viewport = { width: 900, height: 1200 };
  const center = { x: viewport.width / 2, y: viewport.height / 2 };
  const worldBeforeClamp = boardState.pointToWorld(center, context.boardCamera);
  context.setCanvasSize();
  assert.equal(context.boardCamera.scale, context.minimumBoardZoomScale());
  assert.deepEqual(boardState.pointToWorld(center, context.boardCamera), worldBeforeClamp);
});

test("setCanvasSize preserves fitted PDF framing when DPR doubles at the same backing size", () => {
  const uiSource = fs.readFileSync(require.resolve("../js/board-2.0.1-ui.js"), "utf8");
  const fitSource = uiSource.slice(uiSource.indexOf("function boardPageFitCamera"), uiSource.indexOf("function boardWorkSnapshot"));
  const renderSource = fs.readFileSync(require.resolve("../js/render-doc-draw.js"), "utf8");
  const sizeSource = renderSource.slice(renderSource.indexOf("function setCanvasSize()"), renderSource.indexOf("function getCanvasPoint"));
  const strokesSource = fs.readFileSync(require.resolve("../js/strokes-core.js"), "utf8");
  const page = {
    kind: "pdf", pdfWorldSize: { width: 800, height: 1000 },
    pdfContentBounds: { x: 100, y: 100, width: 600, height: 800 },
    strokes: [{ widthPx: 4, points: [{ x: 31, y: 47 }] }]
  };
  let viewport = { width: 800, height: 1000 };
  const context = {
    page, boardPageSequence: [page], boardPageIndex: 0, currentBoardPage: () => page,
    boardCamera: { x: 0, y: 0, scale: 1 }, pixelRatio: 1,
    boardWrapper: { getBoundingClientRect: () => viewport },
    canvas: { width: 800, height: 1000 }, backgroundCanvas: { width: 800, height: 1000 },
    ctx: {}, quality: { dprCap: 2 }, window: { devicePixelRatio: 1 },
    strokes: [], boardStrokeSnapshot: [], pdfPageStrokeSnapshots: new Map(), strokeHistoryByContext: new Map(),
    redrawAllStrokes() {}, scheduleSessionAutosave() {}, renderBoardBackground() {}, schedulePdfPageRerender() {},
    finishActiveBoardInput() {}, saveBoardPageView() {}, applyBoardCamera() {}
  };
  vm.createContext(context);
  vm.runInContext(strokesSource, context);
  context.redrawAllStrokes = () => {};
  vm.runInContext(fitSource, context);
  vm.runInContext("let lastCanvasCssViewport = null;", context);
  vm.runInContext(sizeSource, context);
  assert.equal(context.fitCurrentBoardPage(), true);
  assert.equal(context.isCurrentBoardPageFitted({ width: 800, height: 1000 }, 1), true);

  viewport = { width: 400, height: 500 };
  context.window.devicePixelRatio = 2;
  context.setCanvasSize();

  assert.equal(context.pixelRatio, 2);
  assert.deepEqual(page.pdfWorldSize, { width: 1600, height: 2000 });
  assert.deepEqual(page.pdfContentBounds, { x: 200, y: 200, width: 1200, height: 1600 });
  assert.deepEqual(page.strokes[0].points, [{ x: 62, y: 94 }]);
  assert.equal(context.isCurrentBoardPageFitted({ width: 400, height: 500 }, 2), true);
});

test("setCanvasSize preserves PDF fit across fractional CSS viewport changes", () => {
  const uiSource = fs.readFileSync(require.resolve("../js/board-2.0.1-ui.js"), "utf8");
  const fitSource = uiSource.slice(uiSource.indexOf("function boardPageFitCamera"), uiSource.indexOf("function boardWorkSnapshot"));
  const renderSource = fs.readFileSync(require.resolve("../js/render-doc-draw.js"), "utf8");
  const sizeSource = renderSource.slice(renderSource.indexOf("function setCanvasSize()"), renderSource.indexOf("function getCanvasPoint"));
  let viewport = { width: 640, height: 900 };
  const page = { kind: "pdf", pdfContentBounds: { x: 20, y: 30, width: 600, height: 800 } };
  const context = {
    page, currentBoardPage: () => page, boardPageSequence: [page], boardPageIndex: 0,
    boardCamera: { x: 0, y: 0, scale: 1 }, pixelRatio: 1,
    boardWrapper: { getBoundingClientRect: () => viewport },
    canvas: { width: 640, height: 900 }, backgroundCanvas: { width: 640, height: 900 },
    ctx: {}, quality: { dprCap: 2 }, window: { devicePixelRatio: 1 },
    redrawAllStrokes() {}, scheduleSessionAutosave() {}, renderBoardBackground() {}, schedulePdfPageRerender() {},
    finishActiveBoardInput() {}, saveBoardPageView() {}, applyBoardCamera() {}
  };
  vm.createContext(context);
  vm.runInContext(fitSource, context);
  vm.runInContext("let lastCanvasCssViewport = null;", context);
  vm.runInContext(sizeSource, context);
  context.fitCurrentBoardPage();
  context.setCanvasSize();

  viewport = { width: 640.5, height: 900.5 };
  context.setCanvasSize();

  assert.equal(context.canvas.width, 640);
  assert.equal(context.canvas.height, 900);
  assert.equal(context.isCurrentBoardPageFitted(viewport, 1), true);

  viewport = { width: 700.25, height: 950.75 };
  context.setCanvasSize();

  assert.equal(context.canvas.width, 700);
  assert.equal(context.canvas.height, 950);
  assert.equal(context.isCurrentBoardPageFitted(viewport, 1), true);
});

test("pen and eraser toolbar handlers keep pan and tool state consistent", async () => {
  const ids = ["penToolButton", "eraserToolButton", "pixelEraserModeButton", "strokeEraserModeButton"];
  const handlers = Object.fromEntries(ids.map((id) => [id, null]));
  const context = {};
  Object.assign(context, {
    overlayMousePassthrough: false,
    panMode: false,
    tool: "pen",
    eraserMode: "eraser",
    penToolButton: { addEventListener: (_, fn) => { handlers.pen = fn; } },
    eraserToolButton: { addEventListener: (_, fn) => { handlers.eraser = fn; } },
    pixelEraserModeButton: { addEventListener: (_, fn) => { handlers.pixel = fn; } },
    strokeEraserModeButton: { addEventListener: (_, fn) => { handlers.stroke = fn; } },
    setOverlayMousePassthrough: async () => {},
    closeEraserToolPopup: () => {},
    setEraserToolPopupOpen: () => {},
    placeToolbarPopup: () => {},
    isEraserToolPopupOpen: () => false,
    applyEraserMode(mode) { context.eraserMode = mode; },
    updateToolUI: () => {},
    setPanMode(enabled) {
      context.panMode = Boolean(enabled);
      if (context.panMode) context.tool = "pen";
    },
  });
  const source = fs.readFileSync(require.resolve("../js/events-init.js"), "utf8").split("if (undoButton)")[0];
  vm.runInNewContext(source, context);
  const click = (name) => handlers[name]({ stopPropagation() {} });

  for (const eraser of ["eraser", "strokeEraser"]) {
    context.tool = eraser;
    context.panMode = false;
    await click("pen");
    assert.equal(context.tool, "pen");
    assert.equal(context.panMode, false);
  }

  context.tool = "pen";
  context.panMode = false;
  await click("pen");
  assert.equal(context.panMode, true);
  await click("pen");
  assert.equal(context.panMode, false);

  for (const [name, expectedTool] of [["eraser", "eraser"], ["pixel", "eraser"], ["stroke", "strokeEraser"]]) {
    context.tool = "pen";
    context.panMode = true;
    await click(name);
    assert.equal(context.panMode, false);
    assert.equal(context.tool, expectedTool);
  }

  const uiSource = fs.readFileSync(require.resolve("../js/board-2.0.1-ui.js"), "utf8");
  assert.doesNotMatch(uiSource, /pageModeToggleButton\.addEventListener\("click"/);
});

test("two-stage zoom timing, preview isolation, and settings commit/cancel are consistent", () => {
  const source = fs.readFileSync(require.resolve("../js/board-2.0.1-ui.js"), "utf8");
  assert.match(source, /zoomCueDelayMs: 500, zoomCueShrinkMs: 1500, presetHoldMs: 3000/);
  const timers = new Map(); let timerId = 0, now = 0;
  const makeNode = () => {
    const classes = new Set();
    const mark = { style: {}, setAttribute(k, v) { this[k] = v; } }, vertical = { style: {} };
    return { id: "", hidden: true, style: { setProperty(k, v) { this[k] = v; } }, innerHTML: "", querySelector: (selector) => selector.includes("vertical") ? vertical : mark, mark, vertical, classList: {
      add: (...xs) => xs.forEach((x) => classes.add(x)), remove: (...xs) => xs.forEach((x) => classes.delete(x)),
      contains: (x) => classes.has(x), toggle: (x, value) => value ? classes.add(x) : classes.delete(x),
    } };
  };
  const nodes = {};
  const context = {
    devSettings: { zoomCueDelayMs: 500, zoomCueShrinkMs: 1500, presetHoldMs: 3000, movementThreshold: 12, zoomSensitivity: 0.008, showTouchOverlay: true },
    devMode: false, panMode: true, currentInputPointerId: null, activePanPointerId: null, pendingZoomHold: null, zoomGesture: null,
    boardCamera: { x: 1, y: 2, scale: 1 }, devTouch: null, devTouchTimer: null, devTicker: null, zoomCueTimer: null,
    window: { setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); }, clearInterval() {}, localStorage: { setItem(k, v) { this[k] = v; }, getItem(k) { return this[k] || null; } } },
    performance: { now: () => now },
    BoardState: { canActivateZoomHold: (elapsed, movement, threshold, duration) => elapsed >= duration && movement <= threshold, zoomAt: (camera, anchor, factor) => ({ ...camera, scale: camera.scale * factor }), pointToWorld: (point, camera) => ({ x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale }) },
    minimumBoardZoomScale: () => 0.2, zoomBoardCameraAt(camera, anchor, factor, min = 0.2) { const scale = Math.max(min, Math.min(6, camera.scale * factor)); const world = boardState.pointToWorld(anchor, camera); return { x: anchor.x - world.x * scale, y: anchor.y - world.y * scale, scale }; },
    canvas: { classes: new Set(), classList: { add(x) { context.canvas.classes.add(x); }, remove(...xs) { xs.forEach((x) => context.canvas.classes.delete(x)); }, toggle(x, v) { v ? context.canvas.classes.add(x) : context.canvas.classes.delete(x); } }, setPointerCapture() {}, hasPointerCapture: () => false },
    boardWrapper: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }), append(node) { nodes[node.id] = node; } },
    document: { getElementById: (id) => nodes[id] || null, createElement: makeNode, querySelector: () => null },
    applyBoardCamera() {}, saveBoardPageView() {}, scheduleSessionAutosave() {}, hideDevTouch() {},
  };
  const runAt = (delay) => { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); now = delay; timer.fn(); } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf("function startPanOrZoomHold"), source.indexOf("function openPageManager")), context);
  context.startPanOrZoomHold({ isPrimary: true, pointerId: 7, clientX: 100, clientY: 100 });
  assert.equal(nodes.zoomCue, undefined);
  runAt(500);
  assert.equal(nodes.zoomCue.classList.contains("is-holding"), true);
  assert.equal(nodes.zoomCue.style["--zoom-hold-ms"], "1500ms");
  assert.match(fs.readFileSync(require.resolve("../styles.css"), "utf8"), /zoom-hold-shrink[\s\S]*scale\(\.2\)/);
  now = 1999;
  assert.equal(nodes.zoomCue.classList.contains("is-holding"), true);
  runAt(2000);
  assert.equal(nodes.zoomCue.classList.contains("is-zooming"), true);
  assert.match(nodes.zoomCue.innerHTML, /<circle/);
  assert.equal(nodes.zoomCue.mark.style.display, "none");
  assert.equal(context.canvas.classes.has("is-zooming-in"), true);
  context.continuePanOrZoom({ pointerId: 7, clientX: 110, clientY: 105 });
  assert.equal(nodes.zoomCue.style.left, "110px");
  assert.equal(nodes.zoomCue.vertical.style.display, "none");
  const outSize = Number.parseFloat(nodes.zoomCue.mark.transform.match(/scale\(([^)]+)\)/)[1]);
  context.continuePanOrZoom({ pointerId: 7, clientX: 110, clientY: 104 });
  assert.equal(nodes.zoomCue.vertical.style.display, "");
  assert.equal(Number.parseFloat(nodes.zoomCue.mark.transform.match(/scale\(([^)]+)\)/)[1]), 0.4);
  context.continuePanOrZoom({ pointerId: 7, clientX: 110, clientY: 90 });
  assert.ok(Number.parseFloat(nodes.zoomCue.mark.transform.match(/scale\(([^)]+)\)/)[1]) > 0.4);
  assert.ok(outSize >= 0.4);
  context.endPanOrZoom({ pointerId: 7 });
  assert.equal(nodes.zoomCue.hidden, true);
  assert.equal(context.canvas.classes.has("is-zooming-in"), false);

  const settingsFns = source.slice(source.indexOf("function getZoomCue"), source.indexOf("function initVersionTap"));
  const settingsNodes = {};
  const settingsContext = {
    window: { setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); }, clearInterval() {}, localStorage: { setItem(k, v) { this[k] = v; }, getItem(k) { return this[k] || null; } } },
    document: { getElementById: (id) => settingsNodes[id] || null, querySelector: () => null, createElement: makeNode },
    hideDevTouch() {},
  };
  vm.createContext(settingsContext);
  vm.runInContext(`const DEV_SETTINGS_KEY="test"; const DEV_DEFAULTS={zoomCueDelayMs:500,zoomCueShrinkMs:1500,presetHoldMs:3000,movementThreshold:12,zoomSensitivity:.008,showTouchOverlay:true}; let devSettings={...DEV_DEFAULTS}; let devSettingsDraft={zoomCueDelayMs:900,zoomCueShrinkMs:2100}; let devSettingsReturnFocus={isConnected:true,focus(){this.focused=true;}}; let devMode=true; let devTicker=null; let zoomCueTimer=null; ${settingsFns}`, settingsContext);
  const previewHandlers = {}, preview = {
    addEventListener(name, fn) { previewHandlers[name] = fn; },
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 100 }),
    append(node) { settingsNodes[node.id] = node; }, setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {},
  };
  const cameraBefore = { x: 2, y: 3, scale: 1.25 };
  settingsContext.boardCamera = cameraBefore;
  settingsContext.initDeveloperTrial(preview, { zoomCueDelayMs: 500, zoomCueShrinkMs: 1500, movementThreshold: 12, zoomSensitivity: 0.008 });
  previewHandlers.pointerdown({ isPrimary: true, pointerId: 5, clientX: 60, clientY: 70, preventDefault() {} });
  runAt(500);
  assert.equal(settingsNodes.devZoomCue.classList.contains("is-holding"), true);
  previewHandlers.pointerup({ pointerId: 6 });
  assert.equal(settingsNodes.devZoomCue.hidden, false);
  runAt(2000);
  assert.equal(settingsNodes.devZoomCue.classList.contains("is-zooming"), true);
  assert.equal(settingsNodes.devZoomCue.innerHTML.includes("<circle"), true);
  assert.deepEqual(settingsContext.boardCamera, cameraBefore);
  previewHandlers.pointermove({ pointerId: 5, clientX: 60, clientY: 50 });
  assert.equal(settingsNodes.devZoomCue.vertical.style.display, "");
  assert.equal(settingsNodes.devZoomCue.style.left, "50px");
  assert.equal(settingsNodes.devZoomCue.style.top, "30px");
  const trialInSize = Number.parseFloat(settingsNodes.devZoomCue.mark.transform.match(/scale\(([^)]+)\)/)[1]);
  previewHandlers.pointermove({ pointerId: 5, clientX: 60, clientY: 40 });
  assert.ok(Number.parseFloat(settingsNodes.devZoomCue.mark.transform.match(/scale\(([^)]+)\)/)[1]) > trialInSize);
  previewHandlers.pointermove({ pointerId: 5, clientX: 60, clientY: 55 });
  assert.equal(settingsNodes.devZoomCue.vertical.style.display, "none");
  assert.equal(Number.parseFloat(settingsNodes.devZoomCue.mark.transform.match(/scale\(([^)]+)\)/)[1]), 0.4);
  previewHandlers.pointerup({ pointerId: 5 });
  assert.equal(settingsNodes.devZoomCue.hidden, true);
  previewHandlers.pointerdown({ isPrimary: true, pointerId: 6, clientX: 60, clientY: 70, preventDefault() {} });
  runAt(500); runAt(2000);
  previewHandlers.pointercancel({ pointerId: 6 });
  assert.equal(settingsNodes.devZoomCue.hidden, true);
  previewHandlers.pointerdown({ isPrimary: true, pointerId: 8, clientX: 60, clientY: 70, preventDefault() {} });
  previewHandlers.pointermove({ pointerId: 8, clientX: 80, clientY: 70 });
  assert.equal(vm.runInContext("developerTrial", settingsContext), null);
  assert.equal(settingsNodes.devZoomCue.hidden, true);

  settingsNodes.developerSettings = { hidden: false, removeAttribute() {} };
  settingsNodes.developerSettingsBackdrop = { hidden: false };
  assert.equal(settingsContext.normalizeDevSettings({ zoomHoldMs: 3000 }).zoomCueDelayMs, 500);
  assert.equal(settingsContext.normalizeDevSettings({ zoomHoldMs: 3000 }).zoomCueShrinkMs, 2500);
  assert.equal(settingsContext.normalizeDevSettings({ zoomHoldMs: 5000 }).zoomCueShrinkMs, 4500);
  const malformed = settingsContext.normalizeDevSettings({ zoomCueDelayMs: "900", zoomCueShrinkMs: null, presetHoldMs: NaN, movementThreshold: "12", zoomSensitivity: Infinity, showTouchOverlay: "false" });
  assert.equal(malformed.zoomCueDelayMs, 500);
  assert.equal(malformed.zoomCueShrinkMs, 1500);
  assert.equal(malformed.presetHoldMs, 3000);
  assert.equal(malformed.movementThreshold, 12);
  assert.equal(malformed.zoomSensitivity, 0.008);
  assert.equal(malformed.showTouchOverlay, true);
  const validCustom = settingsContext.normalizeDevSettings({ zoomCueDelayMs: 700, zoomCueShrinkMs: 2300, presetHoldMs: 4100, movementThreshold: 20, zoomSensitivity: 0.011, showTouchOverlay: false });
  assert.equal(validCustom.zoomCueDelayMs + validCustom.zoomCueShrinkMs, 3000);
  assert.equal(validCustom.presetHoldMs, 4100);
  assert.equal(validCustom.showTouchOverlay, false);
  settingsContext.discardDeveloperSettings();
  assert.equal(settingsContext.window.localStorage.test, undefined);
  assert.equal(settingsNodes.developerSettings.hidden, true);
  assert.equal(vm.runInContext("devSettingsDraft", settingsContext), null);
  vm.runInContext("devSettingsDraft={zoomCueDelayMs:900,zoomCueShrinkMs:2100}", settingsContext);
  settingsContext.saveDeveloperSettings();
  assert.equal(JSON.parse(settingsContext.window.localStorage.test).zoomCueDelayMs, 900);
  assert.equal(vm.runInContext("devSettings.zoomCueShrinkMs", settingsContext), 2100);
  assert.doesNotMatch(source, /getElementById\("appInfoButton"\)\.addEventListener/);
  assert.match(source, /zoomCueDelayMs: 500, zoomCueShrinkMs: 1500/);
});

test("add undo/redo preserves edits made after redo", () => {
  const pages = boardState.createPageSequence(2);
  const add = { action: "add", index: 1, page: boardState.createBlankPage("blank:add") };
  pages.splice(add.index, 0, structuredClone(add.page));
  assert.equal(boardState.applyStructureOperation(pages, add, false), true);
  assert.equal(pages.length, 2);
  assert.equal(boardState.applyStructureOperation(pages, add, true), true);
  pages[1].strokes.push({ color: "#111111", points: [{ x: 4, y: 8 }] });
  pages[1].view = { x: 12, y: 14, scale: 1.5 };
  assert.equal(boardState.applyStructureOperation(pages, add, false), true);
  assert.equal(boardState.applyStructureOperation(pages, add, true), true);
  assert.deepEqual(pages[1].strokes[0].points, [{ x: 4, y: 8 }]);
  assert.deepEqual(pages[1].view, { x: 12, y: 14, scale: 1.5 });
});

test("delete undo/redo captures the latest edits and protects PDF and final page", () => {
  const pages = boardState.createPageSequence(1);
  pages.push(boardState.createBlankPage("blank:delete"));
  const remove = { action: "delete", index: 1, page: null };
  assert.equal(boardState.applyStructureOperation(pages, remove, true), true);
  assert.equal(boardState.applyStructureOperation(pages, remove, false), true);
  pages[1].strokes.push({ color: "#111111", points: [{ x: 3, y: 9 }] });
  assert.equal(boardState.applyStructureOperation(pages, remove, true), true);
  assert.equal(boardState.applyStructureOperation(pages, remove, false), true);
  assert.deepEqual(pages[1].strokes[0].points, [{ x: 3, y: 9 }]);
  assert.equal(boardState.canDeletePage(pages, 0), false);
  assert.equal(boardState.canDeletePage([boardState.createBlankPage("only")], 0), false);
});

test("deleting an inked middle blank saves it before render selects its neighbor", () => {
  const pages = boardState.createPageSequence(2);
  const blank = boardState.createBlankPage("blank:middle");
  blank.strokes.push({ color: "#222222", points: [{ x: 2, y: 3 }] });
  pages.splice(1, 0, blank);
  const firstInk = [{ color: "#ff0000", points: [{ x: 10, y: 11 }] }];
  const middleInk = [{ color: "#222222", points: [{ x: 20, y: 21 }] }];
  const lastInk = [{ color: "#0000ff", points: [{ x: 30, y: 31 }] }];
  pages[0].strokes = structuredClone(firstInk);
  pages[1].strokes = structuredClone(middleInk);
  pages[2].strokes = structuredClone(lastInk);
  assert.equal(boardState.savePageState(pages, 1, middleInk, { x: 7, y: 8, scale: 1.25 }), true);
  const op = { action: "delete", index: 1, page: null };
  assert.equal(boardState.applyStructureOperation(pages, op, true), true);
  const target = boardState.pageForRender(pages, 1);
  assert.deepEqual(target.page.strokes, lastInk);
  assert.deepEqual(pages[0].strokes, firstInk);
  assert.deepEqual(op.page.strokes, middleInk);
  assert.deepEqual(op.page.view, { x: 7, y: 8, scale: 1.25 });
});

test("render selection preserves strokes imported into the new page sequence", () => {
  const imported = boardState.createPageSequence(2);
  imported[0].strokes = [{ color: "#008800", points: [{ x: 41, y: 42 }] }];
  imported[1].strokes = [{ color: "#880088", points: [{ x: 51, y: 52 }] }];
  const target = boardState.pageForRender(imported, 1);
  assert.equal(target.index, 1);
  assert.deepEqual(target.page.strokes, [{ color: "#880088", points: [{ x: 51, y: 52 }] }]);
  assert.deepEqual(imported[0].strokes, [{ color: "#008800", points: [{ x: 41, y: 42 }] }]);
});

test("single point zoom keeps the touched world point anchored", () => {
  const camera = { x: 30, y: 50, scale: 1 };
  const anchor = { x: 150, y: 120 };
  const worldBefore = boardState.pointToWorld(anchor, camera);
  const zoomed = boardState.zoomAt(camera, anchor, 1.5);
  assert.deepEqual(boardState.pointToWorld(anchor, zoomed), worldBefore);
  assert.equal(zoomed.scale, 1.5);
});

test("zoom hold requires the full timer and movement to stay within threshold", () => {
  assert.equal(boardState.canActivateZoomHold(2999, 0, 12, 3000), false);
  assert.equal(boardState.canActivateZoomHold(3000, 12, 12, 3000), true);
  assert.equal(boardState.canActivateZoomHold(3500, 12.1, 12, 3000), false);
});

test("secondary pointer events cannot mutate the active stroke", () => {
  assert.equal(boardState.isActivePointer(2, 2), true);
  assert.equal(boardState.isActivePointer(2, 3), false);
  assert.equal(boardState.isActivePointer(null, 2), false);
});

test("replacement manager rejects duplicate requests and settles each caller", async () => {
  const manager = boardState.createReplacementManager();
  const firstAction = () => true;
  const first = manager.request(firstAction);
  const second = manager.request(() => assert.fail("duplicate action must not replace the pending action"));
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.equal(await second.promise, false);
  assert.equal(manager.hasPending(), true);
  const pending = manager.take();
  assert.equal(pending.action, firstAction);
  assert.equal(manager.take(), null);
  assert.equal(manager.settle(pending, true), true);
  assert.equal(await first.promise, true);
  assert.equal(manager.hasPending(), false);
});

test("replacement manager cancellation settles pending request as false", async () => {
  const manager = boardState.createReplacementManager();
  const request = manager.request(() => true);
  assert.equal(manager.cancel(), true);
  assert.equal(await request.promise, false);
  assert.equal(manager.hasPending(), false);
});

test("file size limits accept exact caps and reject larger or invalid sizes", () => {
  const { MAX_PDF_BYTES, MAX_WORK_FILE_BYTES, isByteLengthWithinLimit } = boardState;
  assert.equal(isByteLengthWithinLimit(MAX_PDF_BYTES, MAX_PDF_BYTES), true);
  assert.equal(isByteLengthWithinLimit(MAX_PDF_BYTES + 1, MAX_PDF_BYTES), false);
  assert.equal(isByteLengthWithinLimit(MAX_WORK_FILE_BYTES, MAX_WORK_FILE_BYTES), true);
  assert.equal(isByteLengthWithinLimit(MAX_WORK_FILE_BYTES + 1, MAX_WORK_FILE_BYTES), false);
  assert.equal(isByteLengthWithinLimit(Number.NaN, MAX_PDF_BYTES), false);
});

test("base64 length guard checks decoded bytes without allocating a payload", () => {
  const { MAX_PDF_BYTES, base64DecodedByteLength, isBase64WithinLimit } = boardState;
  const exactEncodedLength = Math.ceil(MAX_PDF_BYTES / 3) * 4;
  assert.equal(base64DecodedByteLength(exactEncodedLength, 2), MAX_PDF_BYTES);
  assert.equal(base64DecodedByteLength(exactEncodedLength, 1), MAX_PDF_BYTES + 1);
  assert.equal(isBase64WithinLimit("AQ==", 1), true);
  assert.equal(isBase64WithinLimit("AQI=", 1), false);
  assert.equal(base64DecodedByteLength(4, 3), null);
});
