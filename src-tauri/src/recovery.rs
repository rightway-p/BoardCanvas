use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

pub const APP_ID: &str = "com.rightway.boardcanvas";
pub const RELEASE_CHANNEL: &str = env!("BOARD_RELEASE_CHANNEL");
pub const INSTALLER_RELATIVE_PATH: &str = "BoardCanvas\\boardcanvas.exe";
pub const PROFILE_RELATIVE_PATH: &str = "com.rightway.boardcanvas";
pub const HELPER_RESOURCE: &str = "resources/boardcanvas-recovery.exe";
pub const METADATA_NAME: &str = "board-release.json";
pub const METADATA_SIGNATURE_NAME: &str = "board-release.json.sig";
pub const PUBLIC_KEY: &str = include_str!("../updater.pub");
pub const PRODUCTION_LATEST: &str =
  "https://github.com/rightway-p/BoardCanvas/releases/latest/download/board-release.json";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseManifest {
  pub format_version: u32,
  pub app_id: String,
  pub version: String,
  pub channel: String,
  pub platform: String,
  pub arch: String,
  pub install_kind: String,
  pub installer: Installer,
  pub executable: Executable,
  pub data: DataCompatibility,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Installer {
  pub filename: String,
  pub sha256: String,
  pub size: u64,
  pub signature: String,
  pub url: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Executable {
  pub relative_path: String,
  pub sha256: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DataCompatibility {
  pub writes_schema: u32,
  pub reads_schemas: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstallRecord {
  pub app_id: String,
  pub version: String,
  pub channel: String,
  pub platform: String,
  pub arch: String,
  pub install_kind: String,
  pub installer_sha256: String,
  pub executable_sha256: String,
  pub writes_schema: u32,
  pub reads_schemas: Vec<u32>,
}

impl InstallRecord {
  pub fn from_manifest(manifest: &ReleaseManifest) -> Self { record_from_manifest(manifest) }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Journal {
  pub format_version: u32,
  pub state: String,
  pub operation: String,
  pub operation_id: String,
  pub current: InstallRecord,
  pub previous: Option<InstallRecord>,
  pub target: Option<InstallRecord>,
  pub profile_schema: u32,
  pub profile_checkpoint: Option<String>,
  pub current_profile_backup: Option<String>,
  pub staged_installer: Option<String>,
  pub baseline_installer: Option<String>,
  pub message: Option<String>,
}

pub fn retain_rollback_after_recovery(journal: &mut Journal) -> bool {
  let can_retry = can_retry_previous_installer(journal);
  if can_retry {
    std::mem::swap(&mut journal.staged_installer, &mut journal.baseline_installer);
    true
  } else {
    journal.previous = None;
    journal.baseline_installer = None;
    false
  }
}

pub fn preserve_previous_installer_for_recovery(journal: &mut Journal) -> bool {
  let preserve = can_retry_previous_installer(journal);
  if !preserve { journal.staged_installer = journal.baseline_installer.clone(); }
  preserve
}

fn can_retry_previous_installer(journal: &Journal) -> bool {
  matches!(journal.operation.as_str(), "rollback" | "recover")
    && journal.previous.as_ref().is_some_and(|previous| previous != &journal.current)
    && journal.staged_installer.is_some()
    && journal.baseline_installer.is_some()
}

pub fn public_key() -> Result<PublicKey, String> {
  if PUBLIC_KEY.trim().is_empty() || PUBLIC_KEY.contains("UNCONFIGURED_RELEASE_PUBLIC_KEY") {
    return Err("The release signing key has not been configured.".into());
  }
  let decoded = decode_tauri_signing_value(PUBLIC_KEY)?;
  PublicKey::decode(&decoded).map_err(|error| format!("Invalid release public key: {error}"))
}

pub fn verify_signed_bytes(bytes: &[u8], signature_text: &str) -> Result<(), String> {
  let key = public_key()?;
  let decoded = decode_tauri_signing_value(signature_text)?;
  let signature = Signature::decode(&decoded).map_err(|error| format!("Invalid release signature: {error}"))?;
  key.verify(bytes, &signature, false).map_err(|error| format!("Release signature verification failed: {error}"))
}

fn decode_tauri_signing_value(value: &str) -> Result<String, String> {
  use base64::Engine;
  let bytes = base64::engine::general_purpose::STANDARD.decode(value.trim()).map_err(|error| format!("Invalid Tauri signature encoding: {error}"))?;
  String::from_utf8(bytes).map_err(|error| format!("Tauri signature data is not UTF-8: {error}"))
}

pub fn parse_manifest(bytes: &[u8], signature_text: &str) -> Result<ReleaseManifest, String> {
  verify_signed_bytes(bytes, signature_text)?;
  let manifest: ReleaseManifest = serde_json::from_slice(bytes).map_err(|error| format!("Invalid release metadata: {error}"))?;
  validate_manifest(&manifest)?;
  Ok(manifest)
}

pub fn validate_manifest(manifest: &ReleaseManifest) -> Result<(), String> {
  if manifest.format_version != 1
    || manifest.app_id != APP_ID
    || manifest.platform != "windows"
    || manifest.arch != "x86_64"
    || manifest.install_kind != "nsis-current-user"
    || manifest.executable.relative_path != "boardcanvas.exe"
    || manifest.data.writes_schema != 1
    || !manifest.data.reads_schemas.contains(&1)
  {
    return Err("The signed release metadata targets an unsupported app, platform, installer, executable, or data schema.".into());
  }
  let version = semver::Version::parse(&manifest.version).map_err(|_| "The signed release version is invalid.".to_string())?;
  if !matches!(manifest.channel.as_str(), "beta" | "stable") || (manifest.channel == "stable" && !version.pre.is_empty()) || (manifest.channel == "beta" && !version.pre.as_str().starts_with("beta.")) {
    return Err("The signed release version does not match the selected release channel.".into());
  }
  validate_sha256(&manifest.installer.sha256)?;
  validate_sha256(&manifest.executable.sha256)?;
  if manifest.installer.size == 0 || manifest.installer.filename.is_empty() || Path::new(&manifest.installer.filename).file_name().and_then(|n| n.to_str()) != Some(manifest.installer.filename.as_str()) {
    return Err("The signed installer filename or size is invalid.".into());
  }
  let url = url::Url::parse(&manifest.installer.url).map_err(|_| "The signed installer URL is invalid.".to_string())?;
  let github_url = url.scheme() == "https" && url.host_str() == Some("github.com") && url.path().starts_with("/rightway-p/BoardCanvas/releases/download/");
  #[cfg(feature = "recovery-test-feed")]
  let test_url = url.scheme() == "file" && url.to_file_path().is_ok_and(|path| test_feed_contains(&path));
  #[cfg(not(feature = "recovery-test-feed"))]
  let test_url = false;
  if !github_url && !test_url {
    return Err("The signed installer URL is outside the approved GitHub Releases location.".into());
  }
  if manifest.installer.signature.trim().is_empty() {
    return Err("The signed release metadata has no installer signature.".into());
  }
  Ok(())
}

pub fn verify_installer_bytes(manifest: &ReleaseManifest, bytes: &[u8]) -> Result<(), String> {
  if bytes.len() as u64 != manifest.installer.size || hex::encode(Sha256::digest(bytes)) != manifest.installer.sha256.to_ascii_lowercase() {
    return Err("The downloaded installer size or SHA-256 digest does not match the signed metadata.".into());
  }
  verify_signed_bytes(bytes, &manifest.installer.signature)
}

pub fn record_from_manifest(manifest: &ReleaseManifest) -> InstallRecord {
  InstallRecord {
    app_id: manifest.app_id.clone(), version: manifest.version.clone(), channel: manifest.channel.clone(), platform: manifest.platform.clone(),
    arch: manifest.arch.clone(), install_kind: manifest.install_kind.clone(),
    installer_sha256: manifest.installer.sha256.to_ascii_lowercase(), executable_sha256: manifest.executable.sha256.to_ascii_lowercase(),
    writes_schema: manifest.data.writes_schema, reads_schemas: manifest.data.reads_schemas.clone(),
  }
}

pub fn validate_operation(current: &InstallRecord, target: &InstallRecord, operation: &str) -> Result<(), String> {
  let current_version = semver::Version::parse(&current.version).map_err(|_| "Current version is invalid.".to_string())?;
  let target_version = semver::Version::parse(&target.version).map_err(|_| "Target version is invalid.".to_string())?;
  match operation {
    "update" if target_version > current_version => Ok(()),
    "promotion" if current.channel == "beta" && target.channel == "stable" => Ok(()),
    "rollback" => Ok(()),
    "recover" if current == target => Ok(()),
    "recover" => Err("Interrupted recovery can reinstall only the journal's pinned current baseline.".into()),
    "update" => Err("Normal updates must move to a newer version.".into()),
    "promotion" => Err("Returning to stable requires an explicit beta-to-stable operation.".into()),
    _ => Err("Unsupported recovery operation.".into()),
  }
}

pub fn latest_metadata_url_for(channel: &str) -> Result<String, String> {
  if !matches!(channel, "beta" | "stable") { return Err("Unsupported release channel.".into()); }
  #[cfg(feature = "recovery-test-feed")]
  {
    let directory = std::env::var_os("BOARD_RECOVERY_TEST_FEED").map(PathBuf::from).ok_or("The recovery test feed directory is not set.")?;
    if !directory.is_absolute() { return Err("The recovery test feed path must be absolute.".into()); }
    let name = if channel == "stable" { "stable-release.json" } else { METADATA_NAME };
    return file_url(&directory.join(name));
  }
  #[cfg(not(feature = "recovery-test-feed"))]
  {
    if channel == "beta" { Ok("https://github.com/rightway-p/BoardCanvas/releases/download/board-beta/board-release.json".to_string()) }
    else { Ok(PRODUCTION_LATEST.to_string()) }
  }
}

pub fn current_user_root() -> Result<PathBuf, String> {
  let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).ok_or("LOCALAPPDATA is unavailable.")?;
  reject_reparse_path(&local)?;
  Ok(local)
}

pub fn install_executable() -> Result<PathBuf, String> {
  let expected = installed_executable_path()?;
  let actual = std::env::current_exe().map_err(|error| format!("Could not locate the running executable: {error}"))?;
  let actual = fs::canonicalize(&actual).map_err(|error| format!("Could not resolve the running executable: {error}"))?;
  let expected = fs::canonicalize(&expected).map_err(|_| "This recovery feature only supports the fixed current-user BoardCanvas install.".to_string())?;
  if !actual.to_string_lossy().eq_ignore_ascii_case(&expected.to_string_lossy()) {
    return Err("This recovery feature only supports the fixed current-user BoardCanvas install.".into());
  }
  Ok(expected)
}

pub fn installed_executable_path() -> Result<PathBuf, String> {
  let expected = current_user_root()?.join(INSTALLER_RELATIVE_PATH);
  reject_reparse_path(expected.parent().ok_or("The expected install directory is invalid.")?)?;
  fs::canonicalize(&expected).map_err(|_| "The fixed current-user BoardCanvas executable is not installed.".to_string())
}

pub fn state_root() -> Result<PathBuf, String> {
  Ok(current_user_root()?.join("com.rightway.boardcanvas-recovery"))
}

const BETA_UPDATES_FILE: &str = "beta-updates.json";

pub fn beta_updates_enabled() -> Result<bool, String> {
  beta_updates_enabled_at(&state_root()?)
}

pub fn beta_updates_enabled_at(root: &Path) -> Result<bool, String> {
  reject_reparse_path(root)?;
  let path = root.join(BETA_UPDATES_FILE);
  reject_reparse_path(&path)?;
  if !path.exists() { return Ok(false); }
  let bytes = fs::read(path).map_err(|error| format!("Could not read beta update preference: {error}"))?;
  let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "The beta update preference is invalid.".to_string())?;
  value.get("enabled").and_then(serde_json::Value::as_bool).ok_or_else(|| "The beta update preference is invalid.".to_string())
}

pub fn set_beta_updates_enabled(enabled: bool) -> Result<(), String> {
  let root = state_root()?;
  fs::create_dir_all(&root).map_err(|error| format!("Could not save beta update preference: {error}"))?;
  reject_managed_path(&root)?;
  write_bytes_atomic(&root, BETA_UPDATES_FILE, format!("{{\"enabled\":{enabled}}}").as_bytes())
}

pub fn require_beta_opt_in(target: &InstallRecord, enabled: bool) -> Result<(), String> {
  if target.channel == "beta" && !enabled {
    Err("베타 업데이트가 꺼져 있어 설치를 중단했습니다. 설정에서 베타 업데이트를 다시 켜고 확인해 주세요.".into())
  } else { Ok(()) }
}

pub fn require_target_beta_opt_in(target: &InstallRecord) -> Result<(), String> {
  if target.channel == "beta" { require_beta_opt_in(target, beta_updates_enabled()?) } else { Ok(()) }
}

fn require_target_beta_opt_in_at(target: &InstallRecord, root: &Path) -> Result<(), String> {
  if target.channel == "beta" { require_beta_opt_in(target, beta_updates_enabled_at(root)?) } else { Ok(()) }
}

pub fn profile_path() -> Result<PathBuf, String> {
  Ok(current_user_root()?.join(PROFILE_RELATIVE_PATH))
}

pub fn read_journal(path: &Path) -> Result<Option<Journal>, String> {
  let journal_path = path.join("journal.json");
  if !journal_path.exists() { return Ok(None); }
  let bytes = fs::read(&journal_path).map_err(|error| format!("Could not read the recovery journal: {error}"))?;
  let journal: Journal = serde_json::from_slice(&bytes).map_err(|error| format!("The recovery journal is invalid: {error}"))?;
  validate_journal(&journal)?;
  Ok(Some(journal))
}

pub fn validate_journal(journal: &Journal) -> Result<(), String> {
  validate_record(&journal.current)?;
  if let Some(previous) = &journal.previous { validate_record(previous)?; }
  if let Some(target) = &journal.target { validate_record(target)?; }
  if journal.format_version != 1 || !matches!(journal.operation.as_str(), "update" | "promotion" | "rollback" | "recover") || !matches!(journal.state.as_str(), "prepared" | "authorized" | "closed" | "checkpointed" | "installing" | "needs-verification" | "confirmed" | "failed") || journal.operation_id.len() != 16 || !journal.operation_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
    return Err("The recovery journal state is unsupported.".into());
  }
  if let Some(target) = &journal.target {
    if journal.operation == "rollback" {
      if journal.previous.as_ref() != Some(target) { return Err("The rollback target is not the pinned confirmed previous installation.".into()); }
      validate_operation(&journal.current, target, &journal.operation)?;
    } else { validate_operation(&journal.current, target, &journal.operation)?; }
  }
  Ok(())
}

pub fn version_metadata_url(version: &str) -> Result<String, String> {
  let version = semver::Version::parse(version).map_err(|_| "Invalid signed release version.".to_string())?;
  #[cfg(feature = "recovery-test-feed")]
  {
    let directory = std::env::var_os("BOARD_RECOVERY_TEST_FEED").map(PathBuf::from).ok_or("The recovery test feed directory is not set.")?;
    if !directory.is_absolute() { return Err("The recovery test feed path must be absolute.".into()); }
    return file_url(&directory.join(format!("v{version}")).join(METADATA_NAME));
  }
  #[cfg(not(feature = "recovery-test-feed"))]
  { Ok(format!("https://github.com/rightway-p/BoardCanvas/releases/download/v{version}/{METADATA_NAME}")) }
}

pub fn production_feed_configured() -> bool {
  #[cfg(feature = "recovery-test-feed")]
  { return std::env::var_os("BOARD_RECOVERY_TEST_FEED").is_some_and(|path| Path::new(&path).is_absolute()); }
  #[cfg(not(feature = "recovery-test-feed"))]
  { true }
}

pub fn reject_managed_path(path: &Path) -> Result<(), String> { reject_reparse_path(path) }

pub fn copy_verified_helper(source: &Path, destination: &Path) -> Result<(), String> {
  reject_reparse_path(source)?;
  if let Some(parent) = destination.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; reject_reparse_path(parent)?; }
  let temp = destination.with_extension(format!("{:016x}.tmp", rand::random::<u64>()));
  copy_file_exclusive(source, &temp).map_err(|error| format!("Could not copy the recovery tool: {error}"))?;
  let source_hash = hash_file(source)?;
  if hash_file(&temp)? != source_hash { let _ = fs::remove_file(temp); return Err("The copied recovery tool failed its digest check.".into()); }
  fs::rename(temp, destination).map_err(|error| format!("Could not place the recovery tool: {error}"))
}

pub fn validate_profile_tree(path: &Path) -> Result<(), String> {
  if !path.exists() { return Err("The BoardCanvas user profile is missing; recovery verification is incomplete.".into()); }
  reject_reparse_path(path)?;
  let mut pending = vec![path.to_path_buf()];
  while let Some(directory) = pending.pop() {
    for entry in fs::read_dir(&directory).map_err(|error| format!("Could not inspect the BoardCanvas user profile: {error}"))? {
      let entry = entry.map_err(|error| error.to_string())?;
      let metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
      if metadata.file_type().is_symlink() { return Err("The BoardCanvas user profile contains a symbolic link.".into()); }
      reject_reparse_path(&entry.path())?;
      if metadata.is_dir() { pending.push(entry.path()); }
    }
  }
  Ok(())
}

pub fn verify_installer_file(manifest: &ReleaseManifest, path: &Path) -> Result<(), String> {
  if fs::metadata(path).map_err(|error| format!("Could not inspect staged installer: {error}"))?.len() != manifest.installer.size
    || hash_file(path)? != manifest.installer.sha256.to_ascii_lowercase() {
    return Err("Staged installer does not match signed metadata.".into());
  }
  verify_signed_bytes(&fs::read(path).map_err(|error| error.to_string())?, &manifest.installer.signature)
}

pub fn open_verified_installer(manifest: &ReleaseManifest, path: &Path) -> Result<File, String> {
  let mut file = open_installer_guard(path)?;
  let length = file.metadata().map_err(|error| format!("Could not inspect staged installer: {error}"))?.len();
  if length != manifest.installer.size || length > MAX_INSTALLER_BYTES {
    return Err("Staged installer does not match signed metadata.".into());
  }
  let mut bytes = Vec::with_capacity(length as usize);
  file.read_to_end(&mut bytes).map_err(|error| format!("Could not read staged installer: {error}"))?;
  verify_installer_bytes(manifest, &bytes)?;
  Ok(file)
}

fn open_installer_guard(path: &Path) -> Result<File, String> {
  #[cfg(windows)] {
    use std::os::windows::{ffi::OsStrExt, io::FromRawHandle};
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE, GENERIC_READ};
    use windows_sys::Win32::Storage::FileSystem::{CreateFileW, GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ, OPEN_EXISTING};
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let handle = unsafe { CreateFileW(wide.as_ptr(), GENERIC_READ, FILE_SHARE_READ, std::ptr::null(), OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, std::ptr::null_mut()) };
    if handle == INVALID_HANDLE_VALUE { return Err(format!("Could not hold staged installer against replacement: {}", io::Error::last_os_error())); }
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    if unsafe { GetFileInformationByHandle(handle, &mut info) } == 0 || info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
      unsafe { CloseHandle(handle); }
      return Err("Staged installer is invalid or redirected.".into());
    }
    Ok(unsafe { File::from_raw_handle(handle as _) })
  }
  #[cfg(not(windows))]
  { File::open(path).map_err(|error| format!("Could not open staged installer: {error}")) }
}

