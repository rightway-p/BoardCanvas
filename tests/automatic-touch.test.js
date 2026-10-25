const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const BoardState = require("../js/domain/board-state.js");
const BoardHistoryTaps = require("../js/domain/history-taps.js");

const ui = fs.readFileSync(require.resolve("../js/board-2.0.1-ui.js"), "utf8");
const draw = fs.readFileSync(require.resolve("../js/render-doc-draw.js"), "utf8");
const range = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const touchFunctions = range(ui, "function markAutomaticTouchEvent", "function getZoomCue");
const inputFunctions = [
  range(draw, "function discardDrawingForTouchTakeover", "function handlePointerDown"),
  range(draw, "function startDrawing", "function draw(event)"),
  range(draw, "function handlePointerDown", "function handlePointerMove"),
  range(draw, "function handlePointerMove", "function handlePointerEnd"),
  range(draw, "function handlePointerEnd", "function clearBoard"),
].join("\n");

function harness(overrides = {}) {
  let now = 1000;
  let timerId = 0;
  const timers = new Map();
  const captures = new Set();
  const canvas = {
    setPointerCapture(id) { captures.add(id); },
    hasPointerCapture(id) { return captures.has(id); },
    releasePointerCapture(id) { captures.delete(id); },
  };
  const context = {
    boardInteractionMode: "multi", navModeLocked: false, automaticTouchSession: null, automaticTouchBlockedPointers: new Set(), automaticTouchFrame: 0,
    currentInputPointerId: null, drawing: false, hasStrokeMoved: false, strokeEraserActive: false, strokeEraserPointerId: null,
    tool: "pen", overlayMousePassthrough: false, panMode: false, devSettings: BoardState.normalizeAutomaticTouchSettings({}),
    BoardState, BoardHistoryTaps, historyTouchTracker: null, canvas, boardWrapper: { getBoundingClientRect: () => ({ left: 0, top: 0 }) }, boardCamera: { x: 0, y: 0, scale: 1 },
    window: { requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
      setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { at: now + delay, fn }); return id; },
      clearTimeout(id) { timers.delete(id); },
    }, performance: { now: () => now },
    advance(ms) {
      const target = now + ms;
      while (true) {
        const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at; timers.delete(due[0]); due[1].fn();
      }
      now = target;
    },
    currentTime(value) { now = value; },
    setPanMode() {},
    getCanvasPoint(event) { return { x: event.clientX, y: event.clientY }; },
    createStrokeRecord(kind, point) { return { kind, points: [{ ...point }] }; },
    clearPendingPoints() { context.pendingPoints = []; }, pendingPoints: [], frameRequested: false,
    ctx: { setTransform() {} }, applyCurrentBrush() {}, redrawVisibleStrokesWithActive() { context.visibleInkFrames += 1; }, visibleInkFrames: 0,
    redrawAllStrokes() { context.redrawCount += 1; }, redrawCount: 0,
    updateUndoRedoUI() {}, updateToolUI() {}, draw(event) { context.drawMoves.push(event.pointerId); }, drawMoves: [],
    startStrokeErasing(event) { context.strokeEraserActive = true; context.strokeEraserPointerId = event.pointerId; context.eraserStarts += 1; }, eraserStarts: 0,
    continueStrokeErasing(event) { context.eraserMoves += 1; }, eraserMoves: 0,
    stopStrokeErasing(event) { context.strokeEraserActive = false; context.strokeEraserPointerId = null; context.eraserStops.push(event.type); }, eraserStops: [],
    stopDrawing(event) { context.stopTypes.push(event.type); context.drawing = false; context.activeStroke = null; }, stopTypes: [],
    strokes: [{ id: "committed" }], undoSnapshots: ["before"], activeStroke: null, lastPoint: null,
    pixelRatio: 1, pendingQualityResize: false,
    saveBoardPageView() {}, scheduleSessionAutosave() {}, applyBoardCamera() {}, zoomBoardCameraAt(camera, anchor, factor) { return BoardState.zoomAt(camera, anchor, factor); },
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(`${touchFunctions}\n${inputFunctions}`, context);
  return context;
}
function pointer(pointerId, pointerType, type, x = 100, y = 100) {
  return { pointerId, pointerType, type, isPrimary: pointerId === 1, clientX: x, clientY: y, preventDefault() { this.prevented = true; }, getCoalescedEvents() { return []; } };
}

