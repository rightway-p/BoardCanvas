const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../js/render-doc-draw.js"), "utf8");
const strokesSource = fs.readFileSync(require.resolve("../js/strokes-core.js"), "utf8");
const range = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const strokeRange = (start, end) => strokesSource.slice(strokesSource.indexOf(start), strokesSource.indexOf(end, strokesSource.indexOf(start)));
const productionFunctions = [
  range("function setCanvasSize", "function getCanvasPoint"),
  range("function applyCurrentBrush", "function redrawVisibleStrokesWithActive"),
  range("function redrawVisibleStrokesWithActive", "function appendRawPoint"),
  range("function appendRawPoint", "function processDrawFrame"),
  range("function stopDrawing", "function discardDrawingForTouchTakeover"),
  strokeRange("function positiveStrokeWidth", "function createStrokeRecord"),
  strokeRange("function normalizeStrokeOpacity", "function cloneStroke"),
  strokeRange("function drawStrokePath", "function redrawAllStrokes"),
].join("\n");

function harness(pixelRatio, penOpacity = 1, tool = "pen") {
  const camera = { x: 100, y: 50, scale: 1.5 };
  let transform = [1, 0, 0, 1, 0, 0];
  const pathPoints = [];
  const arcs = [];
  const ctx = {
    setTransform(...next) { transform = next; },
    beginPath() {}, moveTo(x, y) { pathPoints.push(transformPoint(x, y)); },
    lineTo(x, y) { pathPoints.push(transformPoint(x, y)); },
    quadraticCurveTo(_cx, _cy, x, y) { pathPoints.push(transformPoint(x, y)); },
    arc(x, y, radius) { arcs.push({ ...transformPoint(x, y), radius: radius * transform[0] }); },
    stroke() {}, fill() {},
  };
  function transformPoint(x, y) {
    return { x: transform[0] * x + transform[4], y: transform[3] * y + transform[5] };
  }
  let app;
  app = {
    ctx, boardCamera: camera, pixelRatio, penOpacity, tool, drawing: true, hasStrokeMoved: false,
    quality: { maxPointsPerFrame: 48, frameBudgetMs: 6 }, frameCostAverage: 0,
    pendingQualityResize: false, setCanvasSize() {},
    pendingPoints: [], pendingHead: 0, frameRequested: false, activeStroke: { widthPx: (tool === "pen" ? 4 * pixelRatio / camera.scale : 10 * pixelRatio), smoothing: false, points: [] },
    lastPoint: null, strokes: [], MAX_QUEUE_POINTS: 320,
    lineWidthInput: { value: "4" }, eraserWidthInput: { value: "10" },
    penColorInput: { value: "#111111" }, strokeRgba: () => "rgba(0, 0, 0, 1)",
    canvas: { width: 2000, height: 1600, hasPointerCapture: () => false, releasePointerCapture() {} },
    performance: { now: () => 0 }, window: { requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} },
    processDrawFrame() {},
    clearPendingPoints() { app.pendingPoints.length = 0; app.pendingHead = 0; },
    getCanvasPoint(event) { return { x: event.clientX, y: event.clientY }; },
    getMidpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; },
    appendPointToStroke(stroke, point) { stroke.points.push({ ...point }); },
    applyCurrentBrush() {},
    enqueueEventPoints() {}, flushPendingPoints() {}, saveUndoSnapshotForCurrentContext() {}, finalizeStrokeMutation() {},
    redrawAllStrokes() { ctx.setTransform(1, 0, 0, 1, 0, 0); }, updateUndoRedoUI() {},
    pathPoints, arcs,
  };
  vm.createContext(app);
  vm.runInContext(productionFunctions, app);
  return app;
}