pub const MAX_INSTALLER_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_METADATA_BYTES: usize = 256 * 1024;
pub const MAX_SIGNATURE_BYTES: usize = 16 * 1024;

pub fn check_payload_size(length: u64, cap: u64) -> Result<(), String> {
  if length > cap { Err("Downloaded release data exceeds the permitted size.".into()) } else { Ok(()) }
}

pub async fn read_release_url(url: &str, limit: u64) -> Result<Vec<u8>, String> {
  check_payload_size(limit, MAX_INSTALLER_BYTES)?;
  let parsed = url::Url::parse(url).map_err(|error| format!("Invalid release URL: {error}"))?;
  if parsed.scheme() == "file" {
    #[cfg(feature = "recovery-test-feed")]
    {
      let path = parsed.to_file_path().map_err(|_| "Invalid local test-feed file URL.".to_string())?;
      if !test_feed_contains(&path) { return Err("Local test-feed file escapes its configured directory.".into()); }
      check_payload_size(fs::metadata(&path).map_err(|error| error.to_string())?.len(), limit)?;
      return fs::read(path).map_err(|error| format!("Could not read local signed fixture: {error}"));
    }
    #[cfg(not(feature = "recovery-test-feed"))]
    { return Err("Local release URLs are disabled in production builds.".into()); }
  }
  if parsed.scheme() != "https" { return Err("Release URLs must use HTTPS.".into()); }
  let client = reqwest::Client::builder().https_only(true).timeout(Duration::from_secs(30)).build().map_err(|error| error.to_string())?;
  let response = client.get(url).send().await.map_err(|error| format!("Could not download signed release data: {error}"))?
    .error_for_status().map_err(|error| format!("Release download failed: {error}"))?;
  if let Some(length) = response.content_length() { check_payload_size(length, limit)?; }
  use futures_util::StreamExt;
  let mut stream = response.bytes_stream();
  let mut output = Vec::new();
  while let Some(chunk) = stream.next().await {
    let chunk = chunk.map_err(|error| format!("Could not read release data: {error}"))?;
    let next = (output.len() as u64).checked_add(chunk.len() as u64).ok_or("Release size overflow.")?;
    check_payload_size(next, limit)?;
    output.extend_from_slice(&chunk);
  }
  Ok(output)
}

