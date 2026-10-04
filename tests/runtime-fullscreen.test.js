const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../js/runtime-overlay.js"), "utf8");
const fullscreenSource = source.slice(
  source.indexOf("function getFullscreenElement()"),
  source.indexOf("function getTauriWindowApi()")
);
const windowApiSource = source.slice(
  source.indexOf("function getTauriWindowApi()"),
  source.indexOf("function getTauriEventApi()")
);

function createFullscreenHarness({ appWindow = null, browserFullscreen = false } = {}) {
  const logs = [];
  const button = {
    disabled: false,
    classList: { toggle() {} },
    setAttribute() {},
    title: ""
  };
  const document = {
    fullscreenElement: null,
    fullscreenEnabled: browserFullscreen,
    documentElement: {}
  };
  if (browserFullscreen) {
    document.documentElement.requestFullscreen = async () => {
      document.fullscreenElement = document.documentElement;
    };
    document.exitFullscreen = async () => {
      document.fullscreenElement = null;
    };
  }

  const context = {
    window: {
      __TAURI__: appWindow ? { window: { appWindow } } : null,
      setTimeout(callback) { queueMicrotask(callback); }
    },
    document,
    fullscreenToggleButton: button,
    overlayMode: false,
    overlayTransitionInProgress: false,
    nativeFullscreenActive: false,
    nativeWindowMaximized: false,
    missingNativeWindowMethods: new Set(),
    queueRuntimeLog(name, details) { logs.push({ name, details }); },
    toRuntimeLogError(error) { return String(error); },
    sanitizeRuntimeLogDetails(value) { return value; },
    setDocumentStatus() {},
    logs
  };
  vm.createContext(context);
  vm.runInContext(`${fullscreenSource}\n${windowApiSource}`, context);
  for (const name of ["isFullscreenActive", "refreshNativeFullscreenState", "toggleFullscreen"]) {
    context[name] = vm.runInContext(name, context);
  }
  return context;
}

test("desktop fullscreen is independent of maximize and exit preserves maximized state", async () => {
  const state = { fullscreen: false, maximized: true };
  const calls = [];
  const appWindow = {
    async isFullscreen() { return state.fullscreen; },
    async isMaximized() { return state.maximized; },
    async setFullscreen(active) {
      calls.push(["setFullscreen", active]);
      state.fullscreen = active;
    },
    async maximize() { calls.push(["maximize"]); state.maximized = true; },
    async unmaximize() { calls.push(["unmaximize"]); state.maximized = false; }
  };
  const context = createFullscreenHarness({ appWindow });

  await context.refreshNativeFullscreenState();
  assert.equal(context.isFullscreenActive(), false);
  assert.equal(context.nativeWindowMaximized, true);

  await context.toggleFullscreen();
  assert.equal(context.isFullscreenActive(), true);
  assert.equal(state.maximized, true);
  assert.deepEqual(calls, [["setFullscreen", true]]);

  await context.toggleFullscreen();
  assert.equal(context.isFullscreenActive(), false);
  assert.equal(state.maximized, true);
  assert.deepEqual(calls, [["setFullscreen", true], ["setFullscreen", false]]);
});

test("failed native fullscreen does not substitute maximize and a later attempt can succeed", async () => {
  const state = { fullscreen: false, maximized: false, fail: true };
  const calls = [];
  const appWindow = {
    async isFullscreen() { return state.fullscreen; },
    async isMaximized() { return state.maximized; },
    async setFullscreen(active) {
      calls.push(["setFullscreen", active]);
      if (state.fail) throw new Error("native fullscreen unavailable");
      state.fullscreen = active;
    },
    async maximize() { calls.push(["maximize"]); state.maximized = true; }
  };
  const context = createFullscreenHarness({ appWindow });

  await context.toggleFullscreen();
  assert.equal(context.isFullscreenActive(), false);
  assert.equal(state.maximized, false);
  assert.deepEqual(calls, [["setFullscreen", true]]);
  assert.equal(vm.runInContext("fullscreenToggleInProgress", context), false);

  state.fail = false;
  await context.toggleFullscreen();
  assert.equal(context.isFullscreenActive(), true);
  assert.deepEqual(calls, [["setFullscreen", true], ["setFullscreen", true]]);
});

test("overlapping fullscreen clicks issue only one native transition", async () => {
  let releaseFullscreen;
  let notifyCall;
  const fullscreenGate = new Promise((resolve) => { releaseFullscreen = resolve; });
  const fullscreenCalled = new Promise((resolve) => { notifyCall = resolve; });
  const state = { fullscreen: false, maximized: false };
  let setFullscreenCalls = 0;
  const appWindow = {
    async isFullscreen() { return state.fullscreen; },
    async isMaximized() { return state.maximized; },
    async setFullscreen(active) {
      setFullscreenCalls += 1;
      if (active) {
        notifyCall();
        await fullscreenGate;
      }
      state.fullscreen = active;
    }
  };
  const context = createFullscreenHarness({ appWindow });

  const firstToggle = context.toggleFullscreen();
  await fullscreenCalled;
  await context.toggleFullscreen();
  assert.equal(setFullscreenCalls, 1);
  releaseFullscreen();
  await firstToggle;
  assert.equal(context.isFullscreenActive(), true);
  assert.equal(vm.runInContext("fullscreenToggleInProgress", context), false);
});

test("browser fullscreen still enters and exits through the document API", async () => {
  const context = createFullscreenHarness({ browserFullscreen: true });

  await context.toggleFullscreen();
  assert.equal(context.isFullscreenActive(), true);
  await context.toggleFullscreen();
  assert.equal(context.isFullscreenActive(), false);
});
