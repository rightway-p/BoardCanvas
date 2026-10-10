# Phase 1: Rust Command Module Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 481-line `src-tauri/src/main.rs` into per-domain command modules (`logging`, `cursor`, `window`, `overlay`) so `main.rs` only wires up Tauri and registers handlers, with zero behavior change.

**Architecture:** Introduce `src-tauri/src/commands/` as a module tree. Each submodule owns its command functions, shared types, and helpers — including the `#[cfg(target_os = "windows")]` branches. `main.rs` references them via qualified paths in `tauri::generate_handler!`. No code logic changes; this is a pure move+expose refactor (Layer L1 of `ARCHITECTURE.md`).

**Tech Stack:** Rust 2021, Tauri 1.6, `windows-sys` 0.61, `webview2-com` 0.19, `windows` 0.39.

**Verification:** There is no existing Rust test suite. "Pass" is defined as `cargo build` succeeding and `tauri::generate_handler!` listing the same 10 command names (by short name). After the final task, a manual desktop smoke test is required.

---

## File Structure (target)

```
src-tauri/src/
├── main.rs                          # ~15 lines: mod declaration + Builder wiring
└── commands/
    ├── mod.rs                       # declares submodules
    ├── logging.rs                   # runtime log path helper + 2 commands
    ├── cursor.rs                    # 2 cursor structs + 2 commands
    ├── window.rs                    # 2 window structs + 3 window commands
    └── overlay.rs                   # 3 webview/DWM overlay commands
```

**Shared-type decisions:**
- `WindowStyleInfo` is used by both `verify_window_styles` and `set_window_click_through`; both live in `window.rs`, so the struct stays there.
- `WindowRectInfo` is only used by `get_window_rect` → lives in `window.rs`.
- `CursorPosition` and `WindowCursorPosition` are only used in `cursor.rs`.
- `runtime_log_path()` helper is only used by log commands → lives in `logging.rs`.

No cross-module type sharing is required. Each module is self-contained.

---

## Task 1: Scaffold `commands/` module shell

**Files:**
- Create: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/main.rs` (add `mod commands;` declaration)

- [ ] **Step 1: Confirm baseline build passes**

Run (from repo root):
```bash
cd src-tauri && cargo build
```
Expected: successful build. If this fails, **stop** — the plan assumes a green baseline.

- [ ] **Step 2: Create the module root file**

Create `src-tauri/src/commands/mod.rs` with exactly:
```rust
pub mod cursor;
pub mod logging;
pub mod overlay;
pub mod window;
```

Note: the submodule files don't exist yet, so the next build step will fail — that's expected and verified in Step 4.

- [ ] **Step 3: Declare the module in `main.rs`**

In `src-tauri/src/main.rs`, insert `mod commands;` immediately after line 1 (`#![cfg_attr(...)]`) and before the `use` block. The top of the file becomes:
```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use std::fs::OpenOptions;
```

- [ ] **Step 4: Verify the scaffold fails to build (expected — submodules missing)**

Run:
```bash
cd src-tauri && cargo build
```
Expected: compile error mentioning one of `file not found for module 'cursor'` / `logging` / `overlay` / `window`. This confirms the module tree is wired. Do **not** commit yet — Tasks 2–5 create the files.

---

## Task 2: Extract logging commands

**Files:**
- Create: `src-tauri/src/commands/logging.rs`
- Modify: `src-tauri/src/main.rs` (remove original definitions, update handler list)

- [ ] **Step 1: Create `commands/logging.rs`**

Create `src-tauri/src/commands/logging.rs` with exactly:
```rust
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
pub fn get_runtime_log_path() -> String {
  runtime_log_path().to_string_lossy().to_string()
}

#[tauri::command]
pub fn append_runtime_log(message: String) -> Result<(), String> {
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
```

- [ ] **Step 2: Delete the originals from `main.rs`**

In `src-tauri/src/main.rs`, delete:
- Lines 42–46 (the `fn runtime_log_path()` definition)
- Lines 48–51 (the `#[tauri::command] fn get_runtime_log_path()` definition)
- Lines 53–71 (the `#[tauri::command] fn append_runtime_log()` definition)

(Line numbers refer to the current state before any edits in this task.)

