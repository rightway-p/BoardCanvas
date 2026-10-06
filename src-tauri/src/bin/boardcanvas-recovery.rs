#[path = "../recovery.rs"]
mod recovery;

use recovery::{InstallRecord, Journal, ReleaseManifest};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
  if let Err(error) = run() { eprintln!("BoardCanvas recovery: {error}"); std::process::exit(1); }
}

fn run() -> Result<(), String> {
  let args: Vec<String> = std::env::args().skip(1).collect();
  if args.iter().any(|arg| arg == "--status") { return show_status(); }
  let parent = arg_value(&args, "--parent-pid").and_then(|value| value.parse::<u32>().ok());
  if args.is_empty() || args.iter().any(|arg| arg == "--manual") {
    if confirm_manual_action()? {
      if let Some(pid) = parent { wait_for_parent(pid)?; }
      let state = recovery::state_root()?;
      let journal = recovery::read_journal(&state)?.ok_or("No recovery record is available.")?;
      if journal.state == "confirmed" { return rollback(); }
      if journal.state == "authorized" { return apply_authorized(); }
      if matches!(journal.state.as_str(), "closed" | "checkpointed" | "installing" | "needs-verification" | "failed") { return recover_interrupted(); }
      return Err("A prepared update still needs app save confirmation; launch BoardCanvas to cancel or authorize it.".into());
    }
    return show_status();
  }
  if args.iter().any(|arg| arg == "--bootstrap") {
    let version = arg_value(&args, "--version").ok_or("--bootstrap requires a version.")?;
    return tokio::runtime::Builder::new_current_thread().enable_all().build().map_err(|e| e.to_string())?.block_on(bootstrap(version));
  }
  if let Some(pid) = parent { wait_for_parent(pid)?; }
  if args.iter().any(|arg| arg == "--rollback") { return rollback(); }
  if args.iter().any(|arg| arg == "--resume-recovery") { return recover_interrupted(); }
  if args.iter().any(|arg| arg == "--resume-update" || arg == "--resume-promotion") { return apply_authorized(); }
  Err("Run without arguments or use --manual for the user-confirmed recovery menu; --status only reads state.".into())
}

fn show_status() -> Result<(), String> {
  ensure_helper_location()?;
  let state = recovery::state_root()?;
  let Some(journal) = recovery::read_journal(&state)? else { println!("No recovery record is available."); return Ok(()); };
  println!("BoardCanvas recovery state: {}", journal.state);
  println!("Current: {} {}", journal.current.channel, journal.current.version);
  if let Some(previous) = journal.previous { println!("Previous: {} {}", previous.channel, previous.version); }
  if let Some(target) = journal.target { println!("Target: {} {}", target.channel, target.version); }
  if let Some(message) = journal.message { println!("Details: {message}"); }
  Ok(())
}

async fn bootstrap(version: String) -> Result<(), String> {
  ensure_helper_location()?;
  if any_app_process_running()? { return Err("Close BoardCanvas before creating a recovery checkpoint.".into()); }
  let manifest_url = recovery::version_metadata_url(&version)?;
  let (metadata_bytes, signature) = recovery::fetch_signed_metadata(manifest_url).await?;
  let manifest = recovery::parse_manifest(&metadata_bytes, &signature)?;
  if manifest.version != version { return Err("The signed baseline version differs from the requested version.".into()); }
  let install = recovery::installed_executable_path()?;
  if recovery::hash_file(&install)? != manifest.executable.sha256.to_ascii_lowercase() {
    return Err("The installed executable does not match the signed baseline. No recovery record was created.".into());
  }
  let state = recovery::state_root()?;
  fs::create_dir_all(&state).map_err(|e| e.to_string())?;
  let _lock = recovery::OperationLock::acquire(&state)?;
  let profiles = state.join("profiles");
  fs::create_dir_all(&profiles).map_err(|e| e.to_string())?;
  let operation_id = format!("{:016x}", rand::random::<u64>());
  let checkpoint = profiles.join(format!("profile-{version}-{operation_id}.snapshot"));
  checkpoint_profile(&checkpoint)?;
  let artifacts = state.join("bootstrap");
  fs::create_dir_all(&artifacts).map_err(|e| e.to_string())?;
  let installer_bytes = recovery::read_release_url(&manifest.installer.url, manifest.installer.size).await?;
  recovery::verify_installer_bytes(&manifest, &installer_bytes)?;
  let installer = artifacts.join("baseline-installer.exe");
  write_new_file(&installer, &installer_bytes)?;
  recovery::write_bytes_atomic(&artifacts, recovery::METADATA_NAME, &metadata_bytes)?;
  recovery::write_bytes_atomic(&artifacts, recovery::METADATA_SIGNATURE_NAME, signature.as_bytes())?;
  let record = InstallRecord::from_manifest(&manifest);
  recovery::write_journal_atomic(&state, &Journal {
    format_version: 1, state: "confirmed".into(), operation: "update".into(), operation_id,
    current: record, previous: None, target: None, profile_schema: 1,
    profile_checkpoint: Some(relative_to_state(&state, &checkpoint)?), current_profile_backup: None,
    staged_installer: None, baseline_installer: Some(relative_to_state(&state, &installer)?), message: None,
  })
}

