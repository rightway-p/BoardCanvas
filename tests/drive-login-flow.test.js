const test = require("node:test");
const assert = require("node:assert/strict");

async function createFlow(overrides = {}) {
  const { createDriveLoginFlow } = await import("../js/drive-login-flow.mjs");
  return createDriveLoginFlow(overrides);
}

test("PDF listing starts only after Google login succeeds", async () => {
  const calls = [];
  const states = [];
  const flow = await createFlow({
    invoke: async (command) => { calls.push(command); return { files: [{ id: "pdf-1", name: "notes.pdf", size: 12 }] }; },
    onState: (state) => states.push(state.phase),
  });

  assert.equal(await flow.signIn(), true);
  assert.deepEqual(calls, ["drive_authenticate", "drive_list_pdfs"]);
  assert.deepEqual(states, ["authenticating", "loading", "connected"]);
});

test("cancelled or failed login returns to login and never lists files; retry can succeed", async () => {
  let attempts = 0;
  const calls = [];
  const states = [];
  const flow = await createFlow({
    invoke: async (command) => {
      calls.push(command);
      if (command === "drive_authenticate" && attempts++ === 0) throw new Error("Google sign-in was cancelled.");
      return { files: [] };
    },
    onState: (state) => states.push(state.phase),
  });

  assert.equal(await flow.signIn(), false);
  assert.deepEqual(calls, ["drive_authenticate"]);
  assert.equal(await flow.signIn(), true);
  assert.deepEqual(calls, ["drive_authenticate", "drive_authenticate", "drive_list_pdfs"]);
  assert.deepEqual(states, ["authenticating", "login-error", "authenticating", "loading", "connected"]);
});

test("opening Drive restores a saved login silently before listing", async () => {
  const calls = [];
  const states = [];
  const flow = await createFlow({
    invoke: async (command) => {
      calls.push(command);
      if (command === "drive_get_auth_status") return { connected: true };
      return { files: [{ id: "pdf-1" }] };
    },
    onState: (state) => states.push(state.phase),
  });

  assert.equal(await flow.checkStatus(), true);
  assert.deepEqual(calls, ["drive_get_auth_status", "drive_list_pdfs"]);
  assert.deepEqual(states, ["checking-auth", "loading", "connected"]);
});

test("a temporary status error stays retryable without opening the OAuth browser", async () => {
  let attempts = 0;
  const calls = [];
  const states = [];
  const flow = await createFlow({
    invoke: async (command) => {
      calls.push(command);
      if (command === "drive_get_auth_status" && attempts++ === 0) throw new Error("network unavailable");
      if (command === "drive_get_auth_status") return { connected: true };
      return { files: [] };
    },
    onState: (state) => states.push(state.phase),
  });

  assert.equal(await flow.checkStatus(), false);
  assert.equal(await flow.checkStatus(), true);
  assert.deepEqual(calls, ["drive_get_auth_status", "drive_get_auth_status", "drive_list_pdfs"]);
  assert.deepEqual(states, ["checking-auth", "status-error", "checking-auth", "loading", "connected"]);
});

test("reopening after close waits for stale listing and checks the session again", async () => {
  let finishList;
  const calls = [];
  const states = [];
  const flow = await createFlow({
    invoke: async (command) => {
      calls.push(command);
      if (command === "drive_authenticate") return { connected: true };
      if (command === "drive_list_pdfs") return new Promise((resolve) => { finishList = resolve; });
      return { connected: false };
    },
    onState: (state) => states.push(state.phase),
  });
  const closedRequest = flow.signIn();
  await new Promise((resolve) => setImmediate(resolve));
  flow.invalidate();
  finishList({ files: [{ id: "late-result" }] });
  const reopenedRequest = flow.waitForIdle().then(() => flow.checkStatus());

  assert.equal(await closedRequest, false);
  assert.equal(await reopenedRequest, false);
  assert.deepEqual(calls, ["drive_authenticate", "drive_list_pdfs", "drive_get_auth_status"]);
  assert.deepEqual(states, ["authenticating", "loading", "checking-auth", "needs-login"]);
});
