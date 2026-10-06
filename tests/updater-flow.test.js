const test = require("node:test");
const assert = require("node:assert/strict");

async function makeFlow(overrides = {}) {
  const { createUpdaterFlow } = await import("../js/updater-flow.mjs");
  const calls = [];
  const statuses = [];
  const dependencies = {
    getStatus: async () => ({ configured: true, recoveryReady: true, channel: "beta" }),
    checkUpdate: async () => ({ shouldUpdate: true, manifest: { version: "2.0.2" } }),
    prepareUpdate: async () => { calls.push("prepare"); },
    authorizePrepared: async () => { calls.push("authorize"); },
    launchUpdate: async () => { calls.push("launch"); },
    checkPromotion: async () => ({ shouldUpdate: true, manifest: { version: "2.0.1" } }),
    preparePromotion: async () => { calls.push("prepare-promotion"); },
    launchPromotion: async () => { calls.push("launch-promotion"); },
    getRecoveryStatus: async () => ({ canRollback: true, previousVersion: "2.0.1" }),
    rollback: async () => { calls.push("rollback"); },
    cancelPrepared: async () => { calls.push("cancel-prepared"); },
    acknowledgeRecovery: async () => { calls.push("acknowledge"); },
    openRecovery: async () => { calls.push("open-recovery"); },
    finishInput: () => { calls.push("finish"); },
    persistSession: async () => { calls.push("persist"); return true; },
    confirmInstall: () => true,
    confirmRollback: () => true,
    confirmPromotion: () => true,
    setStatus: (message) => statuses.push(message),
    ...overrides,
  };
  return { flow: createUpdaterFlow(dependencies), calls, statuses };
}

test("an unavailable deployment blocks update checks", async () => {
  const { flow, calls, statuses } = await makeFlow({ getStatus: async () => ({ configured: false }) });

  assert.equal(await flow.run(true), false);
  assert.deepEqual(calls, []);
  assert.match(statuses.at(-1), /배포 설정/);
});

test("declining leaves the app usable and manual recheck available", async () => {
  let checks = 0;
  const { flow, calls, statuses } = await makeFlow({
    checkUpdate: async () => { checks += 1; return { shouldUpdate: true, manifest: { version: "2.0.2" } }; },
    confirmInstall: () => false,
  });

  assert.equal(await flow.run(true), true);
  assert.deepEqual(calls, []);
  assert.match(statuses.at(-1), /나중/);
  assert.equal(await flow.run(true), true);
  assert.equal(checks, 2);
});

test("an async install confirmation must resolve true before staging", async () => {
  let resolveConfirmation;
  const confirmation = new Promise((resolve) => { resolveConfirmation = resolve; });
  const { flow, calls } = await makeFlow({ confirmInstall: () => confirmation });

  const update = flow.run(true);
  await Promise.resolve();
  assert.deepEqual(calls, []);
  resolveConfirmation(true);
  assert.equal(await update, true);
  assert.deepEqual(calls, ["prepare", "finish", "persist", "authorize", "launch"]);
});

test("the installer is fully staged before input is finished and saved", async () => {
  const { flow, calls, statuses } = await makeFlow();

  assert.equal(await flow.run(true), true);
  assert.deepEqual(calls, ["prepare", "finish", "persist", "authorize", "launch"]);
  assert.match(statuses.at(-1), /앱을 종료/);
});

test("a failed session save prevents the helper from starting", async () => {
  const { flow, calls } = await makeFlow({ persistSession: async () => { calls.push("persist"); return false; } });

  assert.equal(await flow.run(true), false);
  assert.deepEqual(calls, ["prepare", "finish", "persist", "cancel-prepared"]);
});

test("a failed authorization cancels the prepared update before launch", async () => {
  const { flow, calls } = await makeFlow({ authorizePrepared: async () => { calls.push("authorize"); return false; } });

  assert.equal(await flow.run(true), false);
  assert.deepEqual(calls, ["prepare", "finish", "persist", "authorize", "cancel-prepared"]);
});

