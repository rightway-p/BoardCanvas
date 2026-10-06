use crate::recovery::{self, InstallRecord, Journal, ReleaseManifest};
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::AppHandle;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterStatus {
  channel: String,
  configured: bool,
  recovery_ready: bool,
  can_rollback: bool,
  previous_version: Option<String>,
  current_version: String,
  message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
  should_update: bool,
  manifest: Option<ManifestSummary>,
  blocked: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestSummary {
  version: String,
  installer_size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryStatus {
  channel: String,
  state: Option<String>,
  current_version: String,
  previous_version: Option<String>,
  target_version: Option<String>,
  can_rollback: bool,
  recovery_tool_available: bool,
  message: Option<String>,
}

#[tauri::command]
pub fn get_updater_status(app: AppHandle) -> UpdaterStatus {
  let state = recovery::state_root();
  let installed = recovery::install_executable().is_ok();
  let configured = recovery::public_key().is_ok() && recovery::production_feed_configured();
  let journal = state.as_ref().ok().and_then(|path| recovery::read_journal(path).ok().flatten());
  let previous_version = journal.as_ref().and_then(|journal| journal.previous.as_ref().map(|record| record.version.clone()));
  let recovery_ready = installed && state.as_ref().is_ok_and(|path| ensure_helper(&app, path).is_ok());
  let can_rollback = recovery_ready && journal.as_ref().is_some_and(|journal| journal.state == "confirmed" && journal.previous.is_some() && journal.baseline_installer.is_some());
  UpdaterStatus {
    channel: recovery::RELEASE_CHANNEL.into(),
    configured,
    recovery_ready,
    can_rollback,
    previous_version,
    current_version: journal.as_ref().map_or_else(|| app_version(&app), |journal| journal.current.version.clone()),
    message: if !configured { Some("Signed update releases are not configured on this build.".into()) }
      else if !installed { Some("Updates are available only for the fixed current-user installation.".into()) }
      else if !recovery_ready { Some("The external recovery tool or a verified recovery record is unavailable.".into()) }
      else { None },
  }
}

#[tauri::command]
pub async fn check_board_update(app: AppHandle) -> UpdateCheck {
  match check_latest(recovery::RELEASE_CHANNEL).await {
    Ok(manifest) => {
      let current = installed_version(&app);
      let newer = semver::Version::parse(&manifest.version).ok().zip(semver::Version::parse(&current).ok()).is_some_and(|(new, old)| new > old);
      let blocked = if recovery::install_executable().is_err() { Some("Updates are available only for the fixed current-user installation.".into()) }
        else if manifest.channel != recovery::RELEASE_CHANNEL { Some("Normal updates stay on the current release channel.".into()) }
        else if !newer { None }
        else if !has_compatible_baseline(&manifest, &current).await { Some("A verified installer for the current installation is unavailable; updating is blocked.".into()) }
        else { None };
      UpdateCheck { should_update: newer && blocked.is_none(), manifest: Some(ManifestSummary { version: manifest.version, installer_size: manifest.installer.size }), blocked }
    }
    Err(error) => UpdateCheck { should_update: false, manifest: None, blocked: Some(error) },
  }
}

#[tauri::command]
pub async fn prepare_board_update(app: AppHandle) -> Result<(), String> {
  let current_version = installed_version(&app);
  let target = check_latest(recovery::RELEASE_CHANNEL).await?;
  stage_update(target, &current_version, "update").await
}

#[tauri::command]
pub async fn check_stable_release(app: AppHandle) -> UpdateCheck {
  if recovery::RELEASE_CHANNEL != "beta" {
    return UpdateCheck { should_update: false, manifest: None, blocked: Some("Stable promotion is available only from the beta channel.".into()) };
  }
  match check_latest("stable").await {
    Ok(manifest) => {
      let current = installed_version(&app);
      let current_record = signed_version(&current).await.map(|value| InstallRecord::from_manifest(&value));
      let target_record = InstallRecord::from_manifest(&manifest);
      let allowed = current_record.as_ref().ok().and_then(|record| recovery::validate_operation(record, &target_record, "promotion").ok()).is_some();
      let blocked = if !allowed { Some("No compatible signed stable release is available for explicit promotion.".into()) }
        else if !has_compatible_baseline(&manifest, &current).await { Some("The verified beta baseline or data compatibility check failed.".into()) }
        else if recovery::install_executable().is_err() { Some("Promotion is available only for the fixed current-user installation.".into()) }
        else { None };
      UpdateCheck { should_update: blocked.is_none(), manifest: Some(ManifestSummary { version: manifest.version, installer_size: manifest.installer.size }), blocked }
    }
    Err(error) => UpdateCheck { should_update: false, manifest: None, blocked: Some(error) },
  }
}

#[tauri::command]
pub async fn prepare_board_promotion(app: AppHandle) -> Result<(), String> {
  if recovery::RELEASE_CHANNEL != "beta" { return Err("Stable promotion is available only from the beta channel.".into()); }
  let current_version = installed_version(&app);
  let target = check_latest("stable").await?;
  stage_update(target, &current_version, "promotion").await
}

async fn stage_update(target: ReleaseManifest, current_version: &str, operation: &str) -> Result<(), String> {
  let current_path = recovery::install_executable()?;
  let state = recovery::state_root()?;
  fs::create_dir_all(&state).map_err(|error| format!("Could not prepare the recovery area: {error}"))?;
  recovery::reject_managed_path(&state)?;
  let _lock = recovery::OperationLock::acquire(&state)?;
  if let Some(journal) = recovery::read_journal(&state)? {
    if matches!(journal.state.as_str(), "prepared" | "authorized" | "closed" | "checkpointed" | "installing" | "needs-verification" | "failed") {
      return Err("A previous update or recovery operation needs attention before another can start.".into());
    }
  }
  let baseline = signed_version(current_version).await?;
  recovery::validate_operation(&InstallRecord::from_manifest(&baseline), &InstallRecord::from_manifest(&target), operation)?;
  let current_hash = recovery::hash_file(&current_path)?;
  if baseline.executable.sha256.to_ascii_lowercase() != current_hash {
    return Err("The installed executable does not match the signed release record for its version. No baseline was created.".into());
  }
  if !target.data.reads_schemas.contains(&1) {
    return Err("The new release cannot read the current data schema; installation is blocked.".into());
  }
  let operation_id = format!("{:016x}", rand::random::<u64>());
  let artifacts = state.join("operations").join(&operation_id);
  fs::create_dir_all(&artifacts).map_err(|error| format!("Could not create update staging: {error}"))?;
  recovery::reject_managed_path(&artifacts)?;
  let base = InstallRecord::from_manifest(&baseline);
  let destination = artifacts.join("target-installer.exe");
  download_installer(&target, &destination).await?;
  let baseline_file = artifacts.join("baseline-installer.exe");
  if !baseline_file.exists() {
    download_installer(&baseline, &baseline_file).await?;
  } else {
    recovery::verify_installer_file(&baseline, &baseline_file)?;
  }
  persist_signed_metadata(&artifacts.join("target"), &target).await?;
  persist_signed_metadata(&artifacts.join("baseline"), &baseline).await?;
  if let Ok(previous_bytes) = fs::read(state.join("journal.json")) {
    recovery::write_bytes_atomic(&state, &format!("journal-backup-{operation_id}.json"), &previous_bytes)?;
  }
  let journal = Journal {
    format_version: 1,
    state: "prepared".into(),
    operation: operation.into(),
    operation_id: operation_id.clone(),
    current: base,
    previous: None,
    target: Some(InstallRecord::from_manifest(&target)),
    profile_schema: 1,
    profile_checkpoint: None,
    current_profile_backup: None,
    staged_installer: Some(format!("operations/{operation_id}/target-installer.exe")),
    baseline_installer: Some(format!("operations/{operation_id}/baseline-installer.exe")),
    message: None,
  };
  recovery::write_journal_atomic(&state, &journal)?;
  Ok(())
}

#[tauri::command]
pub fn launch_board_update(app: AppHandle) -> Result<(), String> {
  require_authorized_operation("update")?;
  launch_helper(&app, "--resume-update", true)
}

#[tauri::command]
pub fn launch_board_promotion(app: AppHandle) -> Result<(), String> {
  require_authorized_operation("promotion")?;
  launch_helper(&app, "--resume-promotion", true)
}

#[tauri::command]
pub fn authorize_prepared_operation(work_saved: bool, pdfs_saved: bool) -> Result<(), String> {
  if !work_saved || !pdfs_saved { return Err("The app has not confirmed successful work and PDF saves.".into()); }
  let state = recovery::state_root()?;
  let _lock = recovery::OperationLock::acquire(&state)?;
  let mut journal = recovery::read_journal(&state)?.ok_or("No prepared update or promotion was found.")?;
  if journal.state != "prepared" { return Err("The prepared operation is no longer waiting for save confirmation.".into()); }
  journal.state = "authorized".into();
  recovery::write_journal_atomic(&state, &journal)
}

#[tauri::command]
pub fn cancel_prepared_operation() -> Result<(), String> {
  let state = recovery::state_root()?;
  let _lock = recovery::OperationLock::acquire(&state)?;
  let journal = recovery::read_journal(&state)?.ok_or("No pending update or promotion was found.")?;
  if journal.state != "prepared" { return Err("Only an operation still waiting for save confirmation can be canceled.".into()); }
  let operation_id = journal.operation_id.clone();
  let backup_name = format!("journal-backup-{}.json", journal.operation_id);
  let backup = state.join(&backup_name);
  if backup.is_file() {
    let bytes = fs::read(&backup).map_err(|error| format!("Could not restore the earlier recovery record: {error}"))?;
    let prior: Journal = serde_json::from_slice(&bytes).map_err(|error| format!("The earlier recovery record is invalid: {error}"))?;
    recovery::validate_journal(&prior)?;
    recovery::write_journal_atomic(&state, &prior)?;
    fs::remove_file(&backup).map_err(|error| format!("Could not finish canceling the prepared operation: {error}"))?;
  } else {
    fs::remove_file(state.join("journal.json")).map_err(|error| format!("Could not clear the prepared recovery record: {error}"))?;
  }
  remove_aborted_operation(&state, &operation_id)?;
  Ok(())
}

fn remove_aborted_operation(state: &Path, operation_id: &str) -> Result<(), String> {
  if operation_id.len() != 16 || !operation_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
    return Err("The canceled operation identifier is invalid; its files were retained.".into());
  }
  let relative = format!("operations/{operation_id}");
  let directory = state.join(&relative);
  recovery::validate_relative_path(&relative)?;
  recovery::reject_managed_path(&directory)?;
  if !directory.exists() { return Ok(()); }
  if !directory.is_dir() { return Err("The canceled operation path is not a directory; its files were retained.".into()); }
  recovery::validate_profile_tree(&directory)?;
  fs::remove_dir_all(directory).map_err(|error| format!("The prior recovery record was restored, but canceled staged files could not be removed: {error}"))
}

#[tauri::command]
pub fn get_recovery_status(app: AppHandle) -> RecoveryStatus {
  let state = recovery::state_root();
  let journal = state.as_ref().ok().and_then(|path| recovery::read_journal(path).ok().flatten());
  let recovery_tool_available = state.as_ref().is_ok_and(|path| ensure_helper(&app, path).is_ok());
  let can_rollback = recovery_tool_available && journal.as_ref().is_some_and(|value| value.state == "confirmed" && value.previous.is_some() && value.baseline_installer.is_some());
  RecoveryStatus {
    channel: journal.as_ref().map_or_else(|| recovery::RELEASE_CHANNEL.to_string(), |value| value.current.channel.clone()),
    state: journal.as_ref().map(|value| value.state.clone()),
    current_version: journal.as_ref().map_or_else(|| app_version(&app), |value| value.current.version.clone()),
    previous_version: journal.as_ref().and_then(|value| value.previous.as_ref().map(|record| record.version.clone())),
    target_version: journal.as_ref().and_then(|value| value.target.as_ref().map(|record| record.version.clone())),
    can_rollback,
    recovery_tool_available,
    message: journal.and_then(|value| value.message),
  }
}

#[tauri::command]
pub fn rollback_board_update(app: AppHandle) -> Result<(), String> {
  let state = recovery::state_root()?;
  let journal = recovery::read_journal(&state)?.ok_or("No verified previous installation is available.")?;
  if journal.state != "confirmed" || journal.previous.is_none() || journal.baseline_installer.is_none() {
    return Err("The verified previous installation is not ready for rollback.".into());
  }
  launch_helper(&app, "--rollback", true)
}

fn require_authorized_operation(operation: &str) -> Result<(), String> {
  let state = recovery::state_root()?;
  let journal = recovery::read_journal(&state)?.ok_or("No prepared update or promotion was found.")?;
  if journal.state != "authorized" || journal.operation != operation { return Err("The operation has not been authorized after successful save confirmation.".into()); }
  Ok(())
}

#[tauri::command]
pub fn acknowledge_recovery(app: AppHandle, restore_succeeded: bool, pdf_restore_succeeded: bool) -> Result<(), String> {
  if !restore_succeeded || !pdf_restore_succeeded {
    return Err("The installed app did not confirm successful restoration of its work and PDF data.".into());
  }
  let state = recovery::state_root()?;
  let _lock = recovery::OperationLock::acquire(&state)?;
  let mut journal = recovery::read_journal(&state)?.ok_or("No pending recovery verification was found.")?;
  if journal.state != "needs-verification" { return Err("There is no installation waiting for verification.".into()); }
  let target = journal.target.clone().ok_or("The recovery journal has no signed target record.")?;
  let executable = recovery::install_executable()?;
  if recovery::hash_file(&executable)? != target.executable_sha256 {
    return Err("The installed executable does not match the signed target. Recovery remains pending.".into());
  }
  let profile = recovery::profile_path()?;
  recovery::validate_profile_tree(&profile)?;
  if app_version(&app) != target.version { return Err("The running app version does not match the signed target; recovery remains pending.".into()); }
  if matches!(journal.operation.as_str(), "update" | "promotion") {
    journal.previous = Some(journal.current.clone());
  } else if journal.operation == "recover" {
    let preserve_previous = journal.previous.as_ref().is_some_and(|previous| previous != &journal.current)
      && journal.staged_installer.is_some()
      && journal.baseline_installer.is_some();
    if preserve_previous {
      let state = recovery::state_root()?;
      let previous = journal.previous.as_ref().unwrap();
      let previous_manifest = find_local_manifest(&state, previous)?;
      let current_manifest = find_local_manifest(&state, &journal.current)?;
      let previous_installer = managed_path(&state, journal.staged_installer.as_deref().unwrap())?;
      let current_installer = managed_path(&state, journal.baseline_installer.as_deref().unwrap())?;
      recovery::verify_installer_file(&previous_manifest, &previous_installer)?;
      recovery::verify_installer_file(&current_manifest, &current_installer)?;
    }
    recovery::retain_rollback_after_recovery(&mut journal);
  } else {
    journal.previous = None;
    journal.baseline_installer = None;
  }
  journal.state = "confirmed".into();
  journal.current = target.clone();
  journal.target = None;
  journal.message = None;
  recovery::write_journal_atomic(&state, &journal)
}

fn managed_path(state: &Path, relative: &str) -> Result<PathBuf, String> {
  recovery::validate_relative_path(relative)?;
  let path = state.join(relative);
  recovery::reject_managed_path(&path)?;
  if !path.starts_with(state) { return Err("Recovery journal path escapes its managed directory.".into()); }
  Ok(path)
}

fn find_local_manifest(state: &Path, record: &InstallRecord) -> Result<ReleaseManifest, String> {
  for directory in std::iter::once(state.join("bootstrap")).chain(
    fs::read_dir(state.join("operations")).map_err(|error| error.to_string())?.filter_map(Result::ok).flat_map(|entry| {
      [entry.path().join("baseline"), entry.path().join("target")]
    })
  ) {
    recovery::reject_managed_path(&directory)?;
    let bytes = match fs::read(directory.join(recovery::METADATA_NAME)) { Ok(bytes) => bytes, Err(_) => continue };
    let signature = match fs::read_to_string(directory.join(recovery::METADATA_SIGNATURE_NAME)) { Ok(signature) => signature, Err(_) => continue };
    let manifest = match recovery::parse_manifest(&bytes, &signature) { Ok(manifest) => manifest, Err(_) => continue };
    if InstallRecord::from_manifest(&manifest) == *record { return Ok(manifest); }
  }
  Err("The signed metadata for a pinned recovery installer is missing or invalid.".into())
}

#[tauri::command]
pub fn open_recovery_tool(app: AppHandle) -> Result<(), String> {
  let state = recovery::state_root()?;
  if let Some(journal) = recovery::read_journal(&state)? {
    if matches!(journal.state.as_str(), "closed" | "checkpointed" | "installing" | "needs-verification" | "failed") {
      if !recovery::confirm_interrupted_recovery() { return Ok(()); }
      return launch_helper(&app, "--resume-recovery", true);
    }
  }
  launch_helper(&app, "--manual", false)
}

async fn check_latest(channel: &str) -> Result<ReleaseManifest, String> {
  let (metadata, signature) = fetch_signed_metadata(recovery::latest_metadata_url_for(channel)?).await?;
  recovery::parse_manifest(&metadata, &signature)
}

async fn signed_version(version: &str) -> Result<ReleaseManifest, String> {
  let (metadata, signature) = fetch_signed_metadata(recovery::version_metadata_url(version)?).await?;
  recovery::parse_manifest(&metadata, &signature)
}

async fn fetch_signed_metadata(url: String) -> Result<(Vec<u8>, String), String> {
  recovery::fetch_signed_metadata(url).await
}

async fn download_installer(manifest: &ReleaseManifest, destination: &Path) -> Result<(), String> {
  let bytes = recovery::read_release_url(&manifest.installer.url, manifest.installer.size).await?;
  recovery::verify_installer_bytes(manifest, &bytes)?;
  let temp = destination.with_extension(format!("{:016x}.tmp", rand::random::<u64>()));
  let mut file = OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|error| format!("Could not create staged installer: {error}"))?;
  file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|error| format!("Could not flush staged installer: {error}"))?;
  drop(file);
  fs::rename(&temp, destination).map_err(|error| format!("Could not commit staged installer: {error}"))?;
  Ok(())
}