// Exercise the real history and button state alongside touch event routing.
function historyHarness() {
  const app = harness({
    strokes: [], strokeHistoryByContext: new Map(), HISTORY_STACK_LIMIT: 100,
    undoButton: { disabled: true }, redoButton: { disabled: true },
    pdfExportInProgress: false, sessionRestoreInProgress: false, pdfDocument: null,
    boardPageSequence: BoardState.createPageSequence(2), boardPageIndex: 0,
    strokeEraserHistoryArmed: false, eraserWidthInput: { value: 10 },
    ctx: { setTransform() {}, beginPath() {}, arc() {}, fill() {} },
    flushPendingPoints() {},
  });
  const toolbar = fs.readFileSync(require.resolve("../js/session-pdf-toolbar.js"), "utf8");
  vm.runInContext([
    fs.readFileSync(require.resolve("../js/strokes-core.js"), "utf8"),
    range(toolbar, "function hasLoadedPdfDocument", "function updatePageIndicator"),
    fs.readFileSync(require.resolve("../js/strokes-history.js"), "utf8"),
    fs.readFileSync(require.resolve("../js/stroke-eraser.js"), "utf8"),
    range(ui, "function currentBoardPage", "function markBoardPagePresented"),
    range(ui, "function saveBoardPageView", "function renderBoardPage"),
    range(draw, "function stopDrawing", "function discardDrawingForTouchTakeover"),
  ].join("\n"), app);
  // Canvas rendering is irrelevant to history; keep the real mutation lifecycle.
  app.redrawAllStrokes = () => {};
  app.createStrokeRecord = (kind, point) => ({
    kind, widthPx: 4, points: [{ ...point }],
    minX: point.x, maxX: point.x, minY: point.y, maxY: point.y,
  });
  return app;
}

function drawHistoryStroke(app, tool, x) {
  app.tool = tool;
  app.handlePointerDown(pointer(1, "pen", "pointerdown", x, 100));
  app.handlePointerEnd(pointer(1, "pen", "pointercancel", x, 100));
}

function navigateWithTwoTouches(app, mode) {
  app.tool = "pen";
  const secondX = mode === "pan" ? 140 : 240;
  for (const event of [pointer(1, "touch", "pointerdown"), pointer(2, "touch", "pointerdown", secondX, 100)]) {
    app.automaticTouchDown(event); app.handlePointerDown(event);
  }
  assert.equal(app.automaticTouchSession.pair.mode, mode);
  const move = pointer(2, "touch", "pointermove", secondX + 50, 130);
  app.automaticTouchMove(move); app.handlePointerMove(move);
  app.applyAutomaticTouchNavigation();
  for (const event of [pointer(2, "touch", "pointerup", secondX + 50, 130), pointer(1, "touch", "pointerup")]) {
    app.automaticTouchEnd(event); app.handlePointerEnd(event);
  }
  assert.equal(app.automaticTouchSession, null);
}

