const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "js", "setup-wizard.js"), "utf8");

function button() {
  return { hidden: false, clicks: 0, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, click() { this.clicks += 1; this.listeners.click?.({}); }, focus() {} };
}

function harness(penOpacity = 0) {
  const storage = new Map();
  const palette = button();
  const picker = button();
  const drive = button();
  const panel = { innerHTML: "", querySelector(selector) { return selector.includes("palette-open") ? palette : selector.includes("pen-picker") ? picker : selector.includes("drive-open") ? drive : null; }, querySelectorAll() { return []; } };
  const next = button();
  const back = button();
  const skip = button();
  const closeSettings = button();
  const closeDrive = button();
  const pickerDialog = { open: false, addEventListener() {} };
  const root = { hidden: true, classList: { toggle() {} }, setAttribute() {}, removeAttribute() {}, querySelector(selector) { return selector.includes("Panel") || selector.includes("wizard-panel") ? panel : selector.includes("Next") || selector.includes("wizard-next") ? next : selector.includes("Back") || selector.includes("wizard-back") ? back : selector.includes("Skip") || selector.includes("wizard-skip") ? skip : null; }, querySelectorAll() { return []; } };
  const documentListeners = {};
  const document = { readyState: "complete", querySelector() { return root; }, querySelectorAll() { return []; }, getElementById(id) { return id === "setupWizardNext" ? next : id === "setupWizardBack" ? back : id === "setupWizardSkip" ? skip : id === "closeSettingsButton" ? closeSettings : id === "closeDriveDialog" ? closeDrive : id === "penColorPicker" ? pickerDialog : null; }, addEventListener(type, fn) { documentListeners[type] = fn; }, dispatch(type, event) { documentListeners[type]?.(event); } };
  let mode = "single";
  let applied = 0;
  let appliedOpacity = null;
  let appliedWidth = null;
  let appliedColor = null;
  const context = { document, window: { localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) }, setTimeout, BoardPenColorPicker: { open({ onApply, onClose }) { onApply({ color: "#abcdef", opacity: 0.5 }); onClose(); } } }, penColorInput: { value: "#123456" }, lineWidthInput: { value: "7" }, penOpacity, penPresets: [{ color: "#123456", width: 7, opacity: penOpacity }], setBoardInteractionMode(value) { mode = value; }, applyPenPreset(value) { applied += 1; appliedOpacity = value.opacity; appliedWidth = value.width; appliedColor = value.color; }, openDriveDialog() {}, console };
  context.window.document = document;
  vm.runInNewContext(source, context, { filename: "setup-wizard.js" });
  return { context, root, next, skip, palette, picker, drive, closeSettings, closeDrive, pickerDialog, storage, get mode() { return mode; }, get applied() { return applied; }, get appliedOpacity() { return appliedOpacity; }, get appliedWidth() { return appliedWidth; }, get appliedColor() { return appliedColor; } };
}

test("skip closes and durably completes without applying draft settings", () => {
  const app = harness();
  app.context.window.BoardSetupWizard.open();
  app.skip.click();
  assert.equal(app.root.hidden, true);
  assert.equal(app.storage.get("board.setup-wizard.completed.v1"), "true");
  assert.equal(app.mode, "single");
  assert.equal(app.applied, 0);
});

test("final start applies the latest real pen opacity and interaction mode", () => {
  const app = harness();
  app.context.window.BoardSetupWizard.open();
  for (let index = 0; index < 5; index += 1) app.next.click();
  assert.equal(app.mode, "single");
  assert.equal(app.applied, 1);
  assert.equal(app.appliedOpacity, 0);
  assert.equal(app.root.hidden, true);
});

test("skip from final review still preserves all draft settings", () => {
  const app = harness();
  app.context.window.BoardSetupWizard.open();
  for (let index = 0; index < 4; index += 1) app.next.click();
  app.skip.click();
  assert.equal(app.applied, 0);
  assert.equal(app.root.hidden, true);
});

test("final start preserves half and fully opaque pen alpha", () => {
  for (const [stored, expected] of [[0.5, 0.5], [1, 1]]) {
    const app = harness(stored);
    app.context.window.BoardSetupWizard.open();
    for (let index = 0; index < 5; index += 1) app.next.click();
    assert.equal(app.appliedOpacity, expected);
  }
});

test("opening existing palette settings hides wizard and close returns to it", () => {
  const app = harness();
  app.context.window.BoardSetupWizard.open();
  app.next.click();
  app.palette.click();
  assert.equal(app.root.hidden, true);
  app.closeSettings.click();
  assert.equal(app.root.hidden, false);
});

test("returning from existing settings re-syncs the current pen width before final apply", () => {
  const app = harness();
  app.context.window.BoardSetupWizard.open();
  app.next.click();
  app.palette.click();
  app.context.lineWidthInput.value = "10";
  app.closeSettings.click();
  for (let index = 0; index < 4; index += 1) app.next.click();
  assert.equal(app.appliedWidth, 10);
});

test("unchanged external settings preserve the wizard pen width draft", () => {
  const app = harness();
  app.context.window.BoardSetupWizard.open();
  app.next.click();
  app.palette.click();
  app.closeSettings.click();
  for (let index = 0; index < 4; index += 1) app.next.click();
  assert.equal(app.appliedWidth, 7);
});

test("shared picker updates wizard draft without writing the real pen", () => {
  const app = harness();
  app.context.window.BoardSetupWizard.open();
  app.next.click();
  app.picker.click();
  assert.equal(app.context.penColorInput.value, "#123456");
  assert.equal(app.closeSettings.clicks, 0);
  for (let index = 0; index < 4; index += 1) app.next.click();
  assert.equal(app.appliedColor, "#abcdef");
  assert.equal(app.appliedOpacity, 0.5);
});

test("Escape closes an active Drive return path and restores the wizard", async () => {
  const app = harness();
  app.context.window.BoardSetupWizard.open();
  app.next.click(); app.next.click();
  app.drive.click();
  assert.equal(app.root.hidden, true);
  app.context.document.dispatch("keydown", { key: "Escape", preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(app.root.hidden, false);
});

test("Escape yields to a native picker opened from Settings", async () => {
  const app = harness();
  app.context.window.BoardSetupWizard.open();
  app.next.click();
  app.palette.click();
  app.pickerDialog.open = true;
  app.context.document.dispatch("keydown", { key: "Escape", preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(app.closeSettings.clicks, 0);
});

test("final review reports the real Drive connection state", () => {
  const app = harness();
  app.context.driveAuthenticated = true;
  app.context.window.BoardSetupWizard.open();
  for (let index = 0; index < 4; index += 1) app.next.click();
  assert.match(app.context.document.querySelector().querySelector("#wizardPanel").innerHTML, /연결됨/);
});

test("repeated init calls reuse the same controller", () => {
  const app = harness();
  const first = app.context.window.BoardSetupWizard;
  const second = first.init({ restored: false, recoveryAcknowledged: false });
  assert.strictEqual(second, first);
});

test("first launch remains closed until restoration and recovery acknowledgement are both true", () => {
  const app = harness();
  app.context.window.BoardSetupWizard.init({ restored: false, recoveryAcknowledged: true });
  assert.equal(app.root.hidden, true);
  app.context.window.BoardSetupWizard.init({ restored: true, recoveryAcknowledged: true });
  assert.equal(app.root.hidden, false);
});
