use serde::Serialize;

#[derive(Serialize)]
pub struct CursorPosition {
  pub x: i32,
  pub y: i32,
}

#[derive(Serialize)]
pub struct WindowCursorPosition {
  pub x: i32,
  pub y: i32,
  pub scale_factor: f64,
}

#[tauri::command]
pub fn get_global_cursor_position() -> Result<CursorPosition, String> {
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
pub fn get_window_cursor_position(window: tauri::Window) -> Result<WindowCursorPosition, String> {
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