fn apply_authorized() -> Result<(), String> {
  ensure_helper_location()?;
  let state = recovery::state_root()?;
  let _lock = recovery::OperationLock::acquire(&state)?;
  let mut journal = recovery::read_journal(&state)?.ok_or("No prepared operation exists.")?;
  if journal.state != "authorized" || !matches!(journal.operation.as_str(), "update" | "promotion") {
    return Err("The helper will install only an operation authorized after the app saved its work.".into());
  }
  let install = recovery::installed_executable_path()?;
  if recovery::hash_file(&install)? != journal.current.executable_sha256 {
    return fail_journal(&state, &mut journal, "The installed executable changed after staging.");
  }
  if any_app_process_running()? { return Err("Another BoardCanvas process is still using the profile.".into()); }
  let operation_dir = state.join("operations").join(&journal.operation_id);
  verify_record_manifest(&operation_dir.join("baseline"), &journal.current)?;
  let target_manifest = read_manifest(&operation_dir.join("target"))?;
  verify_record(&target_manifest, journal.target.as_ref().ok_or("The journal has no signed target.")?)?;
  recovery::validate_operation(&journal.current, journal.target.as_ref().unwrap(), &journal.operation)?;
  if journal.state != "authorized" { return Err("The operation is no longer authorized for installation.".into()); }
  let target_installer = managed_path(&state, journal.staged_installer.as_deref().ok_or("No staged installer is recorded.")?)?;
  let target_installer_guard = recovery::open_verified_installer(&target_manifest, &target_installer)?;
  let baseline_manifest = read_manifest(&operation_dir.join("baseline"))?;
  let baseline_installer = managed_path(&state, journal.baseline_installer.as_deref().ok_or("No baseline installer is recorded.")?)?;
  recovery::verify_installer_file(&baseline_manifest, &baseline_installer)?;
  journal.state = "closed".into();
  recovery::write_journal_atomic(&state, &journal)?;
  let current_version = journal.current.version.clone();
  checkpoint_profile_for(&state, &mut journal, &current_version)?;
  journal.state = "checkpointed".into();
  recovery::write_journal_atomic(&state, &journal)?;
  journal.state = "installing".into();
  recovery::write_journal_atomic(&state, &journal)?;
  install_nsis(&target_installer, &target_installer_guard)?;
  if recovery::hash_file(&recovery::installed_executable_path()?)? != journal.target.as_ref().unwrap().executable_sha256 {
    return fail_journal(&state, &mut journal, "Installer finished but the installed executable fingerprint did not match.");
  }
  journal.state = "needs-verification".into();
  recovery::write_journal_atomic(&state, &journal)?;
  drop(_lock);
  launch_installed_app()
}

