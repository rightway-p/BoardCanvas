fn main() {
  println!("cargo:rerun-if-env-changed=BOARD_RELEASE_CHANNEL");
  let channel = std::env::var("BOARD_RELEASE_CHANNEL").unwrap_or_else(|_| "beta".to_string());
  if channel != "beta" && channel != "stable" { panic!("BOARD_RELEASE_CHANNEL must be beta or stable"); }
  println!("cargo:rustc-env=BOARD_RELEASE_CHANNEL={channel}");
  if std::env::var_os("CARGO_FEATURE_RECOVERY_HELPER_BUILD").is_none() {
    tauri_build::build()
  }
}