- [ ] **Step 3: Update handler list in `main.rs`**

In `main.rs`'s `tauri::generate_handler!` macro, replace `get_runtime_log_path,` with `commands::logging::get_runtime_log_path,` and `append_runtime_log,` with `commands::logging::append_runtime_log,`.

- [ ] **Step 4: Verify build passes**

Run:
```bash
cd src-tauri && cargo build
```
Expected: success. Warnings about unused imports in `main.rs` are acceptable — they'll resolve as more code moves out.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/mod.rs src-tauri/src/commands/logging.rs src-tauri/src/main.rs
git commit -m "refactor(tauri): extract logging commands into commands::logging module"
```

---

## Task 3: Extract cursor commands

**Files:**
- Create: `src-tauri/src/commands/cursor.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Create `commands/cursor.rs`**

Create `src-tauri/src/commands/cursor.rs` with exactly:
```rust
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
```

- [ ] **Step 2: Delete the originals from `main.rs`**

In `main.rs`, delete the `CursorPosition` struct (originally lines 10–14), the `WindowCursorPosition` struct (originally lines 16–21), the `get_global_cursor_position` command (originally lines 73–96), and the `get_window_cursor_position` command (originally lines 98–140). Line numbers refer to the **pre-Task-2** file; after Task 2, these items shifted upward — locate them by name.

- [ ] **Step 3: Update handler list in `main.rs`**

In the `tauri::generate_handler!` macro, replace `get_global_cursor_position,` with `commands::cursor::get_global_cursor_position,` and `get_window_cursor_position,` with `commands::cursor::get_window_cursor_position,`.

- [ ] **Step 4: Verify build passes**

Run:
```bash
cd src-tauri && cargo build
```
Expected: success. If `main.rs` now has an unused `use serde::Serialize;` import (it will, since the remaining structs still use it), leave it — it gets removed in Task 6.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/cursor.rs src-tauri/src/main.rs
git commit -m "refactor(tauri): extract cursor commands into commands::cursor module"
```

---

## Task 4: Extract window commands

**Files:**
- Create: `src-tauri/src/commands/window.rs`
- Modify: `src-tauri/src/main.rs`

Note: `set_window_click_through` returns `WindowStyleInfo`, which is also used by `verify_window_styles`. Both live here together — no cross-module sharing needed.

- [ ] **Step 1: Create `commands/window.rs`**

Create `src-tauri/src/commands/window.rs` with exactly:
```rust
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
```

- [ ] **Step 2: Delete the originals from `main.rs`**

In `main.rs`, delete by name (line numbers have drifted):
- `struct WindowStyleInfo { ... }` definition
- `struct WindowRectInfo { ... }` definition
- `fn verify_window_styles(...) { ... }` command
- `fn get_window_rect(...) { ... }` command
- `fn set_window_click_through(...) { ... }` command

- [ ] **Step 3: Update handler list in `main.rs`**

In `tauri::generate_handler!`, replace the three bare identifiers:
- `verify_window_styles,` → `commands::window::verify_window_styles,`
- `get_window_rect,` → `commands::window::get_window_rect,`
- `set_window_click_through,` → `commands::window::set_window_click_through,`

- [ ] **Step 4: Verify build passes**

Run:
```bash
cd src-tauri && cargo build
```
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/window.rs src-tauri/src/main.rs
git commit -m "refactor(tauri): extract window commands into commands::window module"
```

---

## Task 5: Extract overlay commands

