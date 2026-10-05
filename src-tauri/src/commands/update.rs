use serde::Serialize;
use tauri::AppHandle;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterStatus {
  configured: bool,
  recovery_ready: bool,
}

#[tauri::command]
pub fn get_updater_status(app: AppHandle) -> UpdaterStatus {
  let updater = &app.config().tauri.updater;
  let has_release_endpoint = updater.endpoints.as_ref().is_some_and(|endpoints| {
    !endpoints.is_empty()
      && endpoints
        .iter()
        .all(|endpoint| endpoint.0.scheme() == "https" && endpoint.0.host_str().is_some())
  });
  UpdaterStatus {
    configured: updater.active && has_release_endpoint && has_public_key(&updater.pubkey),
    // No verified previous installer and recovery path are available yet.
    recovery_ready: false,
  }
}

fn has_public_key(value: &str) -> bool {
  let value = value.trim();
  !value.is_empty() && !value.contains("YOUR_UPDATER_SIGNATURE_PUBKEY_HERE")
}

#[cfg(test)]
mod tests {
  use super::has_public_key;

  #[test]
  fn updater_public_key_presence_rejects_empty_and_placeholder() {
    assert!(has_public_key(
      "untrusted comment: minisign public key\nRWQ-valid-format"
    ));
    assert!(!has_public_key("YOUR_UPDATER_SIGNATURE_PUBKEY_HERE"));
    assert!(!has_public_key(""));
  }
}
