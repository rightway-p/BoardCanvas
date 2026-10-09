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

test("branch deployment maps dev to beta and main to reviewed stable publishing", () => {
  const workflow = readFileSync(path.join(root, ".github", "workflows", "signed-release.yml"), "utf8");
  assert.match(workflow, /push:\s*\n\s+branches:\s*\n\s+- dev\s*\n\s+- main/);
  const pushPaths = workflow.match(/push:\s*\n(?:.*\n)*?\s+paths:\s*\n((?:\s+- .*\n)+)/)[1];
  assert.deepEqual(pushPaths.trim().split(/\r?\n/).map((line) => line.trim()), [
    "- package.json",
    "- src-tauri/Cargo.toml",
    "- src-tauri/tauri.conf.json",
  ]);
  assert.doesNotMatch(pushPaths, /\.github\/workflows/);
  assert.match(workflow, /concurrency:\s*\n\s+group: signed-release-\$\{\{ github\.ref \}\}\s*\n\s+cancel-in-progress: false/);
  assert.match(workflow, /expectedChannel = if \(\$env:REF_NAME -eq 'dev'\) \{ 'beta' \} else \{ 'stable' \}/);
  assert.match(workflow, /workflow_dispatch' -and \$env:INPUT_CHANNEL -cne \$expectedChannel/);
  assert.match(workflow, /environment:\s*\n\s+name:\s*\$\{\{ needs\.validate\.outputs\.channel == 'stable' && 'stable-release'/);
  assert.match(workflow, /BOARD_RELEASE_VERSION/);
  assert.match(workflow, /docs\/release-validation/);
  assert.match(workflow, /status:\\s\*reviewed/);
  assert.match(workflow, /hardware_validation:\\s\*passed/);
  assert.match(workflow, /beta_validation:\\s\*passed/);
  assert.match(workflow, /reviewer:\\s\*\\S\+/);
  assert.match(workflow, /Version \$version is already completely published; this rerun is a no-op/);
  assert.match(workflow, /latestRelease\.tagName -cne \$tag/);
  assert.match(workflow, /immutable version tag points to a different source commit/);
  assert.match(workflow, /Create the immutable version tag after successful validation and build/);
  assert.match(workflow, /git config --local user\.name 'github-actions\[bot\]'\s*\n\s+git config --local user\.email '41898282\+github-actions\[bot\]@users\.noreply\.github\.com'\s*\n\s+git tag -a/);
  const betaPublish = workflow.slice(workflow.indexOf("- name: Publish versioned beta installer"), workflow.indexOf("- name: Publish stable release"));
  assert.match(betaPublish, /git ls-remote origin refs\/heads\/dev/);
  assert.match(betaPublish, /latestDevSha -cne \$env:SOURCE_SHA/);
  assert.ok(betaPublish.indexOf("Skipping rolling beta feed update") < betaPublish.indexOf("gh release upload board-beta"));
  const stablePublish = workflow.slice(workflow.indexOf("- name: Publish stable release"));
  assert.match(stablePublish, /git ls-remote origin refs\/heads\/main/);
  assert.match(stablePublish, /superseded on main; publishing \$env:VERSION without changing GitHub's latest release pointer/);
  assert.match(stablePublish, /latestArgs = @\('--latest=true'\)/);
  assert.match(stablePublish, /latestArgs = @\('--latest=false'\)/);
  assert.match(stablePublish, /gh release create "v\$env:VERSION" @assets @latestArgs/);
  assert.match(workflow, /BoardCanvas_\$\(\$env:VERSION\)_x64-setup\.exe\.sig/);
});

test("existing signed release reruns fail closed on incomplete assets or stale feeds", { skip: process.platform !== "win32" }, () => {
  const workflow = readFileSync(path.join(root, ".github", "workflows", "signed-release.yml"), "utf8");
  const start = workflow.indexOf("          # BEGIN existing immutable release verification\n");
  const end = workflow.indexOf("          # END existing immutable release verification\n", start);
  assert.ok(start >= 0 && end > start, "workflow replay verification block markers must exist");
  const verification = workflow.slice(start, end).split(/\r?\n/).map((line) => line.slice(10)).join("\n");
  const fixture = mkdtempSync(path.join(os.tmpdir(), "boardcanvas-release-replay-"));
  try {
    const script = path.join(fixture, "verify-replay.ps1");
    const outputPath = path.join(fixture, "github-output.txt");
    const wrapper = String.raw`
$ErrorActionPreference = 'Stop'
function git {
  if ($args[0] -eq 'ls-remote' -and $args[1] -eq '--tags') { $global:LASTEXITCODE = 0; return "$env:MOCK_SOURCE_SHA refs/tags/v$env:VERSION" }
  if ($args[0] -eq 'ls-remote') { $global:LASTEXITCODE = 0; return "$env:MOCK_BRANCH_SHA $($args[-1])" }
  if ($args[0] -eq 'fetch') { $global:LASTEXITCODE = 0; return }
  if ($args[0] -eq 'rev-parse') { $global:LASTEXITCODE = 0; return $env:MOCK_SOURCE_SHA }
  throw "unexpected git command: $args"
}
function gh {
  if ($args[0] -eq 'api') {
    if ($args[1] -eq "repos/$env:REPOSITORY/releases/tags/v$env:VERSION") { $global:LASTEXITCODE = 0; return $env:MOCK_VERSION_RELEASE }
    if ($args[1] -eq "repos/$env:REPOSITORY/releases/tags/board-beta") {
      if ($env:MOCK_FAIL_ON_FEED -eq 'true') { throw 'unexpected rolling feed inspection' }
      $global:LASTEXITCODE = 0; return $env:MOCK_FEED_RELEASE
    }
  }
  if ($args[0] -eq 'release' -and $args[1] -eq 'view') {
    if ($args[2] -eq '--repo') { $global:LASTEXITCODE = 0; return $env:MOCK_LATEST_RELEASE }
  }
  if ($args[0] -eq 'release' -and $args[1] -eq 'download') {
    $directory = $args[($args.IndexOf('--dir') + 1)]
    $manifest = if ($args[2] -eq 'board-beta') { $env:MOCK_FEED_MANIFEST } else { $env:MOCK_VERSION_MANIFEST }
    $signature = if ($args[2] -eq 'board-beta') { $env:MOCK_FEED_SIGNATURE } else { $env:MOCK_VERSION_SIGNATURE }
    [IO.File]::WriteAllText((Join-Path $directory 'board-release.json'), $manifest)
    [IO.File]::WriteAllText((Join-Path $directory 'board-release.json.sig'), $signature)
    $global:LASTEXITCODE = 0; return
  }
  throw "unexpected gh command: $args"
}
$version = $env:VERSION
$channel = $env:CHANNEL
` + verification;
    writeFileSync(script, wrapper);

    const version = "2.0.1-beta.7";
    const sourceSha = "0123456789abcdef0123456789abcdef01234567";
    const completeAssets = [
      `BoardCanvas_${version}_x64-setup.exe`,
      `BoardCanvas_${version}_x64-setup.exe.sig`,
      "board-release.json",
      "board-release.json.sig",
    ].map((name) => ({ name }));
    const versionedRelease = { draft: false, prerelease: true, assets: completeAssets };
    const feedRelease = { draft: false, prerelease: true, assets: [{ name: "board-release.json" }, { name: "board-release.json.sig" }] };
    const run = ({ release = versionedRelease, feed = feedRelease, manifest = { version, channel: "beta" }, feedSignature = "fixture-signature", versionSignature = "fixture-signature", branchSha = sourceSha, failOnFeed = false, channel = "beta", latest = { tagName: `v${version}` } } = {}) => {
      const env = {
        ...process.env,
        VERSION: version,
        CHANNEL: channel,
        SOURCE_SHA: sourceSha,
        REPOSITORY: "example/boardcanvas",
        GITHUB_OUTPUT: outputPath,
        RUNNER_TEMP: fixture,
        MOCK_SOURCE_SHA: sourceSha,
        MOCK_BRANCH_SHA: branchSha,
        MOCK_VERSION_RELEASE: JSON.stringify(release),
        MOCK_FEED_RELEASE: JSON.stringify(feed),
        MOCK_FEED_MANIFEST: JSON.stringify(manifest),
        MOCK_VERSION_MANIFEST: JSON.stringify({ version, channel: "beta" }),
        MOCK_FEED_SIGNATURE: feedSignature,
        MOCK_VERSION_SIGNATURE: versionSignature,
        MOCK_LATEST_RELEASE: JSON.stringify(latest),
        MOCK_FAIL_ON_FEED: failOnFeed ? "true" : "false",
      };
      for (const name of [`existing-version-metadata-${version}`, `existing-beta-feed-${version}`]) rmSync(path.join(fixture, name), { recursive: true, force: true });
      writeFileSync(outputPath, "");
      return require("node:child_process").spawnSync("pwsh.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], { cwd: fixture, env, encoding: "utf8" });
    };

    const missingAssets = run({ release: { ...versionedRelease, assets: completeAssets.slice(0, 3) } });
    assert.notEqual(missingAssets.status, 0);
    assert.match(missingAssets.stdout + missingAssets.stderr, /incomplete/);

    const staleFeed = run({ manifest: { version: "2.0.1-beta.6", channel: "beta" } });
    assert.notEqual(staleFeed.status, 0);
    assert.match(staleFeed.stdout + staleFeed.stderr, /versioned signed pair/);

    const partialSignaturePair = run({ manifest: { version, channel: "beta" }, feedSignature: "old-feed-signature" });
    assert.notEqual(partialSignaturePair.status, 0);
    assert.match(partialSignaturePair.stdout + partialSignaturePair.stderr, /versioned signed pair/);

    const completeReplay = run();
    assert.equal(completeReplay.status, 0, completeReplay.stdout + completeReplay.stderr);
    assert.match(readFileSync(outputPath, "utf8"), /skip_release=true/);

    const supersededReplay = run({ branchSha: "fedcba9876543210fedcba9876543210fedcba98", failOnFeed: true });
    assert.equal(supersededReplay.status, 0, supersededReplay.stdout + supersededReplay.stderr);
    assert.match(supersededReplay.stdout, /superseded on dev/);

    const unfinishedDraft = run({ release: { ...versionedRelease, draft: true } });
    assert.notEqual(unfinishedDraft.status, 0);
    assert.match(unfinishedDraft.stdout + unfinishedDraft.stderr, /incomplete \(draft/);

    const draftFeed = run({ feed: { ...feedRelease, draft: true } });
    assert.notEqual(draftFeed.status, 0);
    assert.match(draftFeed.stdout + draftFeed.stderr, /rolling beta feed is draft or incomplete/);

    const staleStableLatest = run({ channel: "stable", release: { draft: false, prerelease: false, assets: completeAssets }, latest: { tagName: "v2.0.1" } });
    assert.notEqual(staleStableLatest.status, 0);
    assert.match(staleStableLatest.stdout + staleStableLatest.stderr, /latest release is v2\.0\.1/);

    const completeStableReplay = run({ channel: "stable", release: { draft: false, prerelease: false, assets: completeAssets }, latest: { tagName: `v${version}` } });
    assert.equal(completeStableReplay.status, 0, completeStableReplay.stdout + completeStableReplay.stderr);
    assert.match(readFileSync(outputPath, "utf8"), /skip_release=true/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