pub async fn fetch_signed_metadata(url: String) -> Result<(Vec<u8>, String), String> {
  let signature_url = format!("{url}.sig");
  let bytes = read_release_url(&url, MAX_METADATA_BYTES as u64).await?;
  let signature = read_release_url(&signature_url, MAX_SIGNATURE_BYTES as u64).await?;
  Ok((bytes, String::from_utf8(signature).map_err(|error| format!("Release signature is not UTF-8: {error}"))?))
}

pub struct OperationLock {
  path: PathBuf,
  #[cfg(windows)]
  handle: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
pub fn show_startup_blocked() {
  use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONWARNING, MB_OK, MB_SETFOREGROUND};
  let message: Vec<u16> = "BoardCanvas 업데이트 또는 복구가 진행 중입니다. 완료된 뒤 앱을 다시 실행해 주세요.".encode_utf16().chain(Some(0)).collect();
  let title: Vec<u16> = "BoardCanvas 복구".encode_utf16().chain(Some(0)).collect();
  unsafe { MessageBoxW(std::ptr::null_mut(), message.as_ptr(), title.as_ptr(), MB_OK | MB_ICONWARNING | MB_SETFOREGROUND); }
}

#[cfg(windows)]
pub fn confirm_interrupted_recovery() -> bool {
  use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, IDYES, MB_DEFBUTTON2, MB_ICONWARNING, MB_SETFOREGROUND, MB_YESNO};
  let message: Vec<u16> = "업데이트 검증이 완료되지 않았습니다. BoardCanvas를 닫고 서명된 기준 버전을 다시 설치할까요? 현재 프로필 데이터는 보존됩니다.".encode_utf16().chain(Some(0)).collect();
  let title: Vec<u16> = "BoardCanvas 복구".encode_utf16().chain(Some(0)).collect();
  unsafe { MessageBoxW(std::ptr::null_mut(), message.as_ptr(), title.as_ptr(), MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2 | MB_SETFOREGROUND) == IDYES }
}

