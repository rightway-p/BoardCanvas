const assert = require("node:assert");
const fs = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../js/session-pdf-toolbar.js"), "utf8");
const sessionSource = source.slice(source.indexOf("function setSessionPersistenceHeld"), source.indexOf("function getAnnotatedPdfFileName"));

function createRestoreHarness({ rawSnapshot = null, pdfBytes = null, loadResult = true, renderResult = true } = {}) {
  const storage = { value: rawSnapshot };
  const pdfStore = { value: pdfBytes ? new Uint8Array(pdfBytes) : null };
  const statuses = [];
  const calls = [];
  const context = {
    window: {
      localStorage: {
        getItem: () => storage.value,
        setItem: (_key, value) => { storage.value = value; },
      },
      clearTimeout() {},
      setTimeout() { return 1; },
    },
    SESSION_STORAGE_KEY: "board.session",
    SESSION_STORAGE_VERSION: 1,
    SESSION_AUTOSAVE_DELAY_MS: 1,
    Uint8Array,
    normalizeStrokeCollection: (value) => Array.isArray(value) ? value.map((stroke) => ({ ...stroke })) : [],
    normalizeHexColor: (value) => value,
    cloneStrokeCollection: (value) => Array.isArray(value) ? value.map((stroke) => ({ ...stroke })) : [],
    BoardState: { createPageSequence: () => [{ kind: "blank", strokes: [], background: "#ffffff" }] },
    boardStrokeSnapshot: [],
    pdfPageStrokeSnapshots: new Map(),
    boardPageSequence: [{ kind: "blank", strokes: [], background: "#ffffff" }],
    boardPageIndex: 0,
    sessionRestoreInProgress: false,
    sessionPersistenceHeld: true,
    sessionAutosaveTimer: null,
    sessionPdfBytesDirty: false,
    loadedPdfBytes: null,
    loadedDocumentName: "",
    pdfDocument: null,
    pdfPageNumber: 1,
    pdfPageRasterCanvas: null,
    backgroundCanvas: { width: 800, height: 600 },
    pageStructureUndo: [],
    pageStructureRedo: [],
    updateUndoRedoUI() {},
    updatePdfNavigationUI() {},
    saveCurrentStrokeState() {},
    restoreCurrentStrokeState() {},
    clearAllStrokeHistory() {},
    fitCurrentBoardPage() { calls.push("fit"); },
    setDocumentStatus(message, tone) { statuses.push({ message, tone }); },
    hasLoadedPdfDocument() { return Boolean(context.pdfDocument?.numPages > 0); },
    loadSessionPdfBytes: async () => { calls.push("load-pdf-bytes"); return pdfStore.value && new Uint8Array(pdfStore.value); },
    saveSessionPdfBytes: async (bytes) => { calls.push("save-pdf-bytes"); pdfStore.value = new Uint8Array(bytes); return true; },
    clearSessionPdfBytes: async () => { calls.push("clear-pdf-bytes"); pdfStore.value = null; return true; },
    File: class TestFile { constructor(parts, name, options) { this.parts = parts; this.name = name; this.options = options; } },
    loadPdfFromFile: async (file) => {
      calls.push("load-pdf");
      if (!loadResult) return false;
      context.loadedPdfBytes = pdfStore.value;
      context.loadedDocumentName = file.name;
      context.pdfDocument = { numPages: 1 };
      context.boardPageSequence = [{ kind: "pdf", pdfPage: 1, strokes: [] }];
      return true;
    },
    renderBoardPage: async (index) => {
      calls.push(`render-board-${index}`);
      await Promise.resolve();
      if (renderResult) context.pdfPageRasterCanvas = { rendered: true };
    },
    renderPdfPage: async (pageNumber) => {
      calls.push(`render-pdf-${pageNumber}`);
      await Promise.resolve();
      if (renderResult) context.pdfPageRasterCanvas = { rendered: true };
    },
  };
  vm.createContext(context);
  vm.runInContext(sessionSource, context);
  return { context, storage, pdfStore, statuses, calls };
}

function snapshot(overrides = {}) {
  return JSON.stringify({
    version: 1,
    hasPdf: false,
    boardStrokes: [{ id: "stroke" }],
    pdfPages: [],
    boardPageIndex: 0,
    pageSequence: [{ kind: "blank", background: "#ffffff", strokes: [{ id: "stroke" }] }],
    ...overrides,
  });
}

test("no cached snapshot is a valid empty initial restore", async () => {
  const { context } = createRestoreHarness();

  assert.deepEqual(await context.restoreSessionState(), { success: true, pdfSuccess: true, hadSnapshot: false });
});

test("an existing blank-board snapshot restores successfully", async () => {
  const { context } = createRestoreHarness({ rawSnapshot: snapshot() });

  assert.deepEqual(await context.restoreSessionState(), { success: true, pdfSuccess: true, hadSnapshot: true });
  assert.equal(context.boardStrokeSnapshot[0].id, "stroke");
});

test("malformed cached content fails without overwriting the original", async () => {
  const rawSnapshot = "{malformed-cache";
  const { context, storage, pdfStore, calls, statuses } = createRestoreHarness({ rawSnapshot, pdfBytes: new Uint8Array([7, 8, 9]) });

  assert.deepEqual(await context.restoreSessionState(), { success: false, pdfSuccess: false, hadSnapshot: true });
  assert.equal(storage.value, rawSnapshot);
  assert.equal(await context.persistSessionState(), false);
  assert.equal(storage.value, rawSnapshot);
  assert.deepEqual([...pdfStore.value], [7, 8, 9]);
  assert.deepEqual(calls, []);
  assert.match(statuses.at(-1).message, /저장.*일시 중지.*원본/);
});

