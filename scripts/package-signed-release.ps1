param(
  [Parameter(Mandatory = $true)][string]$Version,
  [ValidateSet('beta', 'stable')][string]$Channel = 'beta',
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [string]$TauriConfigPath,
  [string]$LocalTestFeedRoot,
  [switch]$AllowPackageVersionMismatch
)

$ErrorActionPreference = 'Stop'

if ($Version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') { throw 'Version must use semantic version syntax.' }
if ($env:BOARD_RELEASE_VERSION -and $env:BOARD_RELEASE_VERSION -ne $Version) { throw 'BOARD_RELEASE_VERSION must match the release version.' }
if (-not $env:TAURI_PRIVATE_KEY) { throw 'TAURI_PRIVATE_KEY is required.' }
if (-not $env:TAURI_KEY_PASSWORD) { throw 'TAURI_KEY_PASSWORD is required.' }
if (-not $env:TAURI_UPDATER_PUBLIC_KEY) { throw 'TAURI_UPDATER_PUBLIC_KEY is required.' }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$package = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'package.json') | ConvertFrom-Json
$tauriPath = if ($TauriConfigPath) { [IO.Path]::GetFullPath($TauriConfigPath) } else { Join-Path $repoRoot 'src-tauri/tauri.conf.json' }
$tauri = Get-Content -Raw -LiteralPath $tauriPath | ConvertFrom-Json
if ($tauri.package.version -ne $Version) {
  throw "Release version $Version must match the selected Tauri config package.version."
}
if ($package.version -ne $Version -and -not $AllowPackageVersionMismatch) {
  throw "Release version $Version must match package.json."
}
$publicKey = (Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'src-tauri/updater.pub')).Trim()
if ($publicKey -cne $env:TAURI_UPDATER_PUBLIC_KEY.Trim()) { throw 'Configured public-key secret does not match src-tauri/updater.pub.' }

$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
if ([IO.Path]::GetExtension($installer) -ne '.exe') { throw 'Installer must be the Windows NSIS .exe.' }
$expectedInstallerName = "BoardCanvas_${Version}_x64-setup.exe"
if ((Split-Path -Leaf $installer) -cne $expectedInstallerName) { throw "Installer filename must be $expectedInstallerName." }
$helper = Join-Path $repoRoot 'src-tauri/resources/boardcanvas-recovery.exe'
if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) { throw 'The recovery helper resource must be built before packaging.' }

$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw "Output directory already exists; choose a new directory: $output" }
if ($LocalTestFeedRoot) {
  if ($Channel -ne 'beta') { throw 'Local test fixtures must use the beta channel.' }
  $feedRoot = [IO.Path]::GetFullPath($LocalTestFeedRoot).TrimEnd('\')
  if ($output -ne (Join-Path $feedRoot "v$Version")) { throw 'Local test output must be written to the versioned folder inside the feed root.' }
  if (-not $env:BOARD_RECOVERY_TEST_FEED -or [IO.Path]::GetFullPath($env:BOARD_RECOVERY_TEST_FEED).TrimEnd('\') -ne $feedRoot) {
    throw 'BOARD_RECOVERY_TEST_FEED must point to the same local fixture root.'
  }
}
New-Item -ItemType Directory -Path $output | Out-Null
$installerName = "BoardCanvas_${Version}_x64-setup.exe"
$releaseInstaller = Join-Path $output $installerName
Copy-Item -LiteralPath $installer -Destination $releaseInstaller

function Invoke-TauriSign([string]$Path) {
  $keyArguments = if ([IO.File]::Exists($env:TAURI_PRIVATE_KEY)) {
    @('--private-key-path', [IO.Path]::GetFullPath($env:TAURI_PRIVATE_KEY))
  } else {
    @('--private-key', $env:TAURI_PRIVATE_KEY)
  }
  $signerArguments = @('tauri', 'signer', 'sign', $Path) + $keyArguments + @('--password', $env:TAURI_KEY_PASSWORD)
  $outputLines = & npx --no-install @signerArguments 2>&1
  $exitCode = $LASTEXITCODE
  $sensitiveValues = @($env:TAURI_PRIVATE_KEY, $env:TAURI_KEY_PASSWORD) | Where-Object { $_ } | Sort-Object Length -Descending
  foreach ($line in $outputLines) {
    $safeLine = [string]$line
    foreach ($sensitiveValue in $sensitiveValues) {
      $safeLine = $safeLine.Replace($sensitiveValue, '[REDACTED]')
    }
    if ($safeLine -match 'TAURI_PRIVATE_KEY|TAURI_KEY_PASSWORD|secret key|password') {
      Write-Host 'Signer emitted a sensitive diagnostic; details omitted.'
    } else {
      Write-Host $safeLine
    }
  }
  if ($exitCode -ne 0) { throw "Tauri signer failed for $(Split-Path -Leaf $Path)." }
  $signaturePath = "$Path.sig"
  if (-not (Test-Path -LiteralPath $signaturePath -PathType Leaf)) { throw "Signer did not create $(Split-Path -Leaf $signaturePath)." }
  return (Get-Content -Raw -LiteralPath $signaturePath).Trim()
}

$installerSignature = Invoke-TauriSign $releaseInstaller
$installerHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $releaseInstaller).Hash.ToLowerInvariant()
$installerSize = (Get-Item -LiteralPath $releaseInstaller).Length
$installerUrl = if ($LocalTestFeedRoot) { ([Uri]$releaseInstaller).AbsoluteUri } else { "https://github.com/rightway-p/BoardCanvas/releases/download/v$Version/$installerName" }
$manifest = [ordered]@{
  formatVersion = 1
  appId = 'com.rightway.boardcanvas'
  channel = $Channel
  version = $Version
  platform = 'windows'
  arch = 'x86_64'
  installKind = 'nsis-current-user'
  installer = [ordered]@{
    filename = $installerName
    sha256 = $installerHash
    size = $installerSize
    signature = $installerSignature
    url = $installerUrl
  }
  executable = [ordered]@{
    relativePath = 'boardcanvas.exe'
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $repoRoot 'src-tauri/target/release/boardcanvas.exe')).Hash.ToLowerInvariant()
  }
  data = [ordered]@{
    writesSchema = 1
    readsSchemas = @(1)
  }
}
$json = ConvertTo-Json -InputObject $manifest -Depth 8 -Compress
$manifestPath = Join-Path $output 'board-release.json'
[IO.File]::WriteAllText($manifestPath, $json, [Text.UTF8Encoding]::new($false))
$null = Invoke-TauriSign $manifestPath

Write-Output "Signed release assets created in $output"
Write-Output "Installer SHA-256: $installerHash"
Write-Output "Metadata: board-release.json and board-release.json.sig"