test("authorization receives both successful save confirmations", async () => {
  let authorization;
  const { flow } = await makeFlow({ authorizePrepared: async (value) => { authorization = value; } });

  assert.equal(await flow.run(true), true);
  assert.deepEqual(authorization, { workSaved: true, pdfsSaved: true });
});

test("a cancelled failed save can retry without launching the stale prepared update", async () => {
  let saves = 0;
  const { flow, calls } = await makeFlow({ persistSession: async () => { saves += 1; calls.push(`persist-${saves}`); return saves > 1; } });

  assert.equal(await flow.run(true), false);
  assert.equal(await flow.run(true), true);
  assert.deepEqual(calls, ["prepare", "finish", "persist-1", "cancel-prepared", "prepare", "finish", "persist-2", "authorize", "launch"]);
});

test("a missing native cancellation command still fails closed", async () => {
  const { flow, calls, statuses } = await makeFlow({ cancelPrepared: async () => { throw new Error("IPC missing"); }, persistSession: async () => false });

  assert.equal(await flow.run(true), false);
  assert.deepEqual(calls, ["prepare", "finish"]);
  assert.match(statuses.at(-1), /되돌리지 못했습니다/);
});

test("unavailable rollback does not prompt or touch the session", async () => {
  const { flow, calls, statuses } = await makeFlow({ getRecoveryStatus: async () => ({ canRollback: false, message: "이전 버전이 없습니다." }) });

  assert.equal(await flow.rollback(), false);
  assert.deepEqual(calls, []);
  assert.match(statuses.at(-1), /이전 버전/);
});

test("confirmed rollback persists current work before asking the helper to restore", async () => {
  const { flow, calls } = await makeFlow();

  assert.equal(await flow.rollback(), true);
  assert.deepEqual(calls, ["finish", "persist", "rollback"]);
});

test("declining rollback does not alter or persist the current session", async () => {
  const { flow, calls, statuses } = await makeFlow({ confirmRollback: () => false });

  assert.equal(await flow.rollback(), true);
  assert.deepEqual(calls, []);
  assert.match(statuses.at(-1), /취소/);
});

test("an async rollback cancellation waits for the result and performs no rollback", async () => {
  let resolveConfirmation;
  const confirmation = new Promise((resolve) => { resolveConfirmation = resolve; });
  const { flow, calls, statuses } = await makeFlow({ confirmRollback: () => confirmation });

  const rollback = flow.rollback();
  await Promise.resolve();
  assert.deepEqual(calls, []);
  resolveConfirmation(false);
  assert.equal(await rollback, true);
  assert.deepEqual(calls, []);
  assert.match(statuses.at(-1), /취소/);
});

test("duplicate update checks share a single-flight promise", async () => {
  let finishCheck;
  let checks = 0;
  let startCheck;
  const checkStarted = new Promise((resolve) => { startCheck = resolve; });
  const { flow, calls } = await makeFlow({
    checkUpdate: () => { checks += 1; return new Promise((resolve) => { finishCheck = resolve; startCheck(); }); },
  });

  const update = flow.run(true);
  await checkStarted;
  const duplicate = flow.run(false);
  assert.equal(duplicate, update);
  finishCheck({ shouldUpdate: true, manifest: { version: "2.0.2" } });
  assert.equal(await update, true);
  assert.equal(checks, 1);
  assert.deepEqual(calls, ["prepare", "finish", "persist", "authorize", "launch"]);
});

test("a pending check reports busy and skips recovery, rollback, and promotion actions", async () => {
  let finishCheck;
  let startCheck;
  const checkStarted = new Promise((resolve) => { startCheck = resolve; });
  const { flow, calls, statuses } = await makeFlow({
    checkUpdate: () => new Promise((resolve) => { finishCheck = resolve; startCheck(); }),
    getRecoveryStatus: async () => { calls.push("recovery-status"); return { canRollback: true }; },
    checkPromotion: async () => { calls.push("check-promotion"); return { shouldUpdate: true }; },
    openRecovery: async () => { calls.push("open-recovery"); },
  });

  const update = flow.run(true);
  await checkStarted;
  assert.equal(await flow.rollback(), false);
  assert.equal(await flow.promote(), false);
  assert.equal(await flow.openRecovery(), false);
  assert.equal(statuses.filter((message) => /요청한 작업을 실행하지 않았습니다/.test(message)).length, 3);
  assert.deepEqual(calls, []);
  finishCheck({ shouldUpdate: false });
  assert.equal(await update, true);
});

