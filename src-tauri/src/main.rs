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

#[derive(Serialize)]
struct WindowCursorPosition {
  x: i32,
  y: i32,
  scale_factor: f64,
}

#[derive(Serialize)]
struct WindowStyleInfo {
  ex_style: usize,
  has_layered: bool,
  has_transparent: bool,
  has_toolwindow: bool,
  has_topmost: bool,
}

#[derive(Serialize)]
struct WindowRectInfo {
  left: i32,
  top: i32,
  right: i32,
  bottom: i32,
  width: i32,
  height: i32,
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
fn get_window_cursor_position(window: tauri::Window) -> Result<WindowCursorPosition, String> {
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

    let scale_factor = window
      .scale_factor()
      .ok()
      .filter(|value| value.is_finite() && *value > 0.0)
      .unwrap_or(1.0);

    return Ok(WindowCursorPosition {
      x: point.x,
      y: point.y,
      scale_factor,
    });
  }

  #[cfg(not(target_os = "windows"))]
  {
    let _ = window;
    Err("Window cursor query is only supported on Windows.".to_string())
  }
}

#[tauri::command]
fn set_webview_background_alpha(window: tauri::Window, alpha: u8) -> Result<u8, String> {
  #[cfg(target_os = "windows")]
  {
    use std::sync::{Arc, Mutex};

    use webview2_com::Microsoft::Web::WebView2::Win32::{
      COREWEBVIEW2_COLOR, ICoreWebView2Controller2,
    };
    use windows::core::Interface;

    let command_result: Arc<Mutex<Result<u8, String>>> = Arc::new(Mutex::new(Ok(255)));
    let command_result_ref = Arc::clone(&command_result);

    window
      .with_webview(move |webview| {
        let update_result = (|| -> Result<u8, String> {
          let controller = webview.controller();
          let controller2: ICoreWebView2Controller2 = controller
            .cast()
            .map_err(|error| format!("controller cast failed: {error}"))?;

          unsafe {
            controller2
              .SetDefaultBackgroundColor(COREWEBVIEW2_COLOR {
                R: 0,
                G: 0,
                B: 0,
                A: alpha,
              })
              .map_err(|error| format!("SetDefaultBackgroundColor failed: {error}"))?;
          }

          let mut applied = COREWEBVIEW2_COLOR {
            R: 0,
            G: 0,
            B: 0,
            A: 0,
          };
          unsafe {
            controller2
              .DefaultBackgroundColor(&mut applied)
              .map_err(|error| format!("DefaultBackgroundColor read failed: {error}"))?;
          }

          Ok(applied.A)
        })();

        if let Ok(mut guard) = command_result_ref.lock() {
          *guard = update_result;
        }
      })
      .map_err(|error| format!("with_webview failed: {error}"))?;

    return command_result
      .lock()
      .map_err(|_| "webview background command lock poisoned".to_string())?
      .clone();
  }

  #[cfg(not(target_os = "windows"))]
  {
    let _ = (window, alpha);
    Err("Webview background alpha command is only supported on Windows.".to_string())
  }
}

#[tauri::command]
fn set_window_overlay_surface(window: tauri::Window, enabled: bool) -> Result<bool, String> {
  #[cfg(target_os = "windows")]
  {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::Graphics::Dwm::DwmExtendFrameIntoClientArea;
    use windows_sys::Win32::UI::Controls::MARGINS;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
      GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, WS_EX_LAYERED,
      SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
    };

    let hwnd = window
      .hwnd()
      .map_err(|error| format!("window handle unavailable: {error}"))?;
    let hwnd_sys: HWND = hwnd.0 as HWND;

    // 1. DWM margins 설정 (먼저)
    let margins = if enabled {
      MARGINS {
        cxLeftWidth: -1,
        cxRightWidth: -1,
        cyTopHeight: -1,
        cyBottomHeight: -1,
      }
    } else {
      MARGINS {
        cxLeftWidth: 0,
        cxRightWidth: 0,
        cyTopHeight: 0,
        cyBottomHeight: 0,
      }
    };
    let frame_result = unsafe { DwmExtendFrameIntoClientArea(hwnd_sys, &margins) };
    if frame_result != 0 {
      return Err(format!("DwmExtendFrameIntoClientArea failed: {frame_result}"));
    }

    // 2. WS_EX_LAYERED 설정/제거
    let ex_style = unsafe { GetWindowLongPtrW(hwnd_sys, GWL_EXSTYLE) } as usize;
    let next_style = if enabled {
      ex_style | (WS_EX_LAYERED as usize)
    } else {
      ex_style & !(WS_EX_LAYERED as usize) // 수정: enabled=false 시 LAYERED 비트 제거
    };
    let _ = unsafe { SetWindowLongPtrW(hwnd_sys, GWL_EXSTYLE, next_style as isize) };

    // 3. 창 갱신 강제 (스타일 변경을 DWM에 알림)
    unsafe {
      SetWindowPos(
        hwnd_sys,
        std::ptr::null_mut(), // HWND_TOP
        0,
        0,
        0,
        0,
        SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
      );
    }

    return Ok(true);
  }

  #[cfg(not(target_os = "windows"))]
  {
    let _ = (window, enabled);
    Err("Window overlay surface command is only supported on Windows.".to_string())
  }
}