#[cfg(not(windows))]
pub fn confirm_interrupted_recovery() -> bool { false }

#[cfg(windows)]
unsafe impl Send for OperationLock {}

impl OperationLock {
  #[cfg(windows)]
  pub fn for_app_startup() -> Result<Self, String> {
    Self::acquire(&state_root()?)
  }

  pub fn acquire(directory: &Path) -> Result<Self, String> {
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    reject_reparse_path(directory)?;
    let path = directory.join("operation.lock");
    #[cfg(windows)] {
      use std::os::windows::ffi::OsStrExt;
      use windows_sys::Win32::Storage::FileSystem::{CreateFileW, GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT, OPEN_ALWAYS};
      use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
      let path_wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
      let handle = unsafe { CreateFileW(path_wide.as_ptr(), 0x80000000 | 0x40000000, 0, std::ptr::null(), OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, std::ptr::null_mut()) };
      if handle == INVALID_HANDLE_VALUE { return Err(format!("Another recovery operation holds the exclusive lock: {}", io::Error::last_os_error())); }
      let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
      if unsafe { GetFileInformationByHandle(handle, &mut info) } == 0 || info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        unsafe { CloseHandle(handle); }
        return Err("The recovery operation lock is invalid or redirected.".into());
      }
      Ok(Self { path, handle })
    }
    #[cfg(not(windows))]
    {
      OpenOptions::new().write(true).create_new(true).open(&path).map_err(|error| format!("Another recovery operation holds the lock: {error}"))?;
      Ok(Self { path })
    }
  }
}

