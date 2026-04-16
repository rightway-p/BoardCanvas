use serde::Serialize;

#[derive(Serialize)]
pub struct WindowStyleInfo {
  pub ex_style: usize,
  pub has_layered: bool,
  pub has_transparent: bool,
  pub has_toolwindow: bool,
  pub has_topmost: bool,
}

#[derive(Serialize)]
pub struct WindowRectInfo {
  pub left: i32,
  pub top: i32,
  pub right: i32,
  pub bottom: i32,
  pub width: i32,
  pub height: i32,
}

#[tauri::command]
pub fn verify_window_styles(window: tauri::Window) -> Result<WindowStyleInfo, String> {
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
pub fn get_window_rect(window: tauri::Window) -> Result<WindowRectInfo, String> {
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
pub fn set_window_click_through(window: tauri::Window, enabled: bool) -> Result<WindowStyleInfo, String> {
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