#[tauri::command]
fn verify_window_styles(window: tauri::Window) -> Result<WindowStyleInfo, String> {
  #[cfg(target_os = "windows")]
  {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
      GetWindowLongPtrW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
      WS_EX_TRANSPARENT,
    };

    let hwnd = window
      .hwnd()
      .map_err(|error| format!("window handle unavailable: {error}"))?;
    let hwnd_sys: HWND = hwnd.0 as HWND;

    let ex_style = unsafe { GetWindowLongPtrW(hwnd_sys, GWL_EXSTYLE) } as usize;

    Ok(WindowStyleInfo {
      ex_style,
      has_layered: (ex_style & (WS_EX_LAYERED as usize)) != 0,
      has_transparent: (ex_style & (WS_EX_TRANSPARENT as usize)) != 0,
      has_toolwindow: (ex_style & (WS_EX_TOOLWINDOW as usize)) != 0,
      has_topmost: (ex_style & (WS_EX_TOPMOST as usize)) != 0,
    })
  }

  #[cfg(not(target_os = "windows"))]
  {
    let _ = window;
    Err("Window style verification is only supported on Windows.".to_string())
  }
}

#[tauri::command]
fn get_window_rect(window: tauri::Window) -> Result<WindowRectInfo, String> {
  #[cfg(target_os = "windows")]
  {
    use windows_sys::Win32::Foundation::{HWND, RECT};
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect;

    let hwnd = window
      .hwnd()
      .map_err(|error| format!("window handle unavailable: {error}"))?;
    let hwnd_sys: HWND = hwnd.0 as HWND;

    let mut rect = RECT {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
    };

    let success = unsafe { GetWindowRect(hwnd_sys, &mut rect) };
    if success == 0 {
      return Err("GetWindowRect failed".to_string());
    }

    Ok(WindowRectInfo {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
    })
  }

  #[cfg(not(target_os = "windows"))]
  {
    let _ = window;
    Err("Window rect query is only supported on Windows.".to_string())
  }
}

#[tauri::command]
fn set_window_click_through(window: tauri::Window, enabled: bool) -> Result<WindowStyleInfo, String> {
  #[cfg(target_os = "windows")]
  {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
      GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, WS_EX_LAYERED,
      WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT, SWP_FRAMECHANGED, SWP_NOMOVE,
      SWP_NOSIZE, SWP_NOZORDER,
    };

    let hwnd = window
      .hwnd()
      .map_err(|error| format!("window handle unavailable: {error}"))?;
    let hwnd_sys: HWND = hwnd.0 as HWND;

    let ex_style = unsafe { GetWindowLongPtrW(hwnd_sys, GWL_EXSTYLE) } as usize;
    let next_style = if enabled {
      ex_style | (WS_EX_TRANSPARENT as usize)
    } else {
      ex_style & !(WS_EX_TRANSPARENT as usize)
    };

    let _ = unsafe { SetWindowLongPtrW(hwnd_sys, GWL_EXSTYLE, next_style as isize) };
    unsafe {
      SetWindowPos(
        hwnd_sys,
        std::ptr::null_mut(),
        0,
        0,
        0,
        0,
        SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
      );
    }

    // Verify the style was actually set
    let verified_style = unsafe { GetWindowLongPtrW(hwnd_sys, GWL_EXSTYLE) } as usize;

    Ok(WindowStyleInfo {
      ex_style: verified_style,
      has_layered: (verified_style & (WS_EX_LAYERED as usize)) != 0,
      has_transparent: (verified_style & (WS_EX_TRANSPARENT as usize)) != 0,
      has_toolwindow: (verified_style & (WS_EX_TOOLWINDOW as usize)) != 0,
      has_topmost: (verified_style & (WS_EX_TOPMOST as usize)) != 0,
    })
  }

  #[cfg(not(target_os = "windows"))]
  {
    let _ = (window, enabled);
    Err("Window click-through command is only supported on Windows.".to_string())
  }
}

#[tauri::command]
fn verify_webview_background_alpha(window: tauri::Window) -> Result<u8, String> {
  #[cfg(target_os = "windows")]
  {
    use std::sync::{Arc, Mutex};

    use webview2_com::Microsoft::Web::WebView2::Win32::{
      COREWEBVIEW2_COLOR, ICoreWebView2Controller2,
    };
    use windows::core::Interface;

    let command_result: Arc<Mutex<Result<u8, String>>> =
      Arc::new(Mutex::new(Err("not yet executed".to_string())));
    let command_result_ref = Arc::clone(&command_result);

    window
      .with_webview(move |webview| {
        let read_result = (|| -> Result<u8, String> {
          let controller = webview.controller();
          let controller2: ICoreWebView2Controller2 = controller
            .cast()
            .map_err(|error| format!("controller cast failed: {error}"))?;

          let mut applied = COREWEBVIEW2_COLOR {
            R: 0,
            G: 0,
            B: 0,
            A: 0,
          };
          unsafe {
            controller2
              .DefaultBackgroundColor(&mut applied)
              .map_err(|error| format!("DefaultBackgroundColor read failed: {error}"))?;
          }

          Ok(applied.A)
        })();

        if let Ok(mut guard) = command_result_ref.lock() {
          *guard = read_result;
        }
      })
      .map_err(|error| format!("with_webview failed: {error}"))?;

    return command_result
      .lock()
      .map_err(|_| "webview background verification lock poisoned".to_string())?
      .clone();
  }

  #[cfg(not(target_os = "windows"))]
  {
    let _ = window;
    Err("Webview background alpha verification is only supported on Windows.".to_string())
  }
}

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      get_runtime_log_path,
      append_runtime_log,
      get_global_cursor_position,
      get_window_cursor_position,
      set_webview_background_alpha,
      set_window_overlay_surface,
      verify_window_styles,
      get_window_rect,
      set_window_click_through,
      verify_webview_background_alpha
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
