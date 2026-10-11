const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const BoardState = require("../js/domain/board-state.js");

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
  const captures = new Set();
  const canvas = {
    setPointerCapture(id) { captures.add(id); },
    hasPointerCapture(id) { return captures.has(id); },
    releasePointerCapture(id) { captures.delete(id); },
  };
  const context = {
    boardInteractionMode: "multi", automaticTouchSession: null, automaticTouchBlockedPointers: new Set(), automaticTouchFrame: 0,
    currentInputPointerId: null, drawing: false, hasStrokeMoved: false, strokeEraserActive: false, strokeEraserPointerId: null,
    tool: "pen", overlayMousePassthrough: false, panMode: false, devSettings: BoardState.normalizeAutomaticTouchSettings({}),
    BoardState, canvas, boardWrapper: { getBoundingClientRect: () => ({ left: 0, top: 0 }) }, boardCamera: { x: 0, y: 0, scale: 1 },
    window: { requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} }, performance: { now: () => now },
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
    strokes: [{ id: "committed" }], undoSnapshots: ["before"], activeStroke: null, lastPoint: null, lastMidPoint: null, filteredPoint: null,
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
