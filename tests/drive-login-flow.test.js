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

test("Tauri string rejections remain visible as useful login errors", async () => {
  const states = [];
  const flow = await createFlow({
    invoke: async () => { throw "Google token exchange failed (HTTP 400): Configure BOARD_GOOGLE_OAUTH_CLIENT_SECRET."; },
    onState: (state) => states.push(state),
  });

  assert.equal(await flow.signIn(), false);
  assert.equal(states.at(-1).phase, "login-error");
  assert.equal(states.at(-1).error.message, "Google token exchange failed (HTTP 400): Configure BOARD_GOOGLE_OAUTH_CLIENT_SECRET.");
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

test("folder browsing pages direct entries, navigates breadcrumbs, and retains shared-with-me", async () => {
  const calls = [];
  const states = [];
  const flow = await createFlow({
    invoke: async (command, args = {}) => {
      calls.push([command, args]);
      if (command === "drive_authenticate") return { connected: true };
      if (args.pageToken) return { files: [{ id: "pdf-2", name: "second.pdf", mimeType: "application/pdf" }] };
      if (args.folderId === "root" && args.sharedWithMe) return { files: [{ id: "shared-folder", name: "Shared folder", mimeType: "application/vnd.google-apps.folder" }] };
      if (args.folderId === "shared-folder") return { files: [{ id: "shared-pdf", name: "shared.pdf", mimeType: "application/pdf" }] };
      if (args.folderId === "folder-a") return { files: [{ id: "folder-b", name: "Nested", mimeType: "application/vnd.google-apps.folder" }], nextPageToken: "next" };
      if (args.folderId === "folder-b") return { files: [{ id: "pdf-1", name: "first.pdf", mimeType: "application/pdf" }] };
      return { files: [{ id: "folder-a", name: "Folder A", mimeType: "application/vnd.google-apps.folder" }] };
    },
    onState: (state) => states.push(state),
  });

  assert.equal(await flow.signIn(), true);
  assert.deepEqual(calls[1], ["drive_list_pdfs", { folderId: "root" }]);
  assert.equal(await flow.openFolder("folder-a", "Folder A"), true);
  assert.deepEqual(calls.slice(2, 4).map(([, args]) => args), [{ folderId: "folder-a" }, { folderId: "folder-a", pageToken: "next" }]);
  assert.equal(await flow.openFolder("folder-b", "Nested"), true);
  assert.deepEqual(states.at(-1).path, [{ id: "folder-a", name: "Folder A" }, { id: "folder-b", name: "Nested" }]);
  assert.equal(await flow.goToPath(0), true);
  assert.deepEqual(states.at(-1).path, [{ id: "folder-a", name: "Folder A" }]);
  assert.equal(await flow.showSharedWithMe(), true);
  assert.deepEqual(calls.at(-1), ["drive_list_pdfs", { folderId: "root", sharedWithMe: true }]);
  assert.equal(states.at(-1).sharedWithMe, true);
  assert.equal(await flow.openFolder("shared-folder", "Shared folder"), true);
  assert.deepEqual(calls.at(-1), ["drive_list_pdfs", { folderId: "shared-folder" }]);
  assert.equal(await flow.goToParent(), true);
  assert.deepEqual(calls.at(-1), ["drive_list_pdfs", { folderId: "root", sharedWithMe: true }]);
});

test("failed folder navigation retains the last successful path and files", async () => {
  const states = [];
  const flow = await createFlow({
    invoke: async (command, args = {}) => {
      if (command === "drive_authenticate") return { connected: true };
      if (command === "drive_get_auth_status") return { connected: true };
      if (args.folderId === "missing") throw new Error("folder unavailable");
      return { files: [{ id: "root-pdf", name: "root.pdf", mimeType: "application/pdf" }] };
    },
    onState: (state) => states.push(state),
  });

  await flow.signIn();
  assert.equal(await flow.openFolder("missing", "Missing"), false);
  const state = states.at(-1);
  assert.equal(state.phase, "list-error");
  assert.deepEqual(state.path, []);
  assert.deepEqual(state.files, [{ id: "root-pdf", name: "root.pdf", mimeType: "application/pdf" }]);
});

test("folder-tree siblings target the correct loaded ancestor, including a shared root", async () => {
  const requests = [];
  const states = [];
  const folder = (id, name) => ({ id, name, mimeType: "application/vnd.google-apps.folder" });
  const flow = await createFlow({
    invoke: async (command, args = {}) => {
      requests.push([command, args]);
      if (command === "drive_authenticate") return { connected: true };
      if (args.sharedWithMe) return { files: [folder("shared-a", "Shared A"), folder("shared-root-sibling", "Shared sibling")] };
      if (args.folderId === "shared-a") return { files: [folder("shared-b", "Shared B"), folder("shared-c", "Shared C")] };
      if (args.folderId === "shared-b" || args.folderId === "shared-c") return { files: [] };
      if (args.folderId === "root") return { files: [folder("my-a", "My A"), folder("my-root-sibling", "My sibling")] };
      if (args.folderId === "my-a") return { files: [folder("my-b", "My B"), folder("my-c", "My C")] };
      return { files: [] };
    },
    onState: (state) => states.push(state),
  });

  await flow.signIn();
  await flow.openFolder("my-a", "My A");
  await flow.openFolder("my-b", "My B");
  await flow.openFolderAt(1, "my-c", "My C");
  assert.deepEqual(states.at(-1).path.map(({ id }) => id), ["my-a", "my-c"]);
  assert.deepEqual(states.at(-1).ancestors.map(({ files }) => files.map(({ id }) => id)), [["my-a", "my-root-sibling"], ["my-b", "my-c"]]);
  await flow.openFolderAt(0, "my-root-sibling", "My sibling");
  assert.deepEqual(requests.at(-1), ["drive_list_pdfs", { folderId: "my-root-sibling" }]);
  assert.deepEqual(states.at(-1).path.map(({ id }) => id), ["my-root-sibling"]);

  await flow.showSharedWithMe();
  await flow.openFolder("shared-a", "Shared A");
  await flow.openFolder("shared-b", "Shared B");
  await flow.openFolderAt(1, "shared-c", "Shared C");
  assert.deepEqual(requests.at(-1), ["drive_list_pdfs", { folderId: "shared-c" }]);
  assert.deepEqual(states.at(-1).path.map(({ id }) => id), ["shared-a", "shared-c"]);
  assert.equal(states.at(-1).sharedWithMe, true);
  assert.deepEqual(states.at(-1).ancestors.map(({ files }) => files.map(({ id }) => id)), [["shared-a", "shared-root-sibling"], ["shared-b", "shared-c"]]);
});

test("a listing error after sign-in keeps the confirmed session connected", async () => {
  const states = [];
  const flow = await createFlow({
    invoke: async (command) => {
      if (command === "drive_authenticate") return { connected: true };
      if (command === "drive_list_pdfs") throw new Error("temporary list failure");
      if (command === "drive_get_auth_status") return { connected: true };
      return {};
    },
    onState: (state) => states.push(state),
  });

  assert.equal(await flow.signIn(), false);
  assert.equal(states.at(-1).phase, "connected-error");
});

test("checking the current account resets navigation to My Drive root", async () => {
  const listedFolders = [];
  const states = [];
  const flow = await createFlow({
    invoke: async (command, args = {}) => {
      if (command === "drive_get_auth_status") return { connected: true };
      if (command === "drive_authenticate") return { connected: true };
      if (command === "drive_list_pdfs") { listedFolders.push(args.folderId); return { files: [] }; }
      return {};
    },
    onState: (state) => states.push(state),
  });

  await flow.signIn();
  await flow.openFolder("folder-a", "Folder A");
  assert.equal(await flow.checkStatus(), true);
  assert.deepEqual(listedFolders, ["root", "folder-a", "root"]);
  assert.deepEqual(states.at(-1).path, []);
  assert.equal(states.at(-1).sharedWithMe, false);
});

test("sign-out reset ignores a late folder response and clears the current path", async () => {
  let finishFolder;
  const states = [];
  const flow = await createFlow({
    invoke: async (command, args = {}) => {
      if (command === "drive_authenticate") return { connected: true };
      if (args.folderId === "folder-a") return new Promise((resolve) => { finishFolder = resolve; });
      return { files: [{ id: "root-pdf", name: "root.pdf", mimeType: "application/pdf" }] };
    },
    onState: (state) => states.push(state),
  });

  await flow.signIn();
  const navigation = flow.openFolder("folder-a", "Folder A");
  await new Promise((resolve) => setImmediate(resolve));
  flow.reset();
  finishFolder({ files: [{ id: "late-pdf", name: "late.pdf", mimeType: "application/pdf" }] });
  assert.equal(await navigation, false);
  assert.equal(states.at(-1).phase, "needs-login");
  assert.deepEqual(states.at(-1).path, []);
  assert.deepEqual(states.at(-1).ancestors, []);
});