fn rollback() -> Result<(), String> {
  ensure_helper_location()?;
  let state = recovery::state_root()?;
  let _lock = recovery::OperationLock::acquire(&state)?;
  let mut journal = recovery::read_journal(&state)?.ok_or("No confirmed recovery record exists.")?;
  if journal.state != "confirmed" { return Err("Rollback is available only after the current installation is confirmed.".into()); }
  let previous = journal.previous.clone().ok_or("There is no verified previous installation; first installs cannot roll back.")?;
  if any_app_process_running()? { return Err("Another BoardCanvas process is still using the profile.".into()); }
  let installed = recovery::installed_executable_path()?;
  if recovery::hash_file(&installed)? != journal.current.executable_sha256 { return Err("The current install does not match its confirmed fingerprint.".into()); }
  let manifest = find_signed_manifest(&state, &previous)?;
  if !previous.reads_schemas.contains(&journal.current.writes_schema) { return Err("The previous version cannot read the current profile schema; rollback is blocked and both copies are retained.".into()); }
  let installer = managed_path(&state, journal.baseline_installer.as_deref().ok_or("No pinned previous installer is recorded.")?)?;
  let installer_guard = recovery::open_verified_installer(&manifest, &installer)?;
  let prior_snapshot = managed_path(&state, journal.profile_checkpoint.as_deref().ok_or("The previous profile checkpoint is missing.")?)?;
  recovery::validate_profile_tree(&prior_snapshot)?;
  let rollback_id = format!("{:016x}", rand::random::<u64>());
  let current_backup = state.join("profiles").join(format!("profile-before-rollback-{rollback_id}.snapshot"));
  copy_tree(&recovery::profile_path()?, &current_backup)?;
  journal.current_profile_backup = Some(relative_to_state(&state, &current_backup)?);
  let rollback_installer_relative = journal.baseline_installer.clone().ok_or("No pinned previous installer is recorded.")?;
  let current_installer_relative = journal.staged_installer.clone().ok_or("The current signed installer is not retained.")?;
  journal.target = Some(previous.clone());
  journal.operation = "rollback".into();
  journal.state = "installing".into();
  journal.operation_id = rollback_id;
  journal.staged_installer = Some(rollback_installer_relative);
  journal.baseline_installer = Some(current_installer_relative);
  recovery::write_journal_atomic(&state, &journal)?;
  install_nsis(&installer, &installer_guard)?;
  if recovery::hash_file(&recovery::installed_executable_path()?)? != previous.executable_sha256 {
    return fail_journal(&state, &mut journal, "Rollback installer finished but the previous executable fingerprint did not match.");
  }
  journal.state = "needs-verification".into();
  recovery::write_journal_atomic(&state, &journal)?;
  drop(_lock);
  launch_installed_app()
}

fn recover_interrupted() -> Result<(), String> {
  ensure_helper_location()?;
  let state = recovery::state_root()?;
  let _lock = recovery::OperationLock::acquire(&state)?;
  let mut journal = recovery::read_journal(&state)?.ok_or("No interrupted recovery record exists.")?;
  if !matches!(journal.state.as_str(), "closed" | "checkpointed" | "installing" | "needs-verification" | "failed") {
    return Err("There is no interrupted installation that can be recovered.".into());
  }
  if any_app_process_running()? { return Err("Another BoardCanvas process is still using the profile.".into()); }
  let preserve_previous_installer = recovery::preserve_previous_installer_for_recovery(&mut journal);
  let manifest = find_signed_manifest(&state, &journal.current)?;
  let install = managed_path(&state, journal.baseline_installer.as_deref().ok_or("The signed baseline installer is missing.")?)?;
  let installer_guard = recovery::open_verified_installer(&manifest, &install)?;
  if preserve_previous_installer {
    let previous = journal.previous.as_ref().unwrap();
    let previous_manifest = find_signed_manifest(&state, previous)?;
    verify_record(&previous_manifest, previous)?;
    let previous_installer = managed_path(&state, journal.staged_installer.as_deref().unwrap())?;
    recovery::verify_installer_file(&previous_manifest, &previous_installer)?;
  }
  if let Some(target) = &journal.target {
    let target_manifest = find_signed_manifest(&state, target)?;
    if !manifest.data.reads_schemas.contains(&target_manifest.data.writes_schema) {
      return Err("The pinned baseline cannot read the interrupted version's data schema; profile and installer copies are retained.".into());
    }
  }
  let profile = recovery::profile_path()?;
  recovery::validate_profile_tree(&profile)?;
  let profile_backup = state.join("profiles").join(format!("interrupted-current-{:016x}.snapshot", rand::random::<u64>()));
  copy_tree(&profile, &profile_backup)?;
  journal.current_profile_backup = Some(relative_to_state(&state, &profile_backup)?);
  journal.target = Some(journal.current.clone());
  journal.operation = "recover".into();
  journal.state = "installing".into();
  journal.operation_id = format!("{:016x}", rand::random::<u64>());
  recovery::write_journal_atomic(&state, &journal)?;
  install_nsis(&install, &installer_guard)?;
  if recovery::hash_file(&recovery::installed_executable_path()?)? != journal.current.executable_sha256 {
    return fail_journal(&state, &mut journal, "Recovery installer finished but the pinned baseline executable fingerprint did not match.");
  }
  journal.state = "needs-verification".into();
  recovery::write_journal_atomic(&state, &journal)?;
  drop(_lock);
  launch_installed_app()
}