impl Drop for OperationLock {
  fn drop(&mut self) {
    #[cfg(windows)] unsafe { windows_sys::Win32::Foundation::CloseHandle(self.handle); }
    #[cfg(not(windows))] { let _ = fs::remove_file(&self.path); }
  }
}

#[cfg(feature = "recovery-test-feed")]
pub fn test_feed_contains_path(path: &Path) -> bool { test_feed_contains(path) }

#[cfg(feature = "recovery-test-feed")]
fn file_url(path: &Path) -> Result<String, String> {
  if !test_feed_contains(path) { return Err("Local test-feed path escapes its configured directory or is missing.".into()); }
  url::Url::from_file_path(path).map(|url| url.to_string()).map_err(|_| "Could not form test-feed file URL.".into())
}

#[cfg(feature = "recovery-test-feed")]
fn test_feed_contains(path: &Path) -> bool {
  let Some(root) = std::env::var_os("BOARD_RECOVERY_TEST_FEED").map(PathBuf::from) else { return false; };
  if !root.is_absolute() { return false; }
  let Ok(root) = fs::canonicalize(root) else { return false; };
  let Ok(path) = fs::canonicalize(path) else { return false; };
  path.starts_with(root)
}

pub fn write_journal_atomic(path: &Path, journal: &Journal) -> Result<(), String> {
  fs::create_dir_all(path).map_err(|error| format!("Could not create the recovery directory: {error}"))?;
  reject_reparse_path(path)?;
  let bytes = serde_json::to_vec(journal).map_err(|error| format!("Could not encode the recovery journal: {error}"))?;
  let temp = path.join(format!("journal.{:016x}.tmp", rand::random::<u64>()));
  let mut file = OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|error| format!("Could not create recovery journal: {error}"))?;
  file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|error| format!("Could not flush recovery journal: {error}"))?;
  drop(file);
  replace_file(&temp, &path.join("journal.json")).map_err(|error| format!("Could not commit recovery journal: {error}"))?;
  Ok(())
}

