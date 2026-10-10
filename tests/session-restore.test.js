const assert = require("node:assert");
const fs = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../js/session-pdf-toolbar.js"), "utf8");
const sessionSource = source.slice(source.indexOf("function setSessionPersistenceHeld"), source.indexOf("function getAnnotatedPdfFileName"));

function serializedLocks() {
  let tail = Promise.resolve();
  return { request(_name, _options, callback) {
    const pending = tail.then(callback);
    tail = pending.catch(() => {});
    return pending;
  } };
}

function createRestoreHarness({ rawSnapshot = null, pdfBytes = null, loadResult = true, renderResult = true, storage: sharedStorage, pdfStore: sharedPdfStore, persistence: sharedPersistence, locks = serializedLocks() } = {}) {
  const storage = sharedStorage || { value: rawSnapshot };
  const pdfStore = sharedPdfStore || { value: pdfBytes ? new Uint8Array(pdfBytes) : null };
  const statuses = [];
  const calls = [];
  const persistence = sharedPersistence || { backup: null, update: null, gate: null, failRestore: false, failUpdate: false };
  const context = {
    navigator: { locks },
    window: {
      localStorage: {
        getItem: () => {
          if (storage.mismatchReadOnce) {
            storage.mismatchReadOnce = false;
            return "unexpected-readback";
          }
          return storage.value;
        },
        setItem: (key, value) => {
          if (storage.failNextWrite) {
            storage.failNextWrite = false;
            throw new Error("quota");
          }
          storage.value = value;
          if (storage.mismatchAfterWrite) {
            storage.mismatchAfterWrite = false;
            storage.mismatchReadOnce = true;
          }
        },
        removeItem: () => { storage.value = null; },
      },
      clearTimeout() {},
      setTimeout() { return 1; },
    },
    SESSION_STORAGE_KEY: "board.session.state.v1",
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
    sessionPersistenceQueue: Promise.resolve(),
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
      context.loadedPdfBytes = new Uint8Array(file.parts[0]);
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
  context.recoverPendingSessionWrite = async (forceRollback = false) => {
    if (persistence.failRestore && persistence.backup) return false;
    if (persistence.backup && (forceRollback || !persistence.backup.committed)) {
      storage.value = persistence.backup.rawSnapshot;
      pdfStore.value = persistence.backup.pdfBytes && new Uint8Array(persistence.backup.pdfBytes);
      persistence.backup = null;
    } else if (persistence.backup && !forceRollback) {
      persistence.backup = null;
    }
    return true;
  };
  context.updateSessionPdfBytesWithBackup = async (rawSnapshot, bytes) => {
    calls.push(bytes ? "save-pdf-bytes" : "clear-pdf-bytes");
    if (persistence.failUpdate) return false;
    persistence.backup = {
      rawSnapshot,
      pdfBytes: pdfStore.value && new Uint8Array(pdfStore.value),
      committed: false
    };
    pdfStore.value = bytes && new Uint8Array(bytes);
    persistence.update?.();
    if (persistence.gate) await persistence.gate;
    return true;
  };
  context.markSessionWriteCommitted = async () => {
    if (persistence.backup) persistence.backup.committed = true;
    return true;
  };
  return { context, storage, pdfStore, statuses, calls, persistence };
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

function setPdfState(context, bytes, name) {
  context.loadedPdfBytes = bytes ? new Uint8Array(bytes) : null;
  context.sessionPdfBytesDirty = Boolean(bytes);
  context.loadedDocumentName = bytes ? name : "";
  context.pdfDocument = bytes ? { numPages: 1 } : null;
  context.pdfPageNumber = 1;
  context.boardPageSequence = bytes
    ? [{ kind: "pdf", pdfPage: 1, strokes: [] }]
    : [{ kind: "blank", background: "#ffffff", strokes: [] }];
  context.boardPageIndex = 0;
}

function enablePersistence(context) {
  context.setSessionPersistenceHeld(false);
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

test("a queued replacement PDF cannot inherit the earlier PDF byte save", async () => {
  const oldRaw = snapshot({ hasPdf: true, loadedDocumentName: "old.pdf" });
  const { context, storage, pdfStore, calls, persistence } = createRestoreHarness({ rawSnapshot: oldRaw, pdfBytes: [1] });
  enablePersistence(context);
  setPdfState(context, [2], "first.pdf");

  let started;
  const reachedUpdate = new Promise((resolve) => { started = resolve; });
  let release;
  persistence.gate = new Promise((resolve) => { release = resolve; });
  persistence.update = () => { persistence.update = null; started(); };
  const firstSave = context.persistSessionState();
  await reachedUpdate;
  setPdfState(context, [3], "second.pdf");
  const secondSave = context.persistSessionState();
  release();

  assert.equal(await firstSave, false);
  assert.equal(await secondSave, true);
  assert.equal(JSON.parse(storage.value).loadedDocumentName, "second.pdf");
  assert.deepEqual([...pdfStore.value], [3]);
  assert.equal(context.sessionPdfBytesDirty, false);
  assert.deepEqual(calls, ["save-pdf-bytes", "save-pdf-bytes"]);
});

test("a queued blank-board save rolls back the earlier PDF write before clearing bytes", async () => {
  const oldRaw = snapshot({ hasPdf: true, loadedDocumentName: "old.pdf" });
  const { context, storage, pdfStore, persistence } = createRestoreHarness({ rawSnapshot: oldRaw, pdfBytes: [1] });
  enablePersistence(context);
  setPdfState(context, [2], "first.pdf");

  let started;
  const reachedUpdate = new Promise((resolve) => { started = resolve; });
  let release;
  persistence.gate = new Promise((resolve) => { release = resolve; });
  persistence.update = () => { persistence.update = null; started(); };
  const firstSave = context.persistSessionState();
  await reachedUpdate;
  setPdfState(context, null, "");
  const blankSave = context.persistSessionState();
  release();

  assert.equal(await firstSave, false);
  assert.equal(await blankSave, true);
  assert.equal(JSON.parse(storage.value).hasPdf, false);
  assert.equal(pdfStore.value, null);
});

test("a localStorage quota failure rolls a staged PDF replacement back to the old pair", async () => {
  const oldRaw = snapshot({ hasPdf: true, loadedDocumentName: "old.pdf" });
  const { context, storage, pdfStore } = createRestoreHarness({ rawSnapshot: oldRaw, pdfBytes: [1, 2] });
  enablePersistence(context);
  setPdfState(context, [8, 9], "new.pdf");
  storage.failNextWrite = true;

  assert.equal(await context.persistSessionState(), false);
  assert.equal(storage.value, oldRaw);
  assert.deepEqual([...pdfStore.value], [1, 2]);
  assert.equal(context.sessionPdfBytesDirty, true);
});

test("a read-after-write mismatch rolls back both snapshot and PDF bytes", async () => {
  const oldRaw = snapshot({ hasPdf: true, loadedDocumentName: "old.pdf" });
  const { context, storage, pdfStore } = createRestoreHarness({ rawSnapshot: oldRaw, pdfBytes: [1, 2] });
  enablePersistence(context);
  setPdfState(context, [8, 9], "new.pdf");
  storage.mismatchAfterWrite = true;

  assert.equal(await context.persistSessionState(), false);
  assert.equal(storage.value, oldRaw);
  assert.deepEqual([...pdfStore.value], [1, 2]);
});

test("an IndexedDB write failure leaves the previous pair untouched", async () => {
  const oldRaw = snapshot({ hasPdf: true, loadedDocumentName: "old.pdf" });
  const { context, storage, pdfStore, persistence } = createRestoreHarness({ rawSnapshot: oldRaw, pdfBytes: [1, 2] });
  enablePersistence(context);
  setPdfState(context, [8, 9], "new.pdf");
  persistence.failUpdate = true;

  assert.equal(await context.persistSessionState(), false);
  assert.equal(storage.value, oldRaw);
  assert.deepEqual([...pdfStore.value], [1, 2]);
  assert.equal(context.sessionPdfBytesDirty, true);
});

test("a blank-board snapshot failure restores the cached PDF bytes", async () => {
  const oldRaw = snapshot({ hasPdf: true, loadedDocumentName: "old.pdf" });
  const { context, storage, pdfStore } = createRestoreHarness({ rawSnapshot: oldRaw, pdfBytes: [1, 2] });
  enablePersistence(context);
  setPdfState(context, null, "");
  storage.failNextWrite = true;

  assert.equal(await context.persistSessionState(), false);
  assert.equal(storage.value, oldRaw);
  assert.deepEqual([...pdfStore.value], [1, 2]);
});

test("a failed rollback warns once, holds persistence, and retains its old-pair backup", async () => {
  const oldRaw = snapshot({ hasPdf: true, loadedDocumentName: "old.pdf" });
  const { context, storage, pdfStore, calls, persistence, statuses } = createRestoreHarness({ rawSnapshot: oldRaw, pdfBytes: [1, 2] });
  enablePersistence(context);
  setPdfState(context, [8, 9], "new.pdf");
  storage.failNextWrite = true;
  persistence.failRestore = true;

  assert.equal(await context.persistSessionState(), false);
  assert.equal(context.sessionPersistenceHeld, true);
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].tone, "warning");
  assert.match(statuses[0].message, /캐시 저장을 일시 중지.*백업을 보존/);
  assert.notEqual(persistence.backup, null);
  const writesBeforeRetry = calls.filter((call) => call === "save-pdf-bytes").length;
  assert.equal(await context.persistSessionState(), false);
  assert.equal(statuses.length, 1);
  assert.equal(statuses.some(({ tone }) => tone === "success"), false);
  assert.equal(calls.filter((call) => call === "save-pdf-bytes").length, writesBeforeRetry);
  assert.equal(storage.value, oldRaw);
  assert.deepEqual([...pdfStore.value], [8, 9]);
});

test("two contexts serialize pending save and committed-backup cleanup", async () => {
  const locks = serializedLocks();
  const storage = { value: snapshot({ hasPdf: true, loadedDocumentName: "old.pdf" }) };
  const pdfStore = { value: new Uint8Array([1]) };
  const persistence = { backup: null, update: null, gate: null, failRestore: false, failUpdate: false };
  const first = createRestoreHarness({ storage, pdfStore, persistence, locks });
  const second = createRestoreHarness({ storage, pdfStore, persistence, locks });
  enablePersistence(first.context);
  enablePersistence(second.context);
  setPdfState(first.context, [2], "first.pdf");
  setPdfState(second.context, [3], "second.pdf");

  let started;
  const staged = new Promise((resolve) => { started = resolve; });
  let release;
  first.persistence.gate = new Promise((resolve) => { release = resolve; });
  first.persistence.update = () => { first.persistence.update = null; started(); };
  const firstSave = first.context.persistSessionState();
  await staged;
  const secondSave = second.context.persistSessionState();
  release();

  assert.equal(await firstSave, true);
  assert.equal(await secondSave, true);
  assert.equal(JSON.parse(storage.value).loadedDocumentName, "second.pdf");
  assert.deepEqual([...pdfStore.value], [3]);
  assert.equal(first.persistence.backup.committed, true);
  assert.equal(JSON.parse(first.persistence.backup.rawSnapshot).loadedDocumentName, "first.pdf");
  assert.deepEqual([...first.persistence.backup.pdfBytes], [2]);
});

test("a clean PDF save stages its captured bytes after another context swaps the cache", async () => {
  const locks = serializedLocks();
  const storage = { value: snapshot({ hasPdf: true, loadedDocumentName: "old.pdf" }) };
  const pdfStore = { value: new Uint8Array([1]) };
  const writer = createRestoreHarness({ storage, pdfStore, locks });
  const clean = createRestoreHarness({ storage, pdfStore, locks });
  enablePersistence(writer.context);
  enablePersistence(clean.context);
  setPdfState(writer.context, [2], "writer.pdf");
  setPdfState(clean.context, [1], "clean.pdf");
  assert.equal(await writer.context.persistSessionState(), true);
  clean.context.sessionPdfBytesDirty = false;

  assert.equal(await clean.context.persistSessionState(), true);
  assert.equal(JSON.parse(storage.value).loadedDocumentName, "clean.pdf");
  assert.deepEqual([...pdfStore.value], [1]);
});

test("missing or rejected Web Locks access holds persistence and preserves the cache", async () => {
  const rawSnapshot = snapshot({ hasPdf: true, loadedDocumentName: "original.pdf" });
  const { context, storage, pdfStore, statuses } = createRestoreHarness({ rawSnapshot, pdfBytes: [1] });
  enablePersistence(context);
  setPdfState(context, [2], "new.pdf");
  context.navigator.locks = undefined;

  assert.equal(await context.persistSessionState(), false);
  assert.equal(context.sessionPersistenceHeld, true);
  assert.equal(storage.value, rawSnapshot);
  assert.deepEqual([...pdfStore.value], [1]);
  assert.equal(statuses.filter(({ tone }) => tone === "warning").length, 1);
  assert.equal(await context.persistSessionState(), false);
  assert.equal(statuses.filter(({ tone }) => tone === "warning").length, 1);

  const rejected = createRestoreHarness({ rawSnapshot, pdfBytes: [1], locks: { request: async () => { throw new Error("lock rejected"); } } });
  assert.deepEqual(await rejected.context.restoreSessionState(), { success: false, pdfSuccess: false, hadSnapshot: true });
  assert.equal(rejected.context.sessionRestoreInProgress, false);
  assert.equal(rejected.storage.value, rawSnapshot);
  assert.deepEqual([...rejected.pdfStore.value], [1]);
  assert.equal(rejected.statuses.filter(({ tone }) => tone === "warning").length, 1);
});

test("restore reads the JSON/PDF pair under lock and releases it before rendering", { timeout: 2000 }, async () => {
  let releaseRead;
  let releaseRender;
  let enteredLock;
  let enteredRender;
  const entered = new Promise((resolve) => { enteredLock = resolve; });
  const renderEntered = new Promise((resolve) => { enteredRender = resolve; });
  const renderGate = new Promise((resolve) => { releaseRender = resolve; });
  const baseLocks = serializedLocks();
  let firstLock = true;
  const locks = { request(name, options, callback) {
    return baseLocks.request(name, options, async () => {
      if (firstLock) {
        firstLock = false;
        enteredLock();
        await new Promise((resolve) => { releaseRead = resolve; });
      }
      return callback();
    });
  } };
  const rawSnapshot = snapshot({ hasPdf: true, loadedDocumentName: "paired.pdf", pageSequence: [{ kind: "pdf", pdfPage: 1, strokes: [] }] });
  const storage = { value: rawSnapshot };
  const pdfStore = { value: new Uint8Array([4, 5]) };
  const { context, calls } = createRestoreHarness({ storage, pdfStore, locks });
  const writer = createRestoreHarness({ storage, pdfStore, locks });
  enablePersistence(writer.context);
  setPdfState(writer.context, [8, 9], "writer.pdf");
  let renderStarted = false;
  context.renderBoardPage = async () => { renderStarted = true; enteredRender(); await renderGate; context.pdfPageRasterCanvas = {}; };
  const restore = context.restoreSessionState();
  await entered;
  const save = writer.context.persistSessionState();
  await Promise.resolve();
  assert.equal(renderStarted, false);
  assert.deepEqual([...pdfStore.value], [4, 5]);
  releaseRead();
  await renderEntered;
  assert.equal(await save, true);
  assert.equal(JSON.parse(storage.value).loadedDocumentName, "writer.pdf");
  assert.deepEqual([...pdfStore.value], [8, 9]);
  releaseRender();
  assert.equal((await restore).success, true);
  assert.equal(renderStarted, true);
  assert.equal(context.loadedDocumentName, "paired.pdf");
  assert.deepEqual([...context.loadedPdfBytes], [4, 5]);
  assert.deepEqual(calls.slice(0, 2), ["load-pdf-bytes", "load-pdf"]);
});