fn read_manifest(directory: &Path) -> Result<ReleaseManifest, String> {
  recovery::reject_managed_path(directory)?;
  let bytes = fs::read(directory.join(recovery::METADATA_NAME)).map_err(|e| format!("Could not read signed recovery metadata: {e}"))?;
  let signature = fs::read_to_string(directory.join(recovery::METADATA_SIGNATURE_NAME)).map_err(|e| format!("Could not read recovery signature: {e}"))?;
  recovery::parse_manifest(&bytes, &signature)
}

fn verify_record_manifest(directory: &Path, record: &InstallRecord) -> Result<ReleaseManifest, String> {
  let manifest = read_manifest(directory)?;
  verify_record(&manifest, record)?;
  Ok(manifest)
}

fn verify_record(manifest: &ReleaseManifest, record: &InstallRecord) -> Result<(), String> {
  if &InstallRecord::from_manifest(manifest) != record { return Err("Signed metadata does not match the journal install record.".into()); }
  Ok(())
}

fn find_signed_manifest(state: &Path, record: &InstallRecord) -> Result<ReleaseManifest, String> {
  if let Ok(manifest) = verify_record_manifest(&state.join("bootstrap"), record) { return Ok(manifest); }
  let operations = state.join("operations");
  for entry in fs::read_dir(operations).map_err(|e| e.to_string())? {
    let path = entry.map_err(|e| e.to_string())?.path();
    for kind in ["baseline", "target"] {
      if let Ok(manifest) = verify_record_manifest(&path.join(kind), record) { return Ok(manifest); }
    }
  }
  Err("The pinned previous release metadata is missing or invalid.".into())
}

fn managed_path(state: &Path, relative: &str) -> Result<PathBuf, String> {
  recovery::validate_relative_path(relative)?;
  let path = state.join(relative);
  recovery::reject_managed_path(&path)?;
  if !path.starts_with(state) { return Err("Recovery journal path escapes its managed directory.".into()); }
  Ok(path)
}

fn relative_to_state(state: &Path, path: &Path) -> Result<String, String> {
  path.strip_prefix(state).map_err(|_| "Recovery artifact is outside its managed directory.".to_string())?
    .to_str().map(str::to_string).ok_or("Recovery artifact path is invalid.".into())
}

fn checkpoint_profile_for(state: &Path, journal: &mut Journal, version: &str) -> Result<(), String> {
  let path = state.join("profiles").join(format!("profile-{version}-{}.snapshot", journal.operation_id));
  copy_tree(&recovery::profile_path()?, &path)?;
  journal.profile_checkpoint = Some(relative_to_state(state, &path)?);
  Ok(())
}

fn checkpoint_profile(path: &Path) -> Result<(), String> { copy_tree(&recovery::profile_path()?, path) }

fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
  recovery::validate_profile_tree(source)?;
  if destination.exists() { return Err("A recovery checkpoint already exists; refusing to replace it.".into()); }
  for attempt in 0..40 {
    let (directories, files, size) = scan_profile(source)?;
    if size > recovery::MAX_INSTALLER_BYTES * 16 { return Err("The profile is too large to checkpoint safely.".into()); }
    let mut handles = Vec::with_capacity(files.len());
    let mut retry = false;
    for relative in &files {
      let path = source.join(relative);
      match recovery::open_file_exclusive_once(&path) {
        Ok(file) => handles.push((relative.clone(), file)),
        Err(error) if recovery::is_file_sharing_error(&error) && attempt < 39 => { retry = true; break; }
        Err(error) => return Err(format!("Could not exclusively lock profile file {}: {error}", path.display())),
      }
    }
    if retry { drop(handles); std::thread::sleep(std::time::Duration::from_millis(250)); continue; }
    let (after_dirs, after_files, after_size) = scan_profile(source)?;
    if directories != after_dirs || files != after_files || size != after_size {
      drop(handles);
      if attempt == 39 { return Err("The profile changed while it was being checkpointed; no snapshot was written.".into()); }
      std::thread::sleep(std::time::Duration::from_millis(250));
      continue;
    }
    let parent = destination.parent().ok_or("Recovery checkpoint has no parent directory.")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    recovery::ensure_free_space(parent, size)?;
    fs::create_dir(destination).map_err(|e| e.to_string())?;
    let result = (|| {
      for relative in &directories { fs::create_dir(destination.join(relative)).map_err(|e| e.to_string())?; }
      for (relative, file) in handles {
        recovery::copy_opened_file(file, &destination.join(relative)).map_err(|e| format!("Could not write profile checkpoint: {e}"))?;
      }
      Ok(())
    })();
    if result.is_err() { let _ = fs::remove_dir_all(destination); }
    return result;
  }
  Err("Could not acquire exclusive profile handles before the checkpoint deadline.".into())
}