pub fn write_bytes_atomic(path: &Path, filename: &str, bytes: &[u8]) -> Result<(), String> {
  let temp = path.join(format!("{filename}.{:016x}.tmp", rand::random::<u64>()));
  let destination = path.join(filename);
  let mut file = OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|error| error.to_string())?;
  file.write_all(bytes).and_then(|_| file.sync_all()).map_err(|error| error.to_string())?;
  drop(file);
  replace_file(&temp, &destination).map_err(|error| error.to_string())
}

pub fn hash_file(path: &Path) -> Result<String, String> {
  let mut file = File::open(path).map_err(|error| format!("Could not open {}: {error}", path.display()))?;
  let mut hash = Sha256::new();
  let mut buffer = [0u8; 64 * 1024];
  loop {
    let count = file.read(&mut buffer).map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    if count == 0 { break; }
    hash.update(&buffer[..count]);
  }
  Ok(hex::encode(hash.finalize()))
}

pub fn validate_sha256(value: &str) -> Result<(), String> {
  if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) { return Err("The signed metadata contains an invalid SHA-256 digest.".into()); }
  Ok(())
}

pub fn ensure_free_space(path: &Path, required_bytes: u64) -> Result<(), String> {
  #[cfg(windows)] {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let path_wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut available = 0u64;
    if unsafe { GetDiskFreeSpaceExW(path_wide.as_ptr(), &mut available, std::ptr::null_mut(), std::ptr::null_mut()) } == 0 {
      return Err("Could not verify free disk space for recovery.".into());
    }
    let required = required_bytes.saturating_mul(2).saturating_add(32 * 1024 * 1024);
    if available < required { return Err("There is not enough free space to preserve the profile and complete recovery safely.".into()); }
  }
  #[cfg(not(windows))] { let _ = (path, required_bytes); }
  Ok(())
}

fn validate_record(record: &InstallRecord) -> Result<(), String> {
  if record.app_id != APP_ID || !matches!(record.channel.as_str(), "beta" | "stable") || record.platform != "windows" || record.arch != "x86_64" || record.install_kind != "nsis-current-user" || record.writes_schema != 1 || !record.reads_schemas.contains(&1) {
    return Err("The recovery journal contains an unsupported install record.".into());
  }
  let version = semver::Version::parse(&record.version).map_err(|_| "The recovery journal contains an invalid version.".to_string())?;
  if (record.channel == "stable" && !version.pre.is_empty()) || (record.channel == "beta" && !version.pre.as_str().starts_with("beta.")) {
    return Err("The recovery journal version does not match its release channel.".into());
  }
  validate_sha256(&record.installer_sha256)?;
  validate_sha256(&record.executable_sha256)
}

fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
  #[cfg(windows)] {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH};
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) };
    if result == 0 { Err(io::Error::last_os_error()) } else { Ok(()) }
  }
  #[cfg(not(windows))]
  { fs::rename(source, destination) }
}

pub fn copy_file_exclusive(source: &Path, destination: &Path) -> io::Result<()> {
  let mut input = None;
  for attempt in 0..40 {
    match open_file_exclusive_once(source) {
      Ok(file) => { input = Some(file); break; }
      Err(error) if is_file_sharing_error(&error) && attempt < 39 => std::thread::sleep(Duration::from_millis(250)),
      Err(error) => return Err(error),
    }
  }
  copy_opened_file(input.ok_or_else(|| io::Error::new(io::ErrorKind::Other, "could not lock source file"))?, destination)
}

pub fn open_file_exclusive_once(source: &Path) -> io::Result<File> {
  #[cfg(windows)] {
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::FromRawHandle;
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE, GENERIC_READ};
    use windows_sys::Win32::Storage::FileSystem::{CreateFileW, GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT, OPEN_EXISTING};
    let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let source_handle = unsafe { CreateFileW(source_wide.as_ptr(), GENERIC_READ, 0, std::ptr::null(), OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, std::ptr::null_mut()) };
    if source_handle == INVALID_HANDLE_VALUE { return Err(io::Error::last_os_error()); }
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    if unsafe { GetFileInformationByHandle(source_handle, &mut info) } == 0 || info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
      unsafe { CloseHandle(source_handle); }
      return Err(io::Error::new(io::ErrorKind::PermissionDenied, "refusing reparse-point source"));
    }
    Ok(unsafe { File::from_raw_handle(source_handle as _) })
  }
  #[cfg(not(windows))]
  { File::open(source) }
}

