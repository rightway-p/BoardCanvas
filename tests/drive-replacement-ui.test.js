const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const boardState = require("../js/domain/board-state.js");

const root = path.join(__dirname, "..");
const uiSource = fs.readFileSync(path.join(root, "js/board-2.0.1-ui.js"), "utf8");

test("Drive replacement prompt stacks above Drive and focuses cancel", async () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const baseZ = Number(styles.match(/\.work-dialog\s*\{[^}]*z-index:\s*(\d+)/)?.[1]);
  const replacementZ = Number(styles.match(/#replaceWorkDialog\s*\{[^}]*z-index:\s*(\d+)/)?.[1]);
  assert.ok(replacementZ > baseZ);
  assert.ok(html.indexOf('id="replaceWorkDialog"') < html.indexOf('id="driveDialog"'));

  const trigger = { isConnected: true, hidden: false, closest: () => null, focused: false, focus() { this.focused = true; } };
  const cancel = { focused: false, focus() { this.focused = true; } };
  let revealed = false;
  const context = {
    document: { activeElement: trigger, getElementById: () => cancel },
    workReplacementManager: { hasPending: () => false, request: () => ({ accepted: true, promise: Promise.resolve(false) }) },
    replaceWorkDialog: { classList: { remove() { revealed = true; } } },
    finishActiveBoardInput() {}, saveCurrentStrokeState() {}, hasLoadedPdfDocument: () => true,
    boardPageSequence: [], setDocumentStatus() {},
  };
  vm.createContext(context);
  const focusSource = uiSource.slice(uiSource.indexOf("let replacementReturnFocus"), uiSource.indexOf("async function invokeDrive"));
  const requestSource = uiSource.slice(uiSource.indexOf("function requestBoardWorkReplacement"), uiSource.indexOf("let updaterFlow;"));
  vm.runInContext(`${focusSource}\n${requestSource}`, context);
  context.requestBoardWorkReplacement(async () => true);
  assert.equal(revealed, true);
  assert.equal(cancel.focused, true);
  context.restoreReplacementFocus();
  assert.equal(trigger.focused, true);
});

test("cancelling the Drive replacement prompt skips download and preserves current work and location", async () => {
  const status = { textContent: "" };
  const existingWork = { pages: 3, strokes: 5 };
  const driveState = { path: ["Shared with me", "Nested"] };
  const trigger = { isConnected: true, hidden: false, closest: () => null, focused: false, focus() { this.focused = true; } };
  const cancel = { focus() {}, addEventListener(name, listener) { if (name === "click") this.click = listener; } };
  let dialogVisible = false;
  let downloaded = false;
  let imported = false;
  const context = {
    document: { activeElement: trigger, getElementById: (id) => id === "driveStatus" ? status : id === "cancelReplaceButton" ? cancel : null },
    documentInput: { value: "stale" },
    replaceWorkDialog: { classList: { remove() { dialogVisible = true; }, add() { dialogVisible = false; } } },
    cancelReplaceButton: cancel,
    workReplacementManager: boardState.createReplacementManager(),
    invokeDrive: async (command) => { if (command === "drive_download_pdf") downloaded = true; return { size: 1, pdfBase64: "AQ==", name: "lesson.pdf", fileId: "pdf-1" }; },
    BoardState: { MAX_PDF_BYTES: 256 * 1024 * 1024, isByteLengthWithinLimit: () => true, isBase64WithinLimit: () => true },
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    File: class TestFile {},
    finishActiveBoardInput() {}, saveCurrentStrokeState() {}, hasLoadedPdfDocument: () => true,
    boardPageSequence: [{ strokes: [{ id: "ink" }] }], setDocumentStatus() {},
    loadPdfFromFile: async () => { existingWork.pages = 1; existingWork.strokes = 0; return true; },
    driveLoginFlow: { invalidate() { driveState.path = []; } },
    closeDocumentPopup() {}, openDocumentPopupButton: { focus() {} },
    driveDialogOpen: true,
  };
  vm.createContext(context);
  const focusSource = uiSource.slice(uiSource.indexOf("let replacementReturnFocus"), uiSource.indexOf("async function invokeDrive"));
  const requestSource = uiSource.slice(uiSource.indexOf("function requestBoardWorkReplacement"), uiSource.indexOf("let updaterFlow;"));
  const importSource = uiSource.slice(uiSource.indexOf("async function importDrivePdf"), uiSource.indexOf("async function clearActiveDrivePin"));
  const cancelHandler = uiSource.match(/cancelReplaceButton\.addEventListener\("click", \(\) => \{[^\n]+\);/)[0];
  vm.runInContext(`${focusSource}\n${requestSource}\n${importSource}\n${cancelHandler}`, context);
  const importPromise = context.importDrivePdf({ id: "pdf-1", name: "lesson.pdf" });
  assert.equal(dialogVisible, true);
  cancel.click();
  await importPromise;
  assert.equal(downloaded, false);
  assert.deepEqual(existingWork, { pages: 3, strokes: 5 });
  assert.deepEqual(driveState.path, ["Shared with me", "Nested"]);
  assert.equal(context.driveDialogOpen, true);
  assert.equal(dialogVisible, false);
  assert.equal(trigger.focused, true);
  assert.equal(status.textContent, "가져오기가 취소되었거나 완료되지 않았습니다.");
});

test("successful Drive import moves focus out of the picker after closing it", async () => {
  const status = { textContent: "" };
  let dialogHidden = false;
  let closePopupCalls = 0;
  let appButtonFocused = false;
  const context = {
    document: { getElementById: (id) => id === "driveStatus" ? status : { classList: { add(name) { if (name === "is-hidden") dialogHidden = true; } } } },
    requestBoardWorkReplacement: async (action) => { await action(); return true; },
    invokeDrive: async (command) => command === "drive_download_pdf"
      ? { size: 1, pdfBase64: "AQ==", name: "lesson.pdf", fileId: "pdf-1" }
      : {},
    BoardState: { MAX_PDF_BYTES: 256 * 1024 * 1024, isByteLengthWithinLimit: () => true, isBase64WithinLimit: () => true },
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    File: class TestFile {},
    loadPdfFromFile: async () => true,
    driveDialogOpen: true,
    driveLoginFlow: { invalidate() {} },
    closeDocumentPopup() { closePopupCalls += 1; },
    openDocumentPopupButton: { focus() { appButtonFocused = true; } },
  };
  vm.createContext(context);
  const importSource = uiSource.slice(uiSource.indexOf("async function importDrivePdf"), uiSource.indexOf("async function clearActiveDrivePin"));
  vm.runInContext(importSource, context);
  await context.importDrivePdf({ id: "pdf-1", name: "lesson.pdf" });
  assert.equal(dialogHidden, true);
  assert.equal(closePopupCalls, 1);
  assert.equal(context.driveDialogOpen, false);
  assert.equal(appButtonFocused, true);
  assert.equal(status.textContent, "lesson.pdf 가져옴");
});
