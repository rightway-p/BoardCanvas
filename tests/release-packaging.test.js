const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync, existsSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("signed packaging emits the required camelCase metadata with an isolated fake signer", { skip: process.platform !== "win32" }, () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "boardcanvas-release-fixture-"));
  try {
    const scripts = path.join(fixture, "scripts");
    const source = path.join(fixture, "src-tauri");
    const target = path.join(source, "target", "release");
    const feed = path.join(fixture, "feed");
    const bin = path.join(fixture, "bin");
    mkdirSync(scripts, { recursive: true });
    mkdirSync(path.join(source, "resources"), { recursive: true });
    mkdirSync(target, { recursive: true });
    mkdirSync(feed, { recursive: true });
    mkdirSync(bin, { recursive: true });
    cpSync(path.join(root, "scripts", "package-signed-release.ps1"), path.join(scripts, "package-signed-release.ps1"));
    writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ version: "2.0.1-beta.2" }));
    writeFileSync(path.join(source, "updater.pub"), "fixture-public-key\n");
    writeFileSync(path.join(source, "tauri.conf.json"), JSON.stringify({ package: { version: "2.0.1-beta.2" } }));
    writeFileSync(path.join(source, "resources", "boardcanvas-recovery.exe"), "helper");
    writeFileSync(path.join(target, "boardcanvas.exe"), "executable");
    const expectedInstallerName = "BoardCanvas_2.0.1-beta.2_x64-setup.exe";
    const installer = path.join(fixture, expectedInstallerName);
    writeFileSync(installer, "installer");
    writeFileSync(path.join(bin, "npx.cmd"), "@echo off\nnode \"%~dp0fake-npx.mjs\" %*\n");
    writeFileSync(path.join(bin, "fake-npx.mjs"), "import fs from 'node:fs'; const args = process.argv.slice(2); const signIndex = args.indexOf('sign'); const target = signIndex >= 0 ? args[signIndex + 1] : undefined; if (!target) throw new Error('missing signer target'); console.log(process.env.TAURI_PRIVATE_KEY); console.log(process.env.TAURI_KEY_PASSWORD); fs.writeFileSync(`${target}.sig`, 'fixture-signature');\n");

    const output = path.join(feed, "v2.0.1-beta.2");
    const fakePrivateKey = "fixture-alpha";
    const fakeKeyPassword = "fixture-bravo";
    assert.equal(fakePrivateKey.length, fakeKeyPassword.length);
    const env = { ...process.env, TAURI_PRIVATE_KEY: fakePrivateKey, TAURI_KEY_PASSWORD: fakeKeyPassword, TAURI_UPDATER_PUBLIC_KEY: "fixture-public-key", BOARD_RECOVERY_TEST_FEED: feed, BOARD_RELEASE_CHANNEL: "beta", BOARD_RELEASE_VERSION: "2.0.1-beta.2", PATH: `${bin};${process.env.PATH}` };
    const packageOutput = execFileSync("pwsh.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(scripts, "package-signed-release.ps1"), "-Version", "2.0.1-beta.2", "-Channel", "beta", "-InstallerPath", installer, "-OutputDirectory", output, "-TauriConfigPath", path.join(source, "tauri.conf.json"), "-LocalTestFeedRoot", feed], { cwd: fixture, env, stdio: "pipe" }).toString("utf8");
    assert.doesNotMatch(packageOutput, new RegExp(fakePrivateKey));
    assert.doesNotMatch(packageOutput, new RegExp(fakeKeyPassword));

    const manifest = JSON.parse(readFileSync(path.join(output, "board-release.json"), "utf8"));
    assert.deepEqual(Object.keys(manifest).sort(), ["appId", "arch", "channel", "data", "executable", "formatVersion", "installKind", "installer", "platform", "version"]);
    assert.equal(manifest.formatVersion, 1);
    assert.equal(manifest.channel, "beta");
    assert.equal(manifest.version, "2.0.1-beta.2");
    assert.equal(manifest.installKind, "nsis-current-user");
    assert.equal(manifest.installer.filename, expectedInstallerName);
    assert.match(manifest.installer.url, /^file:\/\//);
    assert.equal(manifest.installer.signature, "fixture-signature");
    assert.equal(manifest.executable.relativePath, "boardcanvas.exe");
    assert.deepEqual(manifest.data, { writesSchema: 1, readsSchemas: [1] });
    assert.equal(readFileSync(path.join(output, "board-release.json.sig"), "utf8"), "fixture-signature");

    const wrongInstaller = path.join(fixture, "boardcanvas-recovery_2.0.1-beta.2_x64-setup.exe");
    const rejectedOutput = path.join(feed, "rejected-helper-installer");
    writeFileSync(wrongInstaller, "helper-installer");
    assert.throws(() => execFileSync("pwsh.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(scripts, "package-signed-release.ps1"), "-Version", "2.0.1-beta.2", "-Channel", "beta", "-InstallerPath", wrongInstaller, "-OutputDirectory", rejectedOutput, "-TauriConfigPath", path.join(source, "tauri.conf.json"), "-LocalTestFeedRoot", feed], { cwd: fixture, env, stdio: "pipe" }), /Installer filename must be BoardCanvas_2\.0\.1-beta\.2_x64-setup\.exe/);
    assert.equal(existsSync(rejectedOutput), false);

    rmSync(path.join(source, "resources", "boardcanvas-recovery.exe"));
    assert.throws(() => execFileSync("pwsh.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(scripts, "package-signed-release.ps1"), "-Version", "2.0.1-beta.2", "-Channel", "beta", "-InstallerPath", installer, "-OutputDirectory", path.join(feed, "missing-helper"), "-TauriConfigPath", path.join(source, "tauri.conf.json"), "-LocalTestFeedRoot", feed], { cwd: fixture, env, stdio: "pipe" }), /recovery helper resource/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("stable publishing is gated by the protected environment and an explicit reviewed record", () => {
  const workflow = readFileSync(path.join(root, ".github", "workflows", "signed-release.yml"), "utf8");
  assert.match(workflow, /environment:\s*\$\{\{ inputs\.channel == 'stable' && 'stable-release'/);
  assert.match(workflow, /BOARD_RELEASE_VERSION/);
  assert.match(workflow, /docs\/release-validation/);
  assert.match(workflow, /status:\\s\*reviewed/);
  assert.match(workflow, /hardware_validation:\\s\*passed/);
});