async fn persist_signed_metadata(directory: &Path, manifest: &ReleaseManifest) -> Result<(), String> {
  fs::create_dir_all(directory).map_err(|error| format!("Could not create signed record directory: {error}"))?;
  let (bytes, signature) = fetch_signed_metadata(recovery::version_metadata_url(&manifest.version)?).await?;
  let verified = recovery::parse_manifest(&bytes, &signature)?;
  if verified.version != manifest.version { return Err("Signed metadata version changed during staging.".into()); }
  recovery::write_bytes_atomic(directory, recovery::METADATA_NAME, &bytes)?;
  recovery::write_bytes_atomic(directory, recovery::METADATA_SIGNATURE_NAME, signature.as_bytes())?;
  Ok(())
}

async fn has_compatible_baseline(target: &ReleaseManifest, current_version: &str) -> bool {
  let result = async {
    let baseline = signed_version(current_version).await?;
    if !target.data.reads_schemas.contains(&baseline.data.writes_schema) { return Err("The update cannot read the current schema.".into()); }
    let executable = recovery::install_executable()?;
    if recovery::hash_file(&executable)? != baseline.executable.sha256.to_ascii_lowercase() { return Err("Current executable is not signed baseline.".into()); }
    Ok::<(), String>(())
  }.await;
  result.is_ok()
}