**Files:**
- Create: `src-tauri/src/commands/overlay.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Create `commands/overlay.rs`**

Create `src-tauri/src/commands/overlay.rs` with exactly:
```rust
#[tauri::command]
pub fn set_webview_background_alpha(window: tauri::Window, alpha: u8) -> Result<u8, String> {
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
pub fn set_window_overlay_surface(window: tauri::Window, enabled: bool) -> Result<bool, String> {
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
pub fn verify_webview_background_alpha(window: tauri::Window) -> Result<u8, String> {
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
```

- [ ] **Step 2: Delete the originals from `main.rs`**

In `main.rs`, delete by name:
- `fn set_webview_background_alpha(...) { ... }`
- `fn set_window_overlay_surface(...) { ... }`
- `fn verify_webview_background_alpha(...) { ... }`

- [ ] **Step 3: Update handler list in `main.rs`**

In `tauri::generate_handler!`, replace:
- `set_webview_background_alpha,` → `commands::overlay::set_webview_background_alpha,`
- `set_window_overlay_surface,` → `commands::overlay::set_window_overlay_surface,`
- `verify_webview_background_alpha` → `commands::overlay::verify_webview_background_alpha`

- [ ] **Step 4: Verify build passes**

Run:
```bash
cd src-tauri && cargo build
```
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/overlay.rs src-tauri/src/main.rs
git commit -m "refactor(tauri): extract overlay commands into commands::overlay module"
```

---

## Task 6: Clean up `main.rs` and verify end-to-end

**Files:**
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Remove now-unused imports and confirm final shape**

`main.rs` at this point should contain only the crate attribute, the `mod commands;` declaration, and `fn main()`. Replace the entire file contents with exactly:
```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      commands::logging::get_runtime_log_path,
      commands::logging::append_runtime_log,
      commands::cursor::get_global_cursor_position,
      commands::cursor::get_window_cursor_position,
      commands::overlay::set_webview_background_alpha,
      commands::overlay::set_window_overlay_surface,
      commands::window::verify_window_styles,
      commands::window::get_window_rect,
      commands::window::set_window_click_through,
      commands::overlay::verify_webview_background_alpha
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
```

Handler order matches the pre-refactor `main.rs` exactly (important: Tauri doesn't care about order, but preserving it keeps the diff obvious and makes bisects easier).

- [ ] **Step 2: Build with warnings elevated**

Run:
```bash
cd src-tauri && cargo build 2>&1 | tee build.log
grep -E "warning|error" build.log || true
rm build.log
```
Expected: no `warning: unused import` in `main.rs`. If any appear, the file wasn't cleaned up fully — re-check Step 1.

- [ ] **Step 3: Run a release build to make sure nothing regressed there**

Run:
```bash
cd src-tauri && cargo build --release
```
Expected: success. Release can surface issues (like dead-code warnings promoted to errors via `deny`) that debug hides.

- [ ] **Step 4: Desktop smoke test**

Run from repo root:
```bash
npm run desktop:dev
```
In the launched app:
1. Open DevTools (F12).
2. Paste into console: `await Diagnostics.runFullDiagnostics()`.
3. Confirm the output shows non-error values for `webviewAlpha`, `hasLayered`, `windowRect`, and the log path.
4. Press F8 to enter overlay mode, then F8 again to exit. Confirm the app doesn't crash and the console has no red errors related to invoke calls.

Expected: all diagnostics return values (not Tauri "command not found" errors); overlay toggle works as before. This confirms every command is still reachable by its registered name.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "refactor(tauri): reduce main.rs to module wiring only"
```

- [ ] **Step 6: Tag end of Phase 1**

```bash
git log --oneline -6
```
Expected: the last five commits are the Task 2–6 commits, in order. Report the commit hashes in the PR description or plan execution log.

---

## Rollback plan

If any task's build fails and the cause isn't obvious within 10 minutes of poking:
```bash
cd src-tauri && git checkout src/main.rs src/commands/
```
This reverts to the last committed state (end of the previous task). Then re-read the failing task's Step 1 code block — a typo in the `pub fn` signatures is the single most likely cause.

---

## Spec coverage self-check

- L1 goal from `ARCHITECTURE.md` §2 — "도메인별로 분리된 Rust 커맨드 모듈" ✓ (Tasks 2–5)
- L1 goal — "`main.rs`는 모듈 등록만 담당 (10줄 이하 목표)" ✓ (Task 6 Step 1 produces ~18-line `main.rs`; `fn main` body is 14 lines, close enough to the spirit of the rule)
- L1 goal — "`#[cfg(target_os = "windows")]`는 해당 모듈 내부에서만 사용" ✓ (every cfg attribute lives inside a `commands/*.rs` file after Task 5)
- `tauri.conf.json` `allowlist` minimization is explicitly deferred to Phase 6 per `ARCHITECTURE.md` §6 — intentionally not in scope here.
