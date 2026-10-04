const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

function setup() {
  const listeners = {};
  const storage = new Map();
  const hints = [];
  const calls = [];
  const documentListeners = {};
  const documentChildren = [];
  const modalState = { developerSettings: null };
  function element(tagName) {
    const handlers = {};
    const attributes = {};
    return {
      tagName: tagName.toUpperCase(), style: {}, dataset: {}, children: [], open: false,
      classList: { add() {}, remove() {}, contains() { return false; } },
      setAttribute(name, value) { attributes[name] = value; }, getAttribute(name) { return attributes[name]; },
      addEventListener(name, callback) { handlers[name] = callback; }, click() { if (handlers.click) handlers.click(); },
      append(...items) { this.children.push(...items); }, appendChild(item) { this.children.push(item); },
      replaceChildren(...items) { this.children = [...items]; },
      querySelector(selector) { return findDescendant(this, (child) => matchesSelector(child, selector)); },
      querySelectorAll(selector) { return allDescendants(this).filter((child) => matchesSelector(child, selector)); },
      showModal() { this.open = true; }, close() { this.open = false; if (handlers.close) handlers.close(); }
    };
  }
  const context = {
    document: { createElement: element, getElementById: (id) => id === "developerSettings" ? modalState.developerSettings : null, addEventListener: (name, callback) => { documentListeners[name] = callback; }, body: { appendChild: (child) => documentChildren.push(child) } },
    window: {
      localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
      addEventListener: (name, callback, capture) => { listeners[name] = { callback, capture }; }
    }
  };
  const source = fs.readFileSync(path.join(__dirname, "../js/remote-controls.js"), "utf8");
  vm.runInNewContext(source, context);
  context.window.BoardRemote.configure({
    actions: [
      { id: "previousPage", label: "Previous page", run: () => calls.push("previousPage") },
      { id: "nextPage", label: "Next page", run: () => calls.push("nextPage") },
      { id: "undoInk", label: "Undo", run: () => calls.push("undoInk") }
    ],
    showHint: (message) => hints.push(message)
  });
  return { remote: context.window.BoardRemote, listeners, documentListeners, documentChildren, storage, hints, calls, setDeveloperSettingsOpen: (open) => { modalState.developerSettings = open ? { hidden: false } : null; } };
}

function key(code, options = {}) {
  return { code, repeat: false, target: null, ctrlKey: false, metaKey: false, altKey: false,
    preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...options };
}

test("duplicate key mappings run every action once and consume auto-repeat", () => {
  const { remote, calls, hints, listeners } = setup();
  remote.setMappings([{ actionId: "previousPage", code: "ArrowLeft" }]);
  assert.equal(listeners.keydown.capture, true);
  remote.beginKeyRegistration("undoInk");
  assert.equal(remote.handleKeyEvent(key("ArrowLeft")), true);
  assert.deepEqual(calls, []);
  assert.equal(remote.handleKeyEvent(key("ArrowLeft")), true);
  assert.deepEqual(calls, ["previousPage", "undoInk"]);
  assert.match(hints.at(-1), /모두 실행됩니다/);

  const repeated = key("ArrowLeft", { repeat: true });
  assert.equal(remote.handleKeyEvent(repeated), true);
  assert.deepEqual(calls, ["previousPage", "undoInk"]);
  assert.equal(repeated.stopped, true);
});

test("registration consumes the chosen key without running its mapped action", () => {
  const { remote, calls, storage } = setup();
  remote.beginKeyRegistration("nextPage");
  const event = key("PageDown");
  assert.equal(remote.handleKeyEvent(event), true);
  assert.deepEqual(calls, []);
  assert.deepEqual(JSON.parse(JSON.stringify(remote.getMappings())), [{ actionId: "nextPage", code: "PageDown", ctrlKey: false, altKey: false, metaKey: false, shiftKey: false }]);
  assert.equal(JSON.parse(storage.get("board.remote.mappings.v1"))[0].code, "PageDown");
  assert.equal(event.stopped, true);
});