pub fn copy_opened_file(mut input: File, destination: &Path) -> io::Result<()> {
  #[cfg(windows)] {
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::FromRawHandle;
    use windows_sys::Win32::Foundation::{INVALID_HANDLE_VALUE, GENERIC_WRITE};
    use windows_sys::Win32::Storage::FileSystem::{CreateFileW, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, FILE_FLAG_OPEN_REPARSE_POINT};
    let destination_wide: Vec<u16> = destination.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination_handle = unsafe { CreateFileW(destination_wide.as_ptr(), GENERIC_WRITE, 0, std::ptr::null(), CREATE_NEW, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, std::ptr::null_mut()) };
    if destination_handle == INVALID_HANDLE_VALUE { return Err(io::Error::last_os_error()); }
    let mut output = unsafe { File::from_raw_handle(destination_handle as _) };
    io::copy(&mut input, &mut output)?;
    output.sync_all()
  }
  #[cfg(not(windows))]
  {
    let mut output = OpenOptions::new().write(true).create_new(true).open(destination)?;
    io::copy(&mut input, &mut output)?;
    output.sync_all()
  }
}

pub fn is_file_sharing_error(error: &io::Error) -> bool {
  #[cfg(windows)]
  { matches!(error.raw_os_error(), Some(32 | 33)) }
  #[cfg(not(windows))]
  { error.kind() == io::ErrorKind::WouldBlock }
}