fn installed_version(app: &AppHandle) -> String {
  recovery::state_root().ok().and_then(|state| recovery::read_journal(&state).ok().flatten()).map(|journal| journal.current.version).unwrap_or_else(|| app_version(app))
}

fn ensure_helper(app: &AppHandle, state: &Path) -> Result<PathBuf, String> {
  recovery::reject_managed_path(state)?;
  let resource = app.path_resolver().resolve_resource(recovery::HELPER_RESOURCE).ok_or("The recovery tool is missing from this installation.")?;
  let hash = recovery::hash_file(&resource)?;
  let destination = state.join(format!("boardcanvas-recovery-{hash}.exe"));
  if !destination.exists() { recovery::copy_verified_helper(&resource, &destination)?; }
  if recovery::hash_file(&destination)? != hash { return Err("The installed recovery tool does not match the bundled copy.".into()); }
  Ok(destination)
}

fn launch_helper(app: &AppHandle, argument: &str, close_app: bool) -> Result<(), String> {
  let state = recovery::state_root()?;
  fs::create_dir_all(&state).map_err(|error| format!("Could not prepare the recovery tool: {error}"))?;
  recovery::reject_managed_path(&state)?;
  let destination = ensure_helper(app, &state)?;
  let mut command = Command::new(destination);
  command.arg(argument);
  if close_app { command.arg("--parent-pid").arg(std::process::id().to_string()); }
  command.spawn().map_err(|error| format!("Could not start the external recovery tool: {error}"))?;
  if close_app { app.exit(0); }
  Ok(())
}