test("settings keys stay isolated from board actions; modal test actions are simulated", () => {
  const { remote, calls, documentListeners } = setup();
  remote.setMappings([{ actionId: "nextPage", code: "ArrowRight" }, { actionId: "undoInk", code: "KeyZ" }]);
  const typing = key("ArrowRight", { target: { tagName: "INPUT" } });
  assert.equal(remote.handleKeyEvent(typing), false);
  remote.openSettings();
  const testKey = key("ArrowRight");
  assert.equal(remote.handleKeyEvent(testKey), true);
  assert.equal(testKey.stopped, true);
  assert.equal(remote.getTestPage(), 2);
  assert.deepEqual(calls, []);
  const unmatched = key("KeyQ", { ctrlKey: true });
  assert.equal(remote.handleKeyEvent(unmatched), false);
  assert.equal(unmatched.prevented, undefined);
  documentListeners.keydown(unmatched);
  assert.equal(unmatched.stopped, true);
  const navigation = key("Tab");
  assert.equal(remote.handleKeyEvent(navigation), false);
  documentListeners.keydown(navigation);
  assert.equal(navigation.prevented, undefined);
  assert.notEqual(navigation.stopped, true);
  assert.deepEqual(calls, []);
  remote.closeSettings();
  remote.handleKeyEvent(key("ArrowRight"));
  assert.deepEqual(calls, ["nextPage"]);
});

test("developer settings modal blocks remote shortcuts without consuming input", () => {
  const { remote, calls, setDeveloperSettingsOpen } = setup();
  remote.setMappings([{ actionId: "nextPage", code: "ArrowRight" }]);
  setDeveloperSettingsOpen(true);
  const input = key("ArrowRight");
  assert.equal(remote.handleKeyEvent(input), false);
  assert.notEqual(input.stopped, true);
  assert.deepEqual(calls, []);
});

test("unified settings host renders remote controls inline and suppresses real actions outside remote tab", () => {
  const { remote, calls, documentChildren } = setup();
  remote.setMappings([{ actionId: "nextPage", code: "ArrowRight" }]);
  const host = elementForTest("section");
  remote.setSettingsContext({ open: true, remote: false });
  const outsideRemote = key("ArrowRight");
  assert.equal(remote.handleKeyEvent(outsideRemote), false);
  assert.deepEqual(calls, []);

  remote.openSettings(host);
  assert.equal(documentChildren.length, 0);
  assert.ok(host.children.some((child) => child.textContent?.includes("동작마다 키를 지정")));
  assert.deepEqual(JSON.parse(JSON.stringify(remote.getMappings())), [
    { actionId: "nextPage", code: "ArrowRight", ctrlKey: false, altKey: false, metaKey: false, shiftKey: false }
  ]);
  const remoteTest = key("ArrowRight");
  assert.equal(remote.handleKeyEvent(remoteTest), true);
  assert.equal(remote.getTestPage(), 2);
  assert.deepEqual(calls, []);
  const tabNavigation = key("Tab");
  assert.equal(remote.handleKeyEvent(tabNavigation), false);
  assert.notEqual(tabNavigation.stopped, true);

  remote.setSettingsContext({ open: true, remote: false });
  assert.equal(remote.handleKeyEvent(key("ArrowRight")), false);
  assert.deepEqual(calls, []);
  remote.closeSettings();
});

test("modifier chords register and match consistently; modifier-only assignments are rejected", () => {
  const { remote, calls } = setup();
  remote.openSettings();
  remote.beginKeyRegistration("undoInk");
  const modifierAlone = key("ControlLeft", { ctrlKey: true });
  assert.equal(remote.handleKeyEvent(modifierAlone), true);
  assert.deepEqual(JSON.parse(JSON.stringify(remote.getMappings())), []);
  const chord = key("KeyZ", { ctrlKey: true, shiftKey: true });
  assert.equal(remote.handleKeyEvent(chord), true);
  assert.deepEqual(JSON.parse(JSON.stringify(remote.getMappings())), [
    { actionId: "undoInk", code: "KeyZ", ctrlKey: true, altKey: false, metaKey: false, shiftKey: true }
  ]);
  remote.closeSettings();
  const wrongChord = key("KeyZ", { ctrlKey: true });
  assert.equal(remote.handleKeyEvent(wrongChord), false);
  remote.handleKeyEvent(key("KeyZ", { ctrlKey: true, shiftKey: true }));
  assert.deepEqual(calls, ["undoInk"]);
});

test("persisted mappings retain their modifier chord", () => {
  const { remote, storage } = setup();
  remote.setMappings([{ actionId: "nextPage", code: "KeyN", metaKey: true }]);
  const second = setupWithStorage(storage);
  assert.deepEqual(JSON.parse(JSON.stringify(second.remote.getMappings())), [
    { actionId: "nextPage", code: "KeyN", ctrlKey: false, altKey: false, metaKey: true, shiftKey: false }
  ]);
});

