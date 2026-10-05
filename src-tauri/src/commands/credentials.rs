use sha2::{Digest, Sha256};

const APP_ID: &str = "com.rightway.boardcanvas";

pub trait CredentialStore {
  fn load(&self, target: &str) -> Result<Option<String>, String>;
  fn save(&self, target: &str, value: &str) -> Result<(), String>;
  fn delete(&self, target: &str) -> Result<(), String>;
}

pub fn persist_refresh_token(
  store: &impl CredentialStore,
  target: &str,
  value: &str,
) -> Option<String> {
  match store.save(target, value) {
    Ok(()) => None,
    Err(error) => Some(match store.delete(target) {
      Ok(()) => error,
      Err(delete_error) => {
        format!("{error} The previous saved sign-in could not be removed: {delete_error}")
      }
    }),
  }
}

pub struct SystemCredentialStore;

pub fn refresh_token_target(client_id: &str) -> String {
  let digest = Sha256::digest(client_id.as_bytes());
  let hash = digest
    .iter()
    .map(|byte| format!("{byte:02x}"))
    .collect::<String>();
  format!("BoardCanvas:{APP_ID}:drive-refresh:{hash}")
}

#[cfg(target_os = "windows")]
impl CredentialStore for SystemCredentialStore {
  fn load(&self, target: &str) -> Result<Option<String>, String> {
    use std::{ffi::c_void, ptr};
    use windows_sys::Win32::{
      Foundation::{GetLastError, ERROR_NOT_FOUND},
      Security::Credentials::{CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC},
    };

    let target = wide(target);
    let mut credential: *mut CREDENTIALW = ptr::null_mut();
    if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) } == 0 {
      return if unsafe { GetLastError() } == ERROR_NOT_FOUND {
        Ok(None)
      } else {
        Err("Windows Credential Manager could not read the Google Drive sign-in.".to_string())
      };
    }
    let value = unsafe {
      let credential = &*credential;
      if credential.CredentialBlob.is_null() || credential.CredentialBlobSize == 0 {
        Vec::new()
      } else {
        std::slice::from_raw_parts(
          credential.CredentialBlob,
          credential.CredentialBlobSize as usize,
        )
        .to_vec()
      }
    };
    unsafe {
      CredFree(credential.cast::<c_void>());
    }
    String::from_utf8(value)
      .map(Some)
      .map_err(|_| "The saved Google Drive sign-in is invalid. Sign in again.".to_string())
  }

  fn save(&self, target: &str, value: &str) -> Result<(), String> {
    use windows_sys::Win32::Security::Credentials::{
      CredWriteW, CREDENTIALW, CRED_MAX_CREDENTIAL_BLOB_SIZE, CRED_PERSIST_LOCAL_MACHINE,
      CRED_TYPE_GENERIC,
    };

    if value.is_empty() || value.len() > CRED_MAX_CREDENTIAL_BLOB_SIZE as usize {
      return Err(
        "The Google Drive sign-in cannot be saved in Windows Credential Manager.".to_string(),
      );
    }
    let mut target = wide(target);
    let username = wide("BoardCanvas");
    let mut credential = CREDENTIALW::default();
    credential.Type = CRED_TYPE_GENERIC;
    credential.TargetName = target.as_mut_ptr();
    credential.UserName = username.as_ptr() as *mut _;
    credential.CredentialBlobSize = value.len() as u32;
    credential.CredentialBlob = value.as_ptr() as *mut u8;
    credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
    if unsafe { CredWriteW(&credential, 0) } == 0 {
      return Err(
        "Windows Credential Manager could not save the Google Drive sign-in.".to_string(),
      );
    }
    Ok(())
  }

  fn delete(&self, target: &str) -> Result<(), String> {
    use windows_sys::Win32::{
      Foundation::{GetLastError, ERROR_NOT_FOUND},
      Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC},
    };

    let target = wide(target);
    if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } == 0
      && unsafe { GetLastError() } != ERROR_NOT_FOUND
    {
      return Err(
        "Windows Credential Manager could not remove the Google Drive sign-in.".to_string(),
      );
    }
    Ok(())
  }
}

#[cfg(not(target_os = "windows"))]
impl CredentialStore for SystemCredentialStore {
  fn load(&self, _target: &str) -> Result<Option<String>, String> {
    Err("Persistent Google Drive sign-in is available only on Windows.".to_string())
  }
  fn save(&self, _target: &str, _value: &str) -> Result<(), String> {
    Err("Persistent Google Drive sign-in is available only on Windows.".to_string())
  }
  fn delete(&self, _target: &str) -> Result<(), String> {
    Err("Persistent Google Drive sign-in is available only on Windows.".to_string())
  }
}

#[cfg(target_os = "windows")]
fn wide(value: &str) -> Vec<u16> {
  value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(test)]
mod tests {
  use super::{persist_refresh_token, refresh_token_target, CredentialStore};
  use std::{cell::RefCell, collections::HashMap};

  #[derive(Default)]
  struct FakeCredentialStore(RefCell<HashMap<String, String>>);

  impl CredentialStore for FakeCredentialStore {
    fn load(&self, target: &str) -> Result<Option<String>, String> {
      Ok(self.0.borrow().get(target).cloned())
    }
    fn save(&self, target: &str, value: &str) -> Result<(), String> {
      self
        .0
        .borrow_mut()
        .insert(target.to_string(), value.to_string());
      Ok(())
    }
    fn delete(&self, target: &str) -> Result<(), String> {
      self.0.borrow_mut().remove(target);
      Ok(())
    }
  }

  #[derive(Default)]
  struct FailingSaveStore(RefCell<HashMap<String, String>>);

  impl CredentialStore for FailingSaveStore {
    fn load(&self, target: &str) -> Result<Option<String>, String> {
      Ok(self.0.borrow().get(target).cloned())
    }
    fn save(&self, _target: &str, _value: &str) -> Result<(), String> {
      Err("fake write failure".to_string())
    }
    fn delete(&self, target: &str) -> Result<(), String> {
      self.0.borrow_mut().remove(target);
      Ok(())
    }
  }

  #[test]
  fn app_owned_refresh_entries_are_scoped_to_the_oauth_client() {
    let store = FakeCredentialStore::default();
    let app_target = refresh_token_target("board-client");
    let other_target = refresh_token_target("other-client");
    store.save(&app_target, "app-refresh-secret").unwrap();
    store.save(&other_target, "other-refresh-secret").unwrap();

    store.delete(&app_target).unwrap();

    assert_eq!(store.load(&app_target).unwrap(), None);
    assert_eq!(
      store.load(&other_target).unwrap().as_deref(),
      Some("other-refresh-secret")
    );
  }

  #[test]
  fn failed_replacement_removes_an_old_account_token() {
    let store = FailingSaveStore::default();
    let target = refresh_token_target("board-client");
    store
      .0
      .borrow_mut()
      .insert(target.clone(), "old-account-token".to_string());

    assert_eq!(
      persist_refresh_token(&store, &target, "new-account-token").as_deref(),
      Some("fake write failure")
    );
    assert_eq!(store.load(&target).unwrap(), None);
  }
}
