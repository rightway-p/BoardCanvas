const test = require("node:test");
const assert = require("node:assert/strict");
const { releaseNotesFor, releaseNotesSeenKey, recordReleaseNotesRunningVersion, recordReleaseNotesShown, shouldShowReleaseNotes } = require("../js/release-notes.mjs");

test("release notes show once after an evidenced upgrade, never on first install", () => {
  assert.equal(shouldShowReleaseNotes({ version: "2.0.1-beta.7" }), false);
  assert.equal(shouldShowReleaseNotes({ version: "2.0.1-beta.7", previousVersion: "2.0.1-beta.6" }), true);
  assert.equal(shouldShowReleaseNotes({ version: "2.0.1-beta.7", lastRunningVersion: "2.0.1-beta.6" }), true);
  assert.equal(shouldShowReleaseNotes({ version: "2.0.1-beta.7", previousVersion: "2.0.1-beta.8" }), false);
  assert.equal(shouldShowReleaseNotes({ version: "2.0.1-beta.7", lastRunningVersion: "2.0.1-beta.8" }), false);
  assert.equal(shouldShowReleaseNotes({ version: "2.0.1-beta.7", previousVersion: "2.0.1-beta.6", versionShown: true }), false);
  const shown = new Set([releaseNotesSeenKey("2.0.1-beta.7")]);
  assert.equal(shouldShowReleaseNotes({ version: "2.0.1-beta.7", previousVersion: "2.0.1-beta.6", versionShown: shown.has(releaseNotesSeenKey("2.0.1-beta.7")) }), false);
  assert.notEqual(releaseNotesSeenKey("2.0.1-beta.7"), releaseNotesSeenKey("2.0.1-beta.8"));
  assert.equal(releaseNotesFor("2.0.1-beta.7").length, 4);
});

test("a no-notes launch records its running version so a later notes version is detected", () => {
  const storage = new Map();
  const writableStorage = { setItem: (key, value) => storage.set(key, value) };
  assert.equal(releaseNotesFor("2.0.1-beta.6"), null);
  assert.equal(recordReleaseNotesRunningVersion("2.0.1-beta.6", writableStorage), true);
  assert.equal(shouldShowReleaseNotes({ version: "2.0.1-beta.7", lastRunningVersion: storage.get("board.release-notes.last-running-version.v1") }), true);
});

test("failed seen-state persistence leaves the prior running version for a retry", () => {
  const storage = new Map([["board.release-notes.last-running-version.v1", "2.0.1-beta.6"]]);
  const failingStorage = {
    setItem(key, value) {
      if (key === releaseNotesSeenKey("2.0.1-beta.7")) throw new Error("quota");
      storage.set(key, value);
    },
  };
  assert.equal(recordReleaseNotesShown("2.0.1-beta.7", failingStorage), false);
  assert.equal(storage.get("board.release-notes.last-running-version.v1"), "2.0.1-beta.6");
  assert.equal(shouldShowReleaseNotes({ version: "2.0.1-beta.7", lastRunningVersion: storage.get("board.release-notes.last-running-version.v1") }), true);
  const workingStorage = { setItem: (key, value) => storage.set(key, value) };
  assert.equal(recordReleaseNotesShown("2.0.1-beta.7", workingStorage), true);
  assert.equal(shouldShowReleaseNotes({ version: "2.0.1-beta.7", lastRunningVersion: storage.get("board.release-notes.last-running-version.v1"), versionShown: storage.get(releaseNotesSeenKey("2.0.1-beta.7")) === "true" }), false);
});