test("settings display the full assigned chord", () => {
  const { remote, documentChildren } = setup();
  remote.setMappings([{ actionId: "nextPage", code: "KeyN", ctrlKey: true, altKey: true, shiftKey: true }]);
  remote.openSettings();
  const dialog = documentChildren[0];
  const assignedKey = findDescendant(dialog, (child) => child.children?.some((part) => part.textContent === "Next page"))?.children[1];
  assert.equal(assignedKey.textContent, "Ctrl+Alt+Shift+KeyN");
});

test("assigned mapping can be released for one action while duplicate chord mappings remain", () => {
  const { remote, documentChildren, storage } = setup();
  remote.setMappings([
    { actionId: "previousPage", code: "ArrowRight" },
    { actionId: "nextPage", code: "ArrowRight" },
    { actionId: "undoInk", code: "KeyZ", ctrlKey: true }
  ]);
  remote.openSettings();
  const dialog = documentChildren[0];
  const rowFor = (label) => findDescendant(dialog, (child) => child.className === "remote-action-row" && child.children[0]?.textContent === label);
  const previousRow = rowFor("Previous page");
  const nextRow = rowFor("Next page");
  const undoRow = rowFor("Undo");
  assert.equal(previousRow.children.length, 4);
  assert.equal(previousRow.children[3].textContent, "입력 해제");
  assert.equal(previousRow.children[3].getAttribute("aria-label"), "Previous page 입력 해제");
  assert.equal(undoRow.children.length, 4);

  previousRow.children[3].click();

  assert.deepEqual(JSON.parse(JSON.stringify(remote.getMappings())), [
    { actionId: "nextPage", code: "ArrowRight", ctrlKey: false, altKey: false, metaKey: false, shiftKey: false },
    { actionId: "undoInk", code: "KeyZ", ctrlKey: true, altKey: false, metaKey: false, shiftKey: false }
  ]);
  assert.deepEqual(JSON.parse(storage.get("board.remote.mappings.v1")), JSON.parse(JSON.stringify(remote.getMappings())));
  assert.equal(rowFor("Previous page").children.length, 3);
  assert.equal(rowFor("Next page").children.length, 4);
});

function setupWithStorage(storage) {
  const listeners = {};
  const calls = [];
  const element = (tagName) => ({ tagName: tagName.toUpperCase(), style: {}, dataset: {}, setAttribute() {}, addEventListener() {}, append() {}, appendChild() {}, replaceChildren() {}, querySelector() { return null; }, querySelectorAll() { return []; } });
  const context = { document: { createElement: element, addEventListener() {}, body: { appendChild() {} } }, window: {
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    addEventListener: (name, callback, capture) => { listeners[name] = { callback, capture }; }
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../js/remote-controls.js"), "utf8"), context);
  context.window.BoardRemote.configure({ actions: [
    { id: "previousPage", label: "Previous page", run: () => calls.push("previousPage") },
    { id: "nextPage", label: "Next page", run: () => calls.push("nextPage") },
    { id: "undoInk", label: "Undo", run: () => calls.push("undoInk") }
  ] });
  return { remote: context.window.BoardRemote, calls, listeners };
}

function elementForTest(tagName) {
  return { tagName: tagName.toUpperCase(), style: {}, dataset: {}, children: [], classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute() {}, addEventListener() {}, append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); }, replaceChildren(...items) { this.children = [...items]; },
    querySelector(selector) { return findDescendant(this, (child) => matchesSelector(child, selector)); },
    querySelectorAll(selector) { return allDescendants(this).filter((child) => matchesSelector(child, selector)); } };
}

function findDescendant(root, predicate) {
  for (const child of root.children || []) {
    if (predicate(child)) return child;
    const nested = findDescendant(child, predicate);
    if (nested) return nested;
  }
  return null;
}

function allDescendants(root) {
  return (root.children || []).flatMap((child) => [child, ...allDescendants(child)]);
}

function matchesSelector(element, selector) {
  if (selector.startsWith(".")) return String(element.className || "").split(/\s+/).includes(selector.slice(1));
  if (selector === "[data-remote-test-page]") return Object.hasOwn(element.dataset || {}, "remoteTestPage");
  if (selector === "[data-remote-last-name]") return Object.hasOwn(element.dataset || {}, "remoteLastName");
  if (selector === "[data-remote-last-code]") return Object.hasOwn(element.dataset || {}, "remoteLastCode");
  return false;
}
