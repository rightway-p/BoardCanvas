#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn runtime_log_path() -> PathBuf {
  let mut path = std::env::temp_dir();
  path.push("boardcanvas-runtime.log");
  path
}

#[tauri::command]
fn get_runtime_log_path() -> String {
  runtime_log_path().to_string_lossy().to_string()
}

#[tauri::command]
fn append_runtime_log(message: String) -> Result<(), String> {
  let path = runtime_log_path();
  let mut file = OpenOptions::new()
    .create(true)
    .append(true)
    .open(&path)
    .map_err(|error| format!("open log file failed: {error}"))?;

  let timestamp = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_secs())
    .unwrap_or(0);

  writeln!(file, "[{timestamp}] {message}")
    .map_err(|error| format!("write log failed: {error}"))?;

  Ok(())
}

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      get_runtime_log_path,
      append_runtime_log
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