test("missing cached PDF bytes fails without replacing the original cache", async () => {
  const rawSnapshot = snapshot({ hasPdf: true, loadedDocumentName: "source.pdf", pageSequence: [{ kind: "pdf", pdfPage: 1, strokes: [] }] });
  const { context, storage, calls } = createRestoreHarness({ rawSnapshot });

  assert.deepEqual(await context.restoreSessionState(), { success: false, pdfSuccess: false, hadSnapshot: true });
  assert.equal(storage.value, rawSnapshot);
  assert.deepEqual(calls, ["load-pdf-bytes"]);
});

test("missing cached PDF bytes cannot clear the original cache on a later persist", async () => {
  const rawSnapshot = snapshot({ hasPdf: true, loadedDocumentName: "source.pdf", pageSequence: [{ kind: "pdf", pdfPage: 1, strokes: [] }] });
  const { context, storage, pdfStore, calls } = createRestoreHarness({ rawSnapshot });

  await context.restoreSessionState();
  assert.equal(await context.persistSessionState(), false);
  assert.equal(storage.value, rawSnapshot);
  assert.equal(pdfStore.value, null);
  assert.deepEqual(calls, ["load-pdf-bytes"]);
});

test("a held fresh startup cannot create an empty cache before recovery is decided", async () => {
  const { context, storage, calls } = createRestoreHarness();

  assert.deepEqual(await context.restoreSessionState(), { success: true, pdfSuccess: true, hadSnapshot: false });
  assert.equal(await context.persistSessionState(), false);
  assert.equal(storage.value, null);
  assert.deepEqual(calls, []);
});

test("an explicitly released successful fresh startup can persist", async () => {
  const { context, storage, calls } = createRestoreHarness();

  await context.restoreSessionState();
  context.setSessionPersistenceHeld(false);
  assert.equal(await context.persistSessionState(), true);
  assert.notEqual(storage.value, null);
  assert.deepEqual(calls, ["clear-pdf-bytes"]);
});

test("an explicitly released successful blank-board restore can persist", async () => {
  const { context, storage, calls } = createRestoreHarness({ rawSnapshot: snapshot() });

  await context.restoreSessionState();
  context.setSessionPersistenceHeld(false);
  assert.equal(await context.persistSessionState(), true);
  assert.notEqual(storage.value, null);
  assert.deepEqual(calls, ["clear-pdf-bytes"]);
});

test("an explicitly released successful PDF restore can persist", async () => {
  const rawSnapshot = snapshot({ hasPdf: true, loadedDocumentName: "source.pdf", pageSequence: [{ kind: "pdf", pdfPage: 1, strokes: [] }] });
  const { context, storage, pdfStore, calls } = createRestoreHarness({ rawSnapshot, pdfBytes: new Uint8Array([1, 2, 3]) });

  await context.restoreSessionState();
  context.setSessionPersistenceHeld(false);
  context.sessionPdfBytesDirty = true;
  assert.equal(await context.persistSessionState(), true);
  assert.notEqual(storage.value, null);
  assert.deepEqual([...pdfStore.value], [1, 2, 3]);
  assert.deepEqual(calls, ["load-pdf-bytes", "load-pdf", "render-board-0", "save-pdf-bytes"]);
});

test("failed PDF loading withholds successful restoration", async () => {
  const rawSnapshot = snapshot({ hasPdf: true, loadedDocumentName: "source.pdf", pageSequence: [{ kind: "pdf", pdfPage: 1, strokes: [] }] });
  const { context, storage } = createRestoreHarness({ rawSnapshot, pdfBytes: new Uint8Array([1, 2, 3]), loadResult: false });

  assert.deepEqual(await context.restoreSessionState(), { success: false, pdfSuccess: false, hadSnapshot: true });
  assert.equal(storage.value, rawSnapshot);
});

test("a canceled final PDF render fails the actual restore result", async () => {
  const rawSnapshot = snapshot({ hasPdf: true, loadedDocumentName: "source.pdf", pageSequence: [{ kind: "pdf", pdfPage: 1, strokes: [] }] });
  const { context, calls } = createRestoreHarness({ rawSnapshot, pdfBytes: new Uint8Array([1, 2, 3]), renderResult: false });

  assert.deepEqual(await context.restoreSessionState(), { success: false, pdfSuccess: false, hadSnapshot: true });
  assert.deepEqual(calls, ["load-pdf-bytes", "load-pdf", "render-board-0"]);
});

test("a PDF restore waits for and validates the actual final render", async () => {
  const rawSnapshot = snapshot({ hasPdf: true, loadedDocumentName: "source.pdf", pageSequence: [{ kind: "pdf", pdfPage: 1, strokes: [] }] });
  const { context, calls } = createRestoreHarness({ rawSnapshot, pdfBytes: new Uint8Array([1, 2, 3]) });

  assert.deepEqual(await context.restoreSessionState(), { success: true, pdfSuccess: true, hadSnapshot: true });
  assert.deepEqual(calls, ["load-pdf-bytes", "load-pdf", "render-board-0"]);
});