fn reject_reparse_path(path: &Path) -> Result<(), String> {
  let mut current = PathBuf::new();
  for component in path.components() {
    current.push(component.as_os_str());
    if !current.exists() { continue; }
    let metadata = fs::symlink_metadata(&current).map_err(|error| format!("Could not inspect recovery path {}: {error}", current.display()))?;
    if metadata.file_type().is_symlink() { return Err(format!("Recovery path {} contains a symlink.", current.display())); }
    #[cfg(windows)] {
      use std::os::windows::fs::MetadataExt;
      if metadata.file_attributes() & 0x400 != 0 { return Err(format!("Recovery path {} contains a reparse point.", current.display())); }
    }
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn record(version: &str, channel: &str) -> InstallRecord {
    InstallRecord { app_id: APP_ID.into(), version: version.into(), channel: channel.into(), platform: "windows".into(), arch: "x86_64".into(), install_kind: "nsis-current-user".into(), installer_sha256: "a".repeat(64), executable_sha256: "b".repeat(64), writes_schema: 1, reads_schemas: vec![1] }
  }

  #[test]
  fn interrupted_rollback_recovery_preserves_previous_installer_for_retry() {
    let current = record("2.0.1-beta.2", "beta");
    let previous = record("2.0.1-beta.1", "beta");
    let target = current.clone();
    let mut journal = Journal {
      format_version: 1, state: "needs-verification".into(), operation: "recover".into(), operation_id: "0123456789abcdef".into(),
      current, previous: Some(previous), target: Some(target), profile_schema: 1, profile_checkpoint: None, current_profile_backup: None,
      staged_installer: Some("operations/rollback-A.exe".into()), baseline_installer: Some("operations/recover-B.exe".into()), message: None,
    };
    assert!(preserve_previous_installer_for_recovery(&mut journal));
    journal.operation = "recover".into();
    assert!(preserve_previous_installer_for_recovery(&mut journal), "a second interrupted recovery must retain installer A");
    assert_eq!(journal.staged_installer.as_deref(), Some("operations/rollback-A.exe"));
    assert_eq!(journal.baseline_installer.as_deref(), Some("operations/recover-B.exe"));
    assert!(retain_rollback_after_recovery(&mut journal));
    journal.current = journal.target.take().unwrap();
    assert_eq!(journal.previous.as_ref().unwrap().version, "2.0.1-beta.1");
    assert_eq!(journal.baseline_installer.as_deref(), Some("operations/rollback-A.exe"));
    assert_eq!(journal.staged_installer.as_deref(), Some("operations/recover-B.exe"));
  }

  #[test]
  fn normal_failed_update_recovery_does_not_invent_a_previous_install() {
    let current = record("2.0.1-beta.1", "beta");
    let mut journal = Journal {
      format_version: 1, state: "needs-verification".into(), operation: "update".into(), operation_id: "0123456789abcdef".into(),
      current: current.clone(), previous: None, target: Some(current), profile_schema: 1, profile_checkpoint: None, current_profile_backup: None,
      staged_installer: Some("operations/recover-A.exe".into()), baseline_installer: Some("operations/baseline-A.exe".into()), message: None,
    };
    assert!(!preserve_previous_installer_for_recovery(&mut journal));
    assert_eq!(journal.staged_installer.as_deref(), Some("operations/baseline-A.exe"));
    journal.operation = "recover".into();
    assert!(!preserve_previous_installer_for_recovery(&mut journal));
    assert_eq!(journal.staged_installer.as_deref(), Some("operations/baseline-A.exe"));
    assert!(!retain_rollback_after_recovery(&mut journal));
    assert!(journal.previous.is_none());
    assert!(journal.baseline_installer.is_none());
  }

  #[test]
  fn payload_size_limit_accepts_boundary_and_rejects_overflow() {
    assert!(check_payload_size(MAX_METADATA_BYTES as u64, MAX_METADATA_BYTES as u64).is_ok());
    assert!(check_payload_size(MAX_METADATA_BYTES as u64 + 1, MAX_METADATA_BYTES as u64).is_err());
  }

  #[test]
  fn exclusive_lock_releases_with_its_handle() {
    let directory = std::env::temp_dir().join(format!("board-recovery-lock-{:016x}", rand::random::<u64>()));
    fs::create_dir_all(&directory).unwrap();
    let first = OperationLock::acquire(&directory).unwrap();
    assert!(OperationLock::acquire(&directory).is_err());
    drop(first);
    assert!(OperationLock::acquire(&directory).is_ok());
    let _ = fs::remove_dir_all(directory);
  }

  #[test]
  fn operation_policy_allows_newer_cross_channel_updates_and_explicit_any_version_stable_return() {
    let beta_one = record("2.0.1-beta.1", "beta");
    let beta_two = record("2.0.1-beta.2", "beta");
    let stable = record("2.0.1", "stable");
    assert!(validate_operation(&beta_one, &beta_two, "update").is_ok());
    assert!(validate_operation(&beta_two, &beta_one, "update").is_err());
    assert!(validate_operation(&beta_two, &stable, "update").is_ok());
    assert!(validate_operation(&beta_two, &stable, "promotion").is_ok());
    assert!(validate_operation(&beta_two, &record("1.9.9", "stable"), "promotion").is_ok());
    assert!(validate_operation(&beta_one, &record("2.0.2", "stable"), "update").is_ok());
    assert!(validate_operation(&stable, &record("2.0.1-beta.1", "beta"), "update").is_err());
  }

  #[test]
  fn beta_preference_defaults_off_persists_and_blocks_beta_targets_when_disabled() {
    let directory = std::env::temp_dir().join(format!("board-beta-preference-{:016x}", rand::random::<u64>()));
    fs::create_dir_all(&directory).unwrap();
    assert!(!beta_updates_enabled_at(&directory).unwrap());
    let beta = record("2.0.1-beta.2", "beta");
    assert!(require_beta_opt_in(&beta, false).is_err());
    assert!(require_beta_opt_in(&beta, true).is_ok());
    assert!(require_beta_opt_in(&record("2.0.1", "stable"), false).is_ok());
    write_bytes_atomic(&directory, BETA_UPDATES_FILE, b"{\"enabled\":true}").unwrap();
    assert!(beta_updates_enabled_at(&directory).unwrap());
    write_bytes_atomic(&directory, BETA_UPDATES_FILE, b"not-json").unwrap();
    assert!(beta_updates_enabled_at(&directory).is_err());
    assert!(require_target_beta_opt_in_at(&record("2.0.1", "stable"), &directory).is_ok());
    assert!(require_target_beta_opt_in_at(&beta, &directory).is_err());
    let _ = fs::remove_dir_all(directory);
  }

  #[test]
  fn embedded_tauri_public_key_uses_the_outer_base64_encoding() {
    assert!(public_key().is_ok());
  }

  #[test]
  fn verifies_real_tauri_signed_manifest_and_installer_and_rejects_tampering() {
    let metadata = include_bytes!("../tests/fixtures/signed-board-release.json");
    let signature = include_str!("../tests/fixtures/signed-board-release.json.sig");
    let installer = include_bytes!("../tests/fixtures/signed-fixture.exe");
    let manifest = parse_manifest(metadata, signature).expect("Tauri-signed fixture should verify");
    verify_installer_bytes(&manifest, installer).expect("signed installer fixture should verify");
    let mut altered = metadata.to_vec();
    altered[0] ^= 1;
    assert!(verify_signed_bytes(&altered, signature).is_err());
    let mut altered_installer = installer.to_vec();
    altered_installer[0] ^= 1;
    assert!(verify_installer_bytes(&manifest, &altered_installer).is_err());
  }

  #[cfg(windows)]
  #[test]
  fn verified_installer_guard_blocks_write_until_install_finishes() {
    let metadata = include_bytes!("../tests/fixtures/signed-board-release.json");
    let signature = include_str!("../tests/fixtures/signed-board-release.json.sig");
    let installer = include_bytes!("../tests/fixtures/signed-fixture.exe");
    let manifest = parse_manifest(metadata, signature).unwrap();
    let path = std::env::temp_dir().join(format!("boardcanvas-installer-guard-{:016x}.exe", rand::random::<u64>()));
    fs::write(&path, installer).unwrap();
    let guard = open_verified_installer(&manifest, &path).unwrap();
    assert_eq!(fs::read(&path).unwrap(), installer, "the NSIS loader must still be able to read the guarded installer");
    assert!(OpenOptions::new().write(true).open(&path).is_err());
    let renamed = path.with_extension("moved");
    assert!(fs::rename(&path, &renamed).is_err());
    assert!(fs::remove_file(&path).is_err());
    drop(guard);
    assert!(OpenOptions::new().write(true).open(&path).is_ok());
    fs::remove_file(path).unwrap();
  }
}

pub fn validate_relative_path(path: &str) -> Result<(), String> {
  let path = Path::new(path);
  if path.as_os_str().is_empty() || path.components().any(|part| !matches!(part, Component::Normal(_))) {
    return Err("The recovery journal contains a path outside the managed directory.".into());
  }
  Ok(())
}