test("pan and zoom leave pen and eraser undo/redo buttons usable without changing the camera", () => {
  for (const mode of ["pan", "zoom"]) for (const tool of ["pen", "eraser", "strokeEraser"]) {
    const app = historyHarness();
    drawHistoryStroke(app, "pen", 100);
    const before = JSON.stringify(app.strokes);
    drawHistoryStroke(app, tool, 100);
    const after = JSON.stringify(app.strokes);
    assert.notEqual(after, before);
    assert.equal(app.undoButton.disabled, false);

    navigateWithTwoTouches(app, mode);
    const camera = JSON.stringify(app.boardCamera);
    assert.notEqual(camera, JSON.stringify({ x: 0, y: 0, scale: 1 }));
    assert.equal(app.undoButton.disabled, false, `${mode} must unlock undo for ${tool}`);
    assert.equal(app.undoStrokeAction(), true);
    assert.equal(JSON.stringify(app.strokes), before);
    assert.equal(JSON.stringify(app.boardCamera), camera);

    navigateWithTwoTouches(app, mode);
    const redoCamera = JSON.stringify(app.boardCamera);
    assert.equal(app.redoButton.disabled, false, `${mode} must preserve redo for ${tool}`);
    assert.equal(app.redoStrokeAction(), true);
    assert.equal(JSON.stringify(app.strokes), after);
    assert.equal(JSON.stringify(app.boardCamera), redoCamera);
  }
});

test("page-local history survives navigation and edits on another page", () => {
  const app = historyHarness();
  drawHistoryStroke(app, "pen", 100);
  drawHistoryStroke(app, "eraser", 100);
  assert.equal(app.undoStrokeAction(), true);
  const pageOneInk = JSON.stringify(app.strokes);

  app.boardPageIndex = 1;
  app.restoreCurrentStrokeState(); app.updateUndoRedoUI();
  assert.equal(app.undoButton.disabled, true);
  assert.equal(app.redoButton.disabled, true);
  drawHistoryStroke(app, "pen", 300);
  const pageTwoInk = JSON.stringify(app.strokes);
  navigateWithTwoTouches(app, "zoom");
  assert.equal(app.undoButton.disabled, false);
  assert.equal(app.undoStrokeAction(), true);
  assert.equal(app.strokes.length, 0);

  app.boardPageIndex = 0;
  app.restoreCurrentStrokeState(); app.updateUndoRedoUI();
  assert.equal(JSON.stringify(app.strokes), pageOneInk);
  assert.equal(app.redoButton.disabled, false);
  assert.equal(app.redoStrokeAction(), true);
  assert.equal(app.strokes.at(-1).kind, "pixel-eraser");

  app.boardPageIndex = 1;
  app.restoreCurrentStrokeState(); app.updateUndoRedoUI();
  assert.equal(app.strokes.length, 0);
  assert.equal(app.redoStrokeAction(), true);
  assert.equal(JSON.stringify(app.strokes), pageTwoInk);
});

function historyTap(app, jitter = 0, endType = "pointerup") {
  for (const event of [pointer(1, "touch", "pointerdown"), pointer(2, "touch", "pointerdown", 140, 100)]) {
    app.automaticTouchDown(event); app.handlePointerDown(event); app.advance(15);
  }
  const move = pointer(2, "touch", "pointermove", 140 + jitter, 100);
  app.automaticTouchMove(move); app.handlePointerMove(move); app.applyAutomaticTouchNavigation();
  for (const event of [pointer(1, "touch", endType), pointer(2, "touch", endType, 140 + jitter, 100)]) {
    app.automaticTouchEnd(event); app.handlePointerEnd(event);
  }
}

test("two-finger double and triple taps operate actual page history without moving the camera", () => {
  const app = historyHarness();
  drawHistoryStroke(app, "pen", 100); drawHistoryStroke(app, "pen", 200);
  const original = JSON.stringify(app.strokes), camera = JSON.stringify(app.boardCamera);
  historyTap(app, 2); app.advance(70); historyTap(app, 3);
  assert.equal(JSON.stringify(app.strokes), original);
  app.advance(299); assert.equal(app.strokes.length, 2);
  app.advance(1); assert.equal(app.strokes.length, 1);
  assert.equal(JSON.stringify(app.boardCamera), camera);
  historyTap(app); historyTap(app); historyTap(app);
  assert.equal(JSON.stringify(app.strokes), original);
  app.advance(1000); assert.equal(JSON.stringify(app.strokes), original);
  assert.equal(JSON.stringify(app.boardCamera), camera);
});

