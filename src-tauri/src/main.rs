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