fn app_version(app: &AppHandle) -> String {
  app.config().package.version.as_deref().unwrap_or(env!("CARGO_PKG_VERSION")).to_string()
}

#[cfg(test)]
mod tests {
  use super::remove_aborted_operation;
  use crate::recovery::ReleaseManifest;

  #[test]
  fn release_public_key_is_tauri_encoded_and_decodable() {
    assert!(crate::recovery::public_key().is_ok());
  }

  #[test]
  fn metadata_rejects_wrong_identity_and_paths() {
    let manifest: ReleaseManifest = serde_json::from_str(r#"{"formatVersion":1,"appId":"other","version":"2.0.2-beta.1","channel":"beta","platform":"windows","arch":"x86_64","installKind":"nsis-current-user","installer":{"filename":"a.exe","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","size":1,"signature":"x","url":"https://github.com/rightway-p/BoardCanvas/releases/download/v2/a.exe"},"executable":{"relativePath":"boardcanvas.exe","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"data":{"writesSchema":1,"readsSchemas":[1]}}"#).unwrap();
    assert!(crate::recovery::validate_manifest(&manifest).is_err());
  }

  #[test]
  fn cancel_cleanup_removes_only_the_captured_operation_directory() {
    let state = std::env::temp_dir().join(format!("boardcanvas-cancel-test-{:016x}", rand::random::<u64>()));
    let selected = state.join("operations/0123456789abcdef");
    let other = state.join("operations/fedcba9876543210");
    std::fs::create_dir_all(&selected).unwrap();
    std::fs::create_dir_all(&other).unwrap();
    std::fs::write(selected.join("target-installer.exe"), b"staged").unwrap();
    std::fs::write(other.join("pinned-installer.exe"), b"pinned").unwrap();
    remove_aborted_operation(&state, "0123456789abcdef").unwrap();
    assert!(!selected.exists());
    assert!(other.join("pinned-installer.exe").exists());
    assert!(remove_aborted_operation(&state, "../fedcba9876543210").is_err());
    std::fs::remove_dir_all(state).unwrap();
  }
}