test("pan, cancellation, page replacement, and native pen input cancel pending tap actions", () => {
  for (const interrupt of ["pan", "cancel", "page", "pen", "blur"]) {
    const app = historyHarness(); drawHistoryStroke(app, "pen", 100);
    historyTap(app); historyTap(app);
    if (interrupt === "pan") navigateWithTwoTouches(app, "pan");
    if (interrupt === "cancel") historyTap(app, 0, "pointercancel");
    if (interrupt === "page") { app.boardPageSequence = BoardState.createPageSequence(2); app.restoreCurrentStrokeState(); }
    if (interrupt === "pen") {
      const down = pointer(1, "pen", "pointerdown", 200, 100);
      app.automaticTouchDown(down); app.handlePointerDown(down);
      app.handlePointerEnd(pointer(1, "pen", "pointercancel", 200, 100));
    }
    if (interrupt === "blur") app.resetAutomaticTouchSession();
    const expected = JSON.stringify(app.strokes);
    app.advance(1000); assert.equal(JSON.stringify(app.strokes), expected, interrupt);
  }
});

test("delayed dispatch uses physical contact timestamps for history tap pairing", () => {
  const app = historyHarness(); drawHistoryStroke(app, "pen", 100);
  for (let index = 0; index < 2; index++) {
    const first = pointer(1, "touch", "pointerdown"); first.timeStamp = 10000 + index * 300;
    app.automaticTouchDown(first); app.handlePointerDown(first);
    app.advance(180);
    const second = pointer(2, "touch", "pointerdown", 140, 100); second.timeStamp = first.timeStamp + 30;
    app.automaticTouchDown(second); app.handlePointerDown(second);
    assert.equal(app.getHistoryTouchTracker().isCandidate(), true);
    for (const id of [1, 2]) {
      const up = pointer(id, "touch", "pointerup", id === 1 ? 100 : 140, 100); up.timeStamp = first.timeStamp + 60;
      app.automaticTouchEnd(up); app.handlePointerEnd(up);
    }
  }
  app.advance(300); assert.equal(app.strokes.length, 0);
});

test("a new content mutation cancels pending double-tap undo", () => {
  const app = historyHarness(); drawHistoryStroke(app, "pen", 100);
  historyTap(app); historyTap(app);
  // Same mutation path as clearBoard(), including keyboard/remote activation.
  app.saveUndoSnapshotForCurrentContext(); app.strokes.length = 0; app.finalizeStrokeMutation();
  app.advance(300); assert.equal(app.strokes.length, 0);
});

test("touches during native pen ink do not consume the pen owner's release", () => {
  const app = harness({ currentInputPointerId: 9, drawing: true });
  const touch = pointer(1, "touch", "pointerdown");
  app.automaticTouchDown(touch);
  app.handlePointerDown(touch);
  assert.equal(touch.boardTouchHandled, true);
  assert.equal(app.currentInputPointerId, 9);

  const penUp = pointer(9, "pen", "pointerup");
  app.automaticTouchEnd(penUp);
  app.handlePointerEnd(penUp);
  assert.deepEqual(app.stopTypes, ["pointerup"]);
  assert.equal(app.currentInputPointerId, null);
  app.automaticTouchEnd(pointer(1, "touch", "pointerup"));
  assert.equal(app.automaticTouchSession, null);
});

