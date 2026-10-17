const test = require("node:test");
const assert = require("node:assert/strict");
const { releaseNotesFor, releaseNotesSeenKey, recordReleaseNotesRunningVersion, recordReleaseNotesShown, shouldShowReleaseNotes } = require("../js/release-notes.mjs");

test("release notes show once after an evidenced upgrade, never on first install", () => {
  assert.equal(shouldShowReleaseNotes({ version: "2.0.1-beta.12" }), false);
  assert.equal(shouldShowReleaseNotes({ version: "2.0.1-beta.12", previousVersion: "2.0.1-beta.11" }), true);
  assert.equal(releaseNotesFor("2.0.1-beta.12").length, 3);
  assert.match(releaseNotesFor("2.0.1-beta.12")[0], /내 드라이브/);
  assert.match(releaseNotesFor("2.0.1-beta.12")[1], /공유 문서함/);
  assert.match(releaseNotesFor("2.0.1-beta.12")[2], /줄바꿈/);
  assert.equal(shouldShowReleaseNotes({ version: "2.0.1-beta.11" }), false);
  assert.equal(shouldShowReleaseNotes({ version: "2.0.1-beta.11", previousVersion: "2.0.1-beta.10" }), true);
  assert.equal(releaseNotesFor("2.0.1-beta.11").length, 3);
  assert.match(releaseNotesFor("2.0.1-beta.11")[2], /권한 코드 수신만 알리고/);
  assert.equal(shouldShowReleaseNotes({ version: "2.0.1-beta.10" }), false);
  assert.equal(shouldShowReleaseNotes({ version: "2.0.1-beta.10", previousVersion: "2.0.1-beta.9" }), true);
  assert.equal(releaseNotesFor("2.0.1-beta.10").length, 4);
  assert.equal(shouldShowReleaseNotes({ version: "2.0.1-beta.9" }), false);
  assert.equal(shouldShowReleaseNotes({ version: "2.0.1-beta.9", previousVersion: "2.0.1-beta.8" }), true);
  assert.equal(releaseNotesFor("2.0.1-beta.9").length, 3);
  assert.equal(shouldShowReleaseNotes({ version: "2.0.1-beta.8" }), false);
  assert.equal(shouldShowReleaseNotes({ version: "2.0.1-beta.8", previousVersion: "2.0.1-beta.7" }), true);
  assert.equal(releaseNotesFor("2.0.1-beta.8").length, 3);
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
