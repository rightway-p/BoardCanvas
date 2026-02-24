#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

#[derive(Serialize)]
struct CursorPosition {
  x: i32,
  y: i32,
}

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

#[tauri::command]
fn get_global_cursor_position() -> Result<CursorPosition, String> {
  #[cfg(target_os = "windows")]
  {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let mut point = POINT { x: 0, y: 0 };
    let success = unsafe { GetCursorPos(&mut point) };
    if success == 0 {
      return Err("GetCursorPos failed".to_string());
    }

    return Ok(CursorPosition {
      x: point.x,
      y: point.y,
    });
  }

  #[cfg(not(target_os = "windows"))]
  {
    Err("Global cursor query is only supported on Windows.".to_string())
  }
}

#[tauri::command]
fn get_window_cursor_position(window: tauri::Window) -> Result<CursorPosition, String> {
  #[cfg(target_os = "windows")]
  {
    use windows_sys::Win32::Foundation::{HWND, POINT};
    use windows_sys::Win32::Graphics::Gdi::ScreenToClient;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let hwnd = window
      .hwnd()
      .map_err(|error| format!("window handle unavailable: {error}"))?;
    let hwnd_sys: HWND = hwnd.0 as HWND;

    let mut point = POINT { x: 0, y: 0 };
    let success = unsafe { GetCursorPos(&mut point) };
    if success == 0 {
      return Err("GetCursorPos failed".to_string());
    }

    let converted = unsafe { ScreenToClient(hwnd_sys, &mut point) };
    if converted == 0 {
      return Err("ScreenToClient failed".to_string());
    }

    return Ok(CursorPosition {
      x: point.x,
      y: point.y,
    });
  }

  #[cfg(not(target_os = "windows"))]
  {
    let _ = window;
    Err("Window cursor query is only supported on Windows.".to_string())
  }
}

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      get_runtime_log_path,
      append_runtime_log,
      get_global_cursor_position,
      get_window_cursor_position
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