test("first touch remains an immediate, locked eraser or stroke-eraser action", () => {
  for (const tool of ["eraser", "strokeEraser"]) {
    const app = harness({ tool });
    const down = pointer(1, "touch", "pointerdown");
    app.automaticTouchDown(down);
    app.handlePointerDown(down);
    assert.equal(down.boardTouchHandled, undefined);
    assert.equal(app.currentInputPointerId, 1);
    assert.equal(app.automaticTouchSession.phase, "ink");
    if (tool === "strokeEraser") assert.equal(app.eraserStarts, 1);
    else assert.equal(app.visibleInkFrames, 1);

    const move = pointer(1, "touch", "pointermove", 120, 110);
    app.automaticTouchMove(move);
    app.handlePointerMove(move);
    assert.equal(move.boardTouchHandled, undefined);
    if (tool === "strokeEraser") assert.equal(app.eraserMoves, 1);
    else assert.deepEqual(app.drawMoves, [1]);

    app.automaticTouchEnd(pointer(1, "touch", "pointerup", 120, 110));
    app.handlePointerEnd(pointer(1, "touch", "pointerup", 120, 110));
    assert.equal(app.currentInputPointerId, null);
    assert.equal(app.automaticTouchSession, null);
  }
});

test("a timely second touch discards only the provisional stroke and preserves undo history", () => {
  const app = harness();
  const first = pointer(1, "touch", "pointerdown", 100, 100);
  app.automaticTouchDown(first);
  app.handlePointerDown(first);
  assert.equal(app.visibleInkFrames, 1);
  assert.ok(app.canvas.hasPointerCapture(1));
  app.activeStroke = { points: [{ x: 100, y: 100 }, { x: 105, y: 104 }] };
  app.strokes.push({ id: "before" });
  const committed = app.strokes.slice();
  const undo = app.undoSnapshots.slice();

  app.currentTime(1050);
  const second = pointer(2, "touch", "pointerdown", 140, 100);
  app.automaticTouchDown(second);
  app.handlePointerDown(second);
  assert.equal(app.automaticTouchSession.phase, "navigation");
  assert.equal(second.boardTouchHandled, true);
  assert.equal(app.drawing, false);
  assert.equal(app.activeStroke, null);
  assert.deepEqual(app.strokes, committed);
  assert.deepEqual(app.undoSnapshots, undo);
  assert.equal(app.redrawCount, 1);
  assert.ok(app.canvas.hasPointerCapture(1));
  assert.ok(app.canvas.hasPointerCapture(2));
});

test("touch join window uses event timestamps when both are available", () => {
  const delayedDispatch = harness();
  const first = pointer(1, "touch", "pointerdown", 100, 100);
  first.timeStamp = 10000;
  delayedDispatch.automaticTouchDown(first);
  delayedDispatch.currentTime(1180);
  const second = pointer(2, "touch", "pointerdown", 140, 100);
  second.timeStamp = 10030;
  delayedDispatch.automaticTouchDown(second);
  assert.equal(delayedDispatch.automaticTouchSession.phase, "navigation");

  const latePhysicalTouch = harness();
  const lateFirst = pointer(1, "touch", "pointerdown", 100, 100);
  lateFirst.timeStamp = 20000;
  latePhysicalTouch.automaticTouchDown(lateFirst);
  latePhysicalTouch.currentTime(1030);
  const lateSecond = pointer(2, "touch", "pointerdown", 140, 100);
  lateSecond.timeStamp = 20180;
  latePhysicalTouch.automaticTouchDown(lateSecond);
  assert.equal(latePhysicalTouch.automaticTouchSession.phase, "ink");

  const outOfOrder = harness();
  const orderedFirst = pointer(1, "touch", "pointerdown", 100, 100);
  orderedFirst.timeStamp = 30000;
  outOfOrder.automaticTouchDown(orderedFirst);
  outOfOrder.currentTime(1030);
  const orderedSecond = pointer(2, "touch", "pointerdown", 140, 100);
  orderedSecond.timeStamp = 29999;
  outOfOrder.automaticTouchDown(orderedSecond);
  assert.equal(outOfOrder.automaticTouchSession.phase, "ink");
});

