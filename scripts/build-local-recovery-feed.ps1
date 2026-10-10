param(
  [Parameter(Mandatory = $true)][string]$FeedRoot,
  [string]$BaselineVersion = '2.0.1-beta.1',
  [string]$UpdateVersion = '2.0.1-beta.2',
  [string]$PrivateKeyPath = (Join-Path $HOME '.codex/private/boardcanvas-updater/updater.key'),
  [string]$ProtectedPasswordPath = (Join-Path $HOME '.codex/private/boardcanvas-updater/key-password.dpapi')
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$feedRoot = [IO.Path]::GetFullPath($FeedRoot)
if (Test-Path -LiteralPath $feedRoot) { throw "Fixture root already exists; choose a new directory: $feedRoot" }
if (-not (Test-Path -LiteralPath $PrivateKeyPath -PathType Leaf)) { throw 'Encrypted updater private key was not found.' }
if (-not (Test-Path -LiteralPath $ProtectedPasswordPath -PathType Leaf)) { throw 'User-protected updater password was not found.' }
$securePassword = ConvertTo-SecureString -String ((Get-Content -Raw -LiteralPath $ProtectedPasswordPath).Trim())
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
$oldPrivateKey = $env:TAURI_PRIVATE_KEY
$oldPassword = $env:TAURI_KEY_PASSWORD
$oldPublicKey = $env:TAURI_UPDATER_PUBLIC_KEY
$oldFeed = $env:BOARD_RECOVERY_TEST_FEED
$oldChannel = $env:BOARD_RELEASE_CHANNEL
$oldVersion = $env:BOARD_RELEASE_VERSION
try {
  $env:TAURI_PRIVATE_KEY = [IO.Path]::GetFullPath($PrivateKeyPath)
  $env:TAURI_KEY_PASSWORD = $plainPassword
  $env:TAURI_UPDATER_PUBLIC_KEY = (Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'src-tauri/updater.pub')).Trim()
  $env:BOARD_RECOVERY_TEST_FEED = $feedRoot
  $env:BOARD_RELEASE_CHANNEL = 'beta'
  $helperBuild = & cargo build --manifest-path (Join-Path $repoRoot 'src-tauri/Cargo.toml') --bin boardcanvas-recovery --features recovery-helper-build,recovery-test-feed --release 2>&1
  foreach ($line in $helperBuild) { Write-Output $line }
  if ($LASTEXITCODE -ne 0) { throw 'Recovery helper build failed.' }
  $resourceDirectory = Join-Path $repoRoot 'src-tauri/resources'
  New-Item -ItemType Directory -Force -Path $resourceDirectory | Out-Null
  Copy-Item -LiteralPath (Join-Path $repoRoot 'src-tauri/target/release/boardcanvas-recovery.exe') -Destination (Join-Path $resourceDirectory 'boardcanvas-recovery.exe') -Force
  New-Item -ItemType Directory -Path $feedRoot | Out-Null

  $versions = @($BaselineVersion, $UpdateVersion)
  for ($index = 0; $index -lt $versions.Length; $index++) {
    $version = $versions[$index]
    if ($version -notmatch '^\d+\.\d+\.\d+-beta\.\d+$') { throw "Unsupported local beta version: $version" }
    $env:BOARD_RELEASE_VERSION = $version
    $configPath = Join-Path $feedRoot ".tauri-config-$version.json"
    $config = @{ package = @{ version = $version } } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($configPath, $config, [Text.UTF8Encoding]::new($false))
    $buildArgs = @('tauri', 'build', '--features', 'recovery-test-feed', '--config', $configPath)
    $buildOutput = & npx --no-install @buildArgs 2>&1
    $buildExitCode = $LASTEXITCODE
    foreach ($line in $buildOutput) { Write-Output $line }
    if ($buildExitCode -ne 0) { throw "Tauri build failed for $version." }

    $bundleRoot = Join-Path $repoRoot 'src-tauri/target/release/bundle/nsis'
    $expectedInstallerName = "BoardCanvas_${version}_x64-setup.exe"
    $installerPath = Join-Path $bundleRoot $expectedInstallerName
    if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) { throw "Tauri did not produce the expected NSIS installer for ${version}: $expectedInstallerName" }
    $installer = Get-Item -LiteralPath $installerPath
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'src-tauri/target/release/boardcanvas.exe') -PathType Leaf)) { throw 'Built app executable was not found.' }

    $outputDirectory = Join-Path $feedRoot "v$version"
    & (Join-Path $PSScriptRoot 'package-signed-release.ps1') -Version $version -Channel beta -InstallerPath $installer.FullName -OutputDirectory $outputDirectory -TauriConfigPath $configPath -LocalTestFeedRoot $feedRoot -AllowPackageVersionMismatch
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "Signing failed for $version." }
    Remove-Item -LiteralPath $configPath
  }

  $latest = Join-Path $feedRoot "v$UpdateVersion"
  Copy-Item -LiteralPath (Join-Path $latest 'board-release.json') -Destination (Join-Path $feedRoot 'board-release.json')
  Copy-Item -LiteralPath (Join-Path $latest 'board-release.json.sig') -Destination (Join-Path $feedRoot 'board-release.json.sig')
  Write-Output "Signed local beta fixture feed created at $feedRoot"
  Write-Output "Baseline: $BaselineVersion; update: $UpdateVersion; rollback metadata retained in each version folder."
} finally {
  $env:TAURI_PRIVATE_KEY = $oldPrivateKey
  $env:TAURI_KEY_PASSWORD = $oldPassword
  $env:TAURI_UPDATER_PUBLIC_KEY = $oldPublicKey
  $env:BOARD_RECOVERY_TEST_FEED = $oldFeed
  $env:BOARD_RELEASE_CHANNEL = $oldChannel
  $env:BOARD_RELEASE_VERSION = $oldVersion
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  Remove-Variable plainPassword, securePassword, passwordPointer -ErrorAction SilentlyContinue
}