test("stable promotion is a separate confirmed action staged before saving", async () => {
  const { flow, calls, statuses } = await makeFlow();

  assert.equal(await flow.promote(), true);
  assert.deepEqual(calls, ["prepare-promotion", "finish", "persist", "authorize", "launch-promotion"]);
  assert.match(statuses.at(-1), /앱이 종료/);
});

test("a rejected promotion confirmation fails closed and preserves the native string error", async () => {
  const { flow, calls, statuses } = await makeFlow({ confirmPromotion: async () => { throw "ACK native String error"; } });

  assert.equal(await flow.promote(), false);
  assert.deepEqual(calls, []);
  assert.equal(statuses.at(-1), "ACK native String error");
});

test("normal beta update never checks or promotes a stable release automatically", async () => {
  let promotions = 0;
  const { flow, calls } = await makeFlow({
    checkUpdate: async () => ({ shouldUpdate: false }),
    checkPromotion: async () => { promotions += 1; return { shouldUpdate: true }; },
  });

  assert.equal(await flow.run(false), true);
  assert.equal(promotions, 0);
  assert.deepEqual(calls, []);
});

test("a missing stable release keeps beta installed and reports the block", async () => {
  const { flow, calls, statuses } = await makeFlow({ checkPromotion: async () => ({ shouldUpdate: false, blocked: "정식 버전이 아직 준비되지 않았습니다." }) });

  assert.equal(await flow.promote(), false);
  assert.deepEqual(calls, []);
  assert.match(statuses.at(-1), /정식 버전이 아직 준비/);
});

test("a stable build does not offer beta-to-stable promotion", async () => {
  let checks = 0;
  const { flow, calls, statuses } = await makeFlow({ getStatus: async () => ({ channel: "stable" }), checkPromotion: async () => { checks += 1; return { shouldUpdate: true }; } });

  assert.equal(await flow.promote(), false);
  assert.equal(checks, 0);
  assert.deepEqual(calls, []);
  assert.match(statuses.at(-1), /베타 버전/);
});

test("recovery is acknowledged only after both restore checks succeed", async () => {
  let recoveryReads = 0;
  let acknowledged;
  const { flow, calls } = await makeFlow({
    getRecoveryStatus: async () => ({ state: recoveryReads++ === 0 ? "needs-verification" : "confirmed", canRollback: true }),
    acknowledgeRecovery: async (value) => { acknowledged = value; calls.push("acknowledge"); },
  });

  const restoreResult = { success: true, pdfSuccess: true, hadSnapshot: true };
  assert.equal(await flow.acknowledgeRestoredSession(restoreResult), true);
  assert.deepEqual(calls, ["acknowledge"]);
  assert.deepEqual(acknowledged, { restoreSucceeded: true, pdfRestoreSucceeded: true });
});

test("recovery with no restored snapshot never acknowledges a pending update", async () => {
  const { flow, calls, statuses } = await makeFlow();

  assert.equal(await flow.acknowledgeRestoredSession({ success: true, pdfSuccess: true }), false);
  assert.deepEqual(calls, []);
  assert.match(statuses.at(-1), /복구 확인에 실패/);
});

test("failed recovery checks never acknowledge the installed target", async () => {
  const { flow, calls, statuses } = await makeFlow();

  assert.equal(await flow.acknowledgeRestoredSession({ success: true, pdfSuccess: false, hadSnapshot: true }), false);
  assert.deepEqual(calls, []);
  assert.match(statuses.at(-1), /복구 확인에 실패/);
});
