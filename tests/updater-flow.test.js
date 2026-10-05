const test = require("node:test");
const assert = require("node:assert/strict");

async function makeFlow(overrides = {}) {
  const { createUpdaterFlow } = await import("../js/updater-flow.mjs");
  const calls = [];
  const statuses = [];
  const dependencies = {
    getStatus: async () => ({ configured: true, recoveryReady: true }),
    getUpdater: () => ({
      checkUpdate: async () => ({ shouldUpdate: true, manifest: { version: "2.0.2" } }),
      installUpdate: async () => { calls.push("install"); },
    }),
    finishInput: () => { calls.push("finish"); },
    persistSession: async () => { calls.push("persist"); return true; },
    confirmInstall: () => true,
    setStatus: (message) => statuses.push(message),
    ...overrides,
  };
  return { flow: createUpdaterFlow(dependencies), calls, statuses };
}

test("an unready recovery capability blocks install and preserves recheck", async () => {
  const { flow, calls, statuses } = await makeFlow({
    getStatus: async () => ({ configured: true, recoveryReady: false }),
  });

  assert.equal(await flow.run(true), false);
  assert.deepEqual(calls, []);
  assert.match(statuses.at(-1), /복구 준비/);
});

test("declining keeps the app usable and does not persist or install", async () => {
  const { flow, calls, statuses } = await makeFlow({ confirmInstall: () => false });

  assert.equal(await flow.run(true), true);
  assert.deepEqual(calls, []);
  assert.match(statuses.at(-1), /나중/);
  assert.equal(await flow.run(true), true);
});

test("failed persistence prevents installation", async () => {
  const { flow, calls } = await makeFlow({ persistSession: async () => { calls.push("persist"); return false; } });

  assert.equal(await flow.run(true), false);
  assert.deepEqual(calls, ["finish", "persist"]);
});

test("a confirmed install persists first and reports the app restart", async () => {
  const { flow, calls, statuses } = await makeFlow();

  assert.equal(await flow.run(true), true);
  assert.deepEqual(calls, ["finish", "persist", "install"]);
  assert.match(statuses.at(-1), /앱을 종료/);
});

test("overlapping checks share one prompt and installation", async () => {
  let finishCheck;
  let checks = 0;
  let startCheck;
  const checkStarted = new Promise((resolve) => { startCheck = resolve; });
  const { flow, calls } = await makeFlow({
    getUpdater: () => ({
      checkUpdate: () => { checks += 1; return new Promise((resolve) => { finishCheck = resolve; startCheck(); }); },
      installUpdate: async () => { calls.push("install"); },
    }),
  });

  const first = flow.run(true);
  const second = flow.run(true);
  assert.equal(first, second);
  await checkStarted;
  finishCheck({ shouldUpdate: true, manifest: { version: "2.0.2" } });

  assert.equal(await first, true);
  assert.equal(checks, 1);
  assert.deepEqual(calls, ["finish", "persist", "install"]);
});

test("the install checkpoint includes an in-progress stroke", async () => {
  let activeStroke = { id: "stroke-not-yet-finalized" };
  const checkpoint = [];
  const { flow, calls } = await makeFlow({
    finishInput: () => { if (activeStroke) checkpoint.push(activeStroke); activeStroke = null; calls.push("finish"); },
    persistSession: async () => { calls.push("persist"); return checkpoint.length === 1; },
  });

  assert.equal(await flow.run(true), true);
  assert.deepEqual(checkpoint, [{ id: "stroke-not-yet-finalized" }]);
  assert.deepEqual(calls, ["finish", "persist", "install"]);
});