test("event timestamp fallback and movement lock keep existing join constraints", () => {
  const fallback = harness();
  fallback.automaticTouchDown(pointer(1, "touch", "pointerdown", 100, 100));
  fallback.currentTime(1050);
  fallback.automaticTouchDown(pointer(2, "touch", "pointerdown", 140, 100));
  assert.equal(fallback.automaticTouchSession.phase, "navigation");

  const moved = harness();
  const first = pointer(1, "touch", "pointerdown", 100, 100);
  first.timeStamp = 40000;
  moved.automaticTouchDown(first);
  moved.automaticTouchMove(pointer(1, "touch", "pointermove", 110, 100));
  const second = pointer(2, "touch", "pointerdown", 140, 100);
  second.timeStamp = 40020;
  moved.automaticTouchDown(second);
  assert.equal(moved.automaticTouchSession.phase, "ink");
  assert.equal(moved.currentInputPointerId, null);
  assert.equal(second.boardTouchHandled, true);
});

test("blur, cancellation, and stroke erasing finish the established owner before blocking survivors", () => {
  const ink = harness({
    currentInputPointerId: 1, drawing: true,
    automaticTouchSession: { phase: "ink", ownerId: 1, contacts: new Map([[1, { point: { x: 100, y: 100 } }]]), changed: false },
  });
  ink.resetAutomaticTouchSession();
  assert.deepEqual(ink.stopTypes, ["pointercancel"]);
  assert.equal(ink.currentInputPointerId, null);
  assert.equal(ink.drawing, false);
  assert.equal(ink.automaticTouchBlockedPointers.has(1), true);
  ink.resetAutomaticTouchSession();
  assert.deepEqual(ink.stopTypes, ["pointercancel"]);

  const eraser = harness({
    currentInputPointerId: 2, strokeEraserActive: true, strokeEraserPointerId: 2,
    automaticTouchSession: { phase: "ink", ownerId: 2, contacts: new Map([[2, { point: { x: 10, y: 10 } }]]), changed: false },
  });
  eraser.automaticTouchEnd(pointer(2, "touch", "pointercancel"));
  assert.deepEqual(eraser.eraserStops, ["pointercancel"]);
  assert.equal(eraser.currentInputPointerId, null);
  assert.equal(eraser.automaticTouchSession, null);
});

test("terminal cancellation preserves provisional ink even after the join window", () => {
  for (const elapsed of [0, 500]) {
    const app = harness({
      currentInputPointerId: 1, drawing: true, activeStroke: { points: [{ x: 100, y: 100 }] },
      automaticTouchSession: {
        phase: "provisional", ownerId: 1, startedAt: 1000, origin: { x: 100, y: 100 },
        maxMovement: 0, contacts: new Map([[1, { point: { x: 100, y: 100 } }]]), changed: false,
      },
    });
    app.currentTime(1000 + elapsed);
    if (elapsed === 0) app.automaticTouchEnd(pointer(1, "touch", "pointercancel"));
    else app.resetAutomaticTouchSession();
    assert.deepEqual(app.stopTypes, ["pointercancel"]);
    assert.equal(app.redrawCount, 0);
    assert.equal(app.currentInputPointerId, null);
    assert.equal(app.drawing, false);
  }
});

test("released contacts clear outside-canvas suppression and a fresh primary touch recovers a missed release", () => {
  const app = harness();
  app.automaticTouchBlockedPointers.add(7);
  app.releaseAutomaticTouchBlockedPointer(pointer(7, "touch", "pointerup"));
  assert.equal(app.automaticTouchBlockedPointers.size, 0);

  app.automaticTouchBlockedPointers.add(8);
  const next = pointer(9, "touch", "pointerdown");
  next.isPrimary = true;
  app.automaticTouchDown(next);
  assert.equal(app.automaticTouchBlockedPointers.size, 0);
  assert.equal(app.automaticTouchSession.ownerId, 9);
  assert.equal(app.automaticTouchSession.phase, "provisional");
  assert.equal(next.boardTouchHandled, undefined);
});

