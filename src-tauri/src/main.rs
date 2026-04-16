#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use serde::Serialize;

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
      commands::logging::get_runtime_log_path,
      commands::logging::append_runtime_log,
      commands::cursor::get_global_cursor_position,
      commands::cursor::get_window_cursor_position,
      set_webview_background_alpha,
      set_window_overlay_surface,
      commands::window::verify_window_styles,
      commands::window::get_window_rect,
      commands::window::set_window_click_through,
      verify_webview_background_alpha
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
