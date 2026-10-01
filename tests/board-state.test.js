const test = require("node:test");
const assert = require("node:assert/strict");
const boardState = require("../js/domain/board-state.js");

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