test("coalesced out-and-back motion permanently locks the first touch to ink", () => {
  const app = harness();
  const first = pointer(1, "touch", "pointerdown", 100, 100);
  app.automaticTouchDown(first);
  app.handlePointerDown(first);
  const outAndBack = pointer(1, "touch", "pointermove", 100, 100);
  outAndBack.getCoalescedEvents = () => [{ clientX: 120, clientY: 100 }];
  app.automaticTouchMove(outAndBack);
  app.handlePointerMove(outAndBack);
  assert.equal(app.automaticTouchSession.phase, "ink");
  const second = pointer(2, "touch", "pointerdown", 140, 100);
  app.automaticTouchDown(second);
  assert.equal(app.automaticTouchSession.phase, "ink");
  assert.equal(app.currentInputPointerId, 1);
  assert.equal(second.boardTouchHandled, true);
});

test("navigation lock lets the first multi-touch contact begin ink immediately", () => {
  const app = harness({ navModeLocked: true });
  const first = pointer(1, "touch", "pointerdown");
  app.automaticTouchDown(first);
  app.handlePointerDown(first);
  assert.equal(first.boardTouchHandled, undefined);
  assert.equal(first.prevented, undefined);
  assert.equal(app.automaticTouchSession, null);
  assert.equal(app.currentInputPointerId, 1);
  assert.equal(app.drawing, true);

  const second = pointer(2, "touch", "pointerdown", 140, 100);
  app.automaticTouchDown(second);
  app.handlePointerDown(second);
  assert.equal(second.boardTouchHandled, undefined);
  assert.equal(app.currentInputPointerId, 1);
  assert.equal(app.drawing, true);
});

test("queued automatic navigation frame cannot move camera after locking", () => {
  let cameraApplications = 0;
  const app = harness({
    navModeLocked: true,
    automaticTouchFrame: 12,
    automaticTouchSession: {
      phase: "navigation", changed: false,
      pair: { ids: [1, 2], initialCenter: { x: 120, y: 100 }, initialSeparation: 40, anchor: { x: 120, y: 100 }, startCamera: { x: 0, y: 0, scale: 1 }, mode: "pan" },
      contacts: new Map([[1, { point: { x: 130, y: 100 } }], [2, { point: { x: 170, y: 100 } }]]),
    },
    applyBoardCamera() { cameraApplications += 1; },
  });
  app.applyAutomaticTouchNavigation();
  assert.equal(app.boardCamera.x, 0);
  assert.equal(app.boardCamera.y, 0);
  assert.equal(app.boardCamera.scale, 1);
  assert.equal(cameraApplications, 0);
  assert.equal(app.automaticTouchFrame, 0);
});

test("navigation redraws on the return frame and ignored third contacts cannot become ink", () => {
  let cameraApplications = 0;
  const app = harness({ applyBoardCamera() { cameraApplications += 1; } });
  app.automaticTouchDown(pointer(1, "touch", "pointerdown", 100, 100));
  app.handlePointerDown(pointer(1, "touch", "pointerdown", 100, 100));
  app.currentTime(1050);
  app.automaticTouchDown(pointer(2, "touch", "pointerdown", 140, 100));
  app.handlePointerDown(pointer(2, "touch", "pointerdown", 140, 100));

  app.automaticTouchMove(pointer(1, "touch", "pointermove", 130, 100));
  app.automaticTouchMove(pointer(2, "touch", "pointermove", 170, 100));
  app.applyAutomaticTouchNavigation();
  assert.equal(app.boardCamera.x, 30);
  app.automaticTouchMove(pointer(1, "touch", "pointermove", 100, 100));
  app.automaticTouchMove(pointer(2, "touch", "pointermove", 140, 100));
  app.applyAutomaticTouchNavigation();
  assert.equal(app.boardCamera.x, 0);
  assert.equal(cameraApplications, 2);

  const third = pointer(3, "touch", "pointerdown", 300, 300);
  app.automaticTouchDown(third);
  assert.equal(third.boardTouchHandled, true);
  app.automaticTouchEnd(pointer(3, "touch", "pointerup"));
  assert.equal(app.automaticTouchSession.phase, "navigation");
  assert.equal(app.currentInputPointerId, null);
});