function stored(cssX, cssY, pixelRatio) {
  return { x: ((cssX - 100) / 1.5) * pixelRatio, y: ((cssY - 50) / 1.5) * pixelRatio };
}
function assertPoint(actual, expected) {
  assert.ok(Math.abs(actual.x - expected.x) < 1e-8, `x ${actual.x} != ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-8, `y ${actual.y} != ${expected.y}`);
}

function resizeHarness({ pixelRatio = 2, devicePixelRatio = 1, width = 100, pointerId = 9, pendingQualityResize = false } = {}) {
  const resizeOrder = [];
  const canvas = { hasPointerCapture: () => false, releasePointerCapture() {} };
  const backgroundCanvas = {};
  for (const target of [canvas, backgroundCanvas]) {
    let canvasWidth = 200, canvasHeight = 200;
    Object.defineProperties(target, {
      width: { get: () => canvasWidth, set(value) { resizeOrder.push("canvas-size"); canvasWidth = value; } },
      height: { get: () => canvasHeight, set(value) { resizeOrder.push("canvas-size"); canvasHeight = value; } },
    });
  }
  let app;
  app = {
    canvas, backgroundCanvas,
    boardWrapper: { getBoundingClientRect: () => ({ width, height: 100 }) },
    ctx: { setTransform() {}, clearRect() {} },
    pixelRatio, quality: { dprCap: 2 }, window: { devicePixelRatio },
    lastCanvasCssViewport: { width: 100, height: 100 }, boardCamera: { x: 0, y: 0, scale: 1 },
    drawing: true, hasStrokeMoved: true, currentInputPointerId: pointerId,
    activeStroke: { widthPx: 4, points: [{ x: 80, y: 100 }] }, lastPoint: { x: 80, y: 100 },
    pendingQualityResize, pendingPoints: [], pendingHead: 0, frameRequested: false,
    strokes: [{ widthPx: 4, points: [{ x: 20, y: 30 }] }], undoSnapshots: [], tool: "pen", penOpacity: 1,
    lineWidthInput: { value: "4" }, eraserWidthInput: { value: "10" },
    finishCalls: 0, finishDpr: [], resizeOrder,
    finishActiveBoardInput() {
      app.finishCalls += 1; app.finishDpr.push(app.pixelRatio); resizeOrder.push("finish-input");
      if (app.drawing) app.stopDrawing({ type: "pointercancel", pointerId: app.currentInputPointerId });
      app.currentInputPointerId = null;
    },
    clearPendingPoints() { app.pendingPoints.length = 0; app.pendingHead = 0; },
    flushPendingPoints() {}, applyCurrentBrush() {}, saveUndoSnapshotForCurrentContext() {
      app.undoSnapshots.push(JSON.parse(JSON.stringify(app.strokes)));
    }, finalizeStrokeMutation() {}, redrawAllStrokes() {}, updateUndoRedoUI() {},
    scaleStoredStrokes(scaleX, scaleY) {
      for (const collection of [app.strokes, ...app.undoSnapshots]) {
        for (const item of collection) for (const point of item.points) { point.x *= scaleX; point.y *= scaleY; }
      }
    },
    scheduleSessionAutosave() {}, renderBoardBackground() {}, schedulePdfPageRerender() {},
    isCurrentBoardPageFitted: () => false, enforcePdfZoomMinimum() {},
  };
  vm.createContext(app);
  vm.runInContext(productionFunctions, app);
  return app;
}

test("raw small and non-collinear samples render exactly through live and saved paths", () => {
  for (const pixelRatio of [1, 2]) for (const penOpacity of [1, 0.5]) {
    const app = harness(pixelRatio, penOpacity);
    const cssPoints = [{ x: 400, y: 400 }, { x: 400.25, y: 400.5 }, { x: 401, y: 400.75 }, { x: 401, y: 400.75 }, { x: 406.5, y: 397.25 }];
    const points = cssPoints.map(({ x, y }) => stored(x, y, pixelRatio));
    const first = points[0];
    app.lastPoint = { ...first };
    app.activeStroke.points = [{ ...first }];
    app.pendingPoints = points.slice(1).map((point) => ({ point: { ...point } }));
    const originalPoints = JSON.parse(JSON.stringify(app.pendingPoints));
    app.processPendingPoints(10, 10);
    const expectedCss = cssPoints.filter((point, index) => index === 0 || point.x !== cssPoints[index - 1].x || point.y !== cssPoints[index - 1].y);
    const expectedPath = expectedCss.map(({ x, y }) => ({ x: x * pixelRatio, y: y * pixelRatio }));
    for (let index = 0; index < expectedPath.length; index += 1) assertPoint(app.pathPoints[index], expectedPath[index]);
    assert.deepEqual(app.pendingPoints, []);
    assert.deepEqual(app.activeStroke.points, points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y));
    assert.deepEqual(originalPoints.map(({ point }) => point), points.slice(1));

    app.pathPoints.length = 0;
    app.redrawVisibleStrokesWithActive();
    assert.equal(app.pathPoints.length, expectedPath.length);
    for (let index = 0; index < expectedPath.length; index += 1) assertPoint(app.pathPoints[index], expectedPath[index]);

    const next = stored(407, 397, pixelRatio);
    app.pendingPoints = [{ point: next }];
    app.processPendingPoints(10, 10);
    assertPoint(app.pathPoints.at(-1), { x: 407 * pixelRatio, y: 397 * pixelRatio });
  }
});

test("pointerup falls back to its endpoint for empty coalesced samples and adds omitted terminal coordinates once", () => {
  const app = harness(1);
  const up = (x, y, samples) => ({ type: "pointerup", clientX: x, clientY: y, getCoalescedEvents: () => samples });
  app.enqueueEventPoints(up(12, 13, []));
  assert.deepEqual(app.pendingPoints.map(({ point }) => point), [{ x: 12, y: 13 }]);
  app.clearPendingPoints();

  app.enqueueEventPoints(up(20, 21, [{ clientX: 18, clientY: 19 }, { clientX: 19, clientY: 20 }]));
  assert.deepEqual(app.pendingPoints.map(({ point }) => point), [{ x: 18, y: 19 }, { x: 19, y: 20 }, { x: 20, y: 21 }]);
  app.clearPendingPoints();
  app.enqueueEventPoints(up(20, 21, [{ clientX: 19, clientY: 20 }, { clientX: 20, clientY: 21 }]));
  assert.deepEqual(app.pendingPoints.map(({ point }) => point), [{ x: 19, y: 20 }, { x: 20, y: 21 }]);
});

test("terminal pen and pixel-eraser dots use the same camera transform as committed ink", () => {
  for (const pixelRatio of [1, 2]) {
    for (const tool of ["pen", "eraser"]) {
      const app = harness(pixelRatio, 1, tool);
      app.hasStrokeMoved = false;
      app.lastPoint = stored(400, 400, pixelRatio);
      app.activeStroke.points = [{ ...app.lastPoint }];
      app.stopDrawing({ type: "pointercancel", pointerId: 1 });
      assertPoint(app.arcs[0], { x: 400 * pixelRatio, y: 400 * pixelRatio });
      const expectedRadius = Number(tool === "pen" ? app.lineWidthInput.value : app.eraserWidthInput.value) * pixelRatio * (tool === "pen" ? 1 : 1.5) / 2;
      assert.ok(Math.abs(app.arcs[0].radius - expectedRadius) < 1e-8);
    }
  }
});

test("resize finishes active input in the old DPR before scaling committed and undo ink", () => {
  for (const pointerId of [1, 9]) {
    const app = resizeHarness({ pointerId, pendingQualityResize: true });
    app.setCanvasSize();
    assert.deepEqual(app.finishDpr, [2]);
    assert.ok(app.resizeOrder.indexOf("finish-input") < app.resizeOrder.indexOf("canvas-size"));
    assert.equal(app.drawing, false);
    assert.equal(app.currentInputPointerId, null);
    assert.equal(app.pendingQualityResize, false);
    assert.equal(app.strokes.length, 2);
    assertPoint(app.strokes[0].points[0], { x: 10, y: 15 });
    assertPoint(app.strokes[1].points[0], { x: 40, y: 50 });
    assert.equal(app.undoSnapshots[0].length, 1);
    assertPoint(app.undoSnapshots[0][0].points[0], { x: 10, y: 15 });
  }
});

test("ordinary geometry resize finishes input, while unchanged canvas geometry does not", () => {
  const resized = resizeHarness({ pixelRatio: 1, devicePixelRatio: 1, width: 120 });
  resized.setCanvasSize();
  assert.equal(resized.finishCalls, 1);
  assert.equal(resized.drawing, false);

  const unchanged = resizeHarness({ pixelRatio: 2, devicePixelRatio: 2, width: 100 });
  unchanged.setCanvasSize();
  assert.equal(unchanged.finishCalls, 0);
  assert.equal(unchanged.drawing, true);
  assert.equal(unchanged.currentInputPointerId, 9);
});

test("initial canvas sizing works before the input-finish helper is loaded", () => {
  const app = resizeHarness({ pixelRatio: 1, devicePixelRatio: 2, width: 150 });
  app.drawing = false;
  app.currentInputPointerId = null;
  delete app.finishActiveBoardInput;
  app.setCanvasSize();
  assert.equal(app.pixelRatio, 2);
  assert.equal(app.canvas.width, 300);
});