fn scan_profile(source: &Path) -> Result<(Vec<PathBuf>, Vec<PathBuf>, u64), String> {
  let mut directories = Vec::new();
  let mut files = Vec::new();
  let mut stack = vec![PathBuf::new()];
  let mut size = 0u64;
  while let Some(relative_dir) = stack.pop() {
    let path = source.join(&relative_dir);
    for entry in fs::read_dir(&path).map_err(|e| e.to_string())? {
      let entry = entry.map_err(|e| e.to_string())?;
      let from = entry.path();
      let metadata = fs::symlink_metadata(&from).map_err(|e| e.to_string())?;
      if metadata.file_type().is_symlink() { return Err("User profile contains a redirected path.".into()); }
      recovery::reject_managed_path(&from)?;
      let relative = relative_dir.join(entry.file_name());
      if metadata.is_dir() { directories.push(relative.clone()); stack.push(relative); }
      else if metadata.is_file() { size = size.checked_add(metadata.len()).ok_or("Profile size overflow.")?; files.push(relative); }
    }
  }
  directories.sort(); files.sort();
  Ok((directories, files, size))
}

fn write_new_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
  let mut file = fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(|e| e.to_string())?;
  use std::io::Write;
  file.write_all(bytes).and_then(|_| file.sync_all()).map_err(|e| e.to_string())
}

fn install_nsis(installer: &Path, _guard: &fs::File) -> Result<(), String> {
  let status = Command::new(installer).arg("/S").status().map_err(|e| format!("Could not start the NSIS installer: {e}"))?;
  if !status.success() { return Err(format!("NSIS installer exited with {}.", status.code().unwrap_or(-1))); }
  Ok(())
}

fn launch_installed_app() -> Result<(), String> {
  Command::new(recovery::installed_executable_path()?).spawn().map_err(|e| format!("Could not start BoardCanvas for verification: {e}"))?;
  Ok(())
}

fn fail_journal<T>(state: &Path, journal: &mut Journal, message: &str) -> Result<T, String> {
  journal.state = "failed".into();
  journal.message = Some(message.into());
  let _ = recovery::write_journal_atomic(state, journal);
  Err(message.into())
}

fn arg_value(args: &[String], name: &str) -> Option<String> { args.iter().position(|value| value == name).and_then(|i| args.get(i + 1)).cloned() }

fn wait_for_parent(pid: u32) -> Result<(), String> {
  #[cfg(windows)] {
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject, INFINITE};
    use windows_sys::Win32::Storage::FileSystem::SYNCHRONIZE;
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    let handle = unsafe { OpenProcess(SYNCHRONIZE, 0, pid) };
    if handle.is_null() {
      return if any_app_process_running()? { Err("Could not verify that BoardCanvas has closed.".into()) } else { Ok(()) };
    }
    let result = unsafe { WaitForSingleObject(handle, INFINITE) };
    unsafe { CloseHandle(handle); }
    if result != WAIT_OBJECT_0 { return Err("Could not confirm BoardCanvas has closed.".into()); }
    Ok(())
  }
  #[cfg(not(windows))] { let _ = pid; Err("Windows recovery is available only on Windows.".into()) }
}

fn any_app_process_running() -> Result<bool, String> {
  #[cfg(windows)] {
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION};
    let expected = recovery::current_user_root()?.join(recovery::INSTALLER_RELATIVE_PATH);
    recovery::reject_managed_path(expected.parent().ok_or("The expected install directory is invalid.")?)?;
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE { return Err("Could not inspect running process locks.".into()); }
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() }; entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut found = false;
    let mut result = unsafe { Process32FirstW(snapshot, &mut entry) };
    while result != 0 {
      let name = String::from_utf16_lossy(&entry.szExeFile);
      if name.trim_matches('\0').eq_ignore_ascii_case("boardcanvas.exe") {
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, entry.th32ProcessID) };
        if process.is_null() { unsafe { CloseHandle(snapshot); } return Err("Could not verify a running BoardCanvas process path safely.".into()); }
        let mut path_buffer = vec![0u16; 32768];
        let mut path_length = path_buffer.len() as u32;
        let queried = unsafe { QueryFullProcessImageNameW(process, 0, path_buffer.as_mut_ptr(), &mut path_length) };
        unsafe { CloseHandle(process); }
        if queried == 0 { unsafe { CloseHandle(snapshot); } return Err("Could not verify a running BoardCanvas process path safely.".into()); }
        let running = String::from_utf16_lossy(&path_buffer[..path_length as usize]);
        if same_windows_path(&running, &expected.to_string_lossy()) { found = true; break; }
      }
      result = unsafe { Process32NextW(snapshot, &mut entry) };
    }
    unsafe { CloseHandle(snapshot); }
    Ok(found)
  }
  #[cfg(not(windows))] { Ok(false) }
}

