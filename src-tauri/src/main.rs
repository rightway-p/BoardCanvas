#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod recovery;

fn main() {
  #[cfg(windows)]
  let startup_lock = match recovery::OperationLock::for_app_startup() {
    Ok(lock) => lock,
    Err(_) => { recovery::show_startup_blocked(); return; }
  };

  let app = tauri::Builder::default()
    .manage(commands::drive::DriveState::default())
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
      commands::overlay::verify_webview_background_alpha,
      commands::drive::drive_authenticate,
      commands::drive::drive_get_auth_status,
      commands::drive::drive_list_pdfs,
      commands::drive::drive_download_pdf,
      commands::drive::drive_set_active_pdf,
      commands::drive::drive_get_cache_status,
      commands::drive::drive_set_cache_limit,
      commands::drive::drive_sign_out,
      commands::update::get_updater_status,
      commands::update::set_beta_updates_enabled,
      commands::update::check_board_update,
      commands::update::check_stable_release,
      commands::update::prepare_board_update,
      commands::update::prepare_board_promotion,
      commands::update::authorize_prepared_operation,
      commands::update::cancel_prepared_operation,
      commands::update::launch_board_update,
      commands::update::launch_board_promotion,
      commands::update::get_recovery_status,
      commands::update::rollback_board_update,
      commands::update::acknowledge_recovery,
      commands::update::open_recovery_tool,
      commands::files::save_document_file
    ])
    .build(tauri::generate_context!())
    .expect("error while running tauri application");

  #[cfg(windows)]
  drop(startup_lock);
  app.run(|_, _| {});
}