#[cfg(windows)]
fn same_windows_path(left: &str, right: &str) -> bool {
  let normalize = |path: &str| {
    let path = path.replace('/', "\\");
    path.strip_prefix("\\\\?\\").unwrap_or(&path).to_ascii_lowercase()
  };
  normalize(left) == normalize(right)
}

fn ensure_helper_location() -> Result<(), String> {
  let self_path = std::env::current_exe().map_err(|e| e.to_string())?;
  let state = recovery::state_root()?;
  recovery::reject_managed_path(&state)?;
  let name = self_path.file_name().and_then(|s| s.to_str()).unwrap_or_default();
  if !name.starts_with("boardcanvas-recovery-") || !name.ends_with(".exe") || self_path.parent() != Some(state.as_path()) {
    return Err("The recovery tool is not running from its stable per-user location.".into());
  }
  Ok(())
}

fn confirm_manual_action() -> Result<bool, String> {
  let state = recovery::state_root()?;
  let journal = recovery::read_journal(&state)?.ok_or("No recovery record is available.")?;
  let action = if journal.state == "confirmed" && journal.previous.is_some() { "고정된 이전 서명 설치본으로 되돌릴까요? 현재 프로필 데이터는 그대로 보존됩니다." }
    else if journal.state == "authorized" { "작업 저장 확인 후 승인된 업데이트를 계속 진행할까요?" }
    else if matches!(journal.state.as_str(), "closed" | "checkpointed" | "installing" | "needs-verification" | "failed") { "고정된 서명 기준본으로 복구할까요? 현재 프로필 데이터는 그대로 보존됩니다." }
    else { println!("No recovery action is ready. Current state: {}.", journal.state); return Ok(false); };
  #[cfg(windows)] {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONQUESTION, MB_YESNO, MB_DEFBUTTON2, MB_SETFOREGROUND, IDYES};
    let message: Vec<u16> = std::ffi::OsStr::new(action).encode_wide().chain(Some(0)).collect();
    let title: Vec<u16> = std::ffi::OsStr::new("BoardCanvas 복구").encode_wide().chain(Some(0)).collect();
    Ok(unsafe { MessageBoxW(std::ptr::null_mut(), message.as_ptr(), title.as_ptr(), MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2 | MB_SETFOREGROUND) } == IDYES)
  }
  #[cfg(not(windows))] { let _ = action; Ok(false) }
}

#[cfg(all(test, windows))]
mod tests {
  use super::copy_tree;
  use std::fs;
  use std::os::windows::fs::OpenOptionsExt;

  #[test]
  fn locked_last_profile_file_leaves_no_partial_checkpoint_and_retry_succeeds() {
    let root = std::env::temp_dir().join(format!("boardcanvas-profile-lock-test-{:016x}", rand::random::<u64>()));
    let source = root.join("profile");
    let destination = root.join("snapshot");
    fs::create_dir_all(&source).unwrap();
    fs::write(source.join("first.dat"), b"first").unwrap();
    fs::write(source.join("last.dat"), b"last").unwrap();
    let lock = fs::OpenOptions::new().read(true).share_mode(0).open(source.join("last.dat")).unwrap();

    let error = copy_tree(&source, &destination).unwrap_err();
    assert!(error.contains("exclusive") || error.contains("deadline"));
    assert!(!destination.exists(), "no destination should exist until every source file is locked");

    drop(lock);
    copy_tree(&source, &destination).unwrap();
    assert_eq!(fs::read(destination.join("first.dat")).unwrap(), b"first");
    assert_eq!(fs::read(destination.join("last.dat")).unwrap(), b"last");
    fs::remove_dir_all(root).unwrap();
  }
}
