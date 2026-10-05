use base64::{engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD}, Engine};
use rand::{distributions::Alphanumeric, Rng};
use reqwest::{header, Client, Response};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
  fs::{self, File, OpenOptions},
  io::Write,
  path::{Path, PathBuf},
  process::{Command, Stdio},
  sync::{atomic::{AtomicU64, Ordering}, Mutex},
  time::{Duration, Instant, SystemTime},
};
use tauri::{AppHandle, State};
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::TcpListener, sync::Mutex as AsyncMutex, time};
use url::Url;
use super::credentials::{persist_refresh_token, refresh_token_target, CredentialStore, SystemCredentialStore};

const DRIVE_API: &str = "https://www.googleapis.com/drive/v3";
const OAUTH_AUTH: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN: &str = "https://oauth2.googleapis.com/token";
const DRIVE_SCOPE: &str = "https://www.googleapis.com/auth/drive.readonly";
const DEFAULT_CACHE_LIMIT: u64 = 2 * 1024 * 1024 * 1024;
const MIN_CACHE_LIMIT: u64 = 64 * 1024 * 1024;
const MAX_CACHE_LIMIT: u64 = 16 * 1024 * 1024 * 1024;
const MAX_SOURCE_PDF_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Default)]
pub struct DriveState {
  token: Mutex<Option<TokenSet>>,
  auth_warning: Mutex<Option<String>>,
  auth_operation: AsyncMutex<()>,
  active_hash: Mutex<Option<String>>,
  cache_lock: AsyncMutex<()>,
  auth_generation: AtomicU64,
}

#[derive(Clone)]
struct TokenSet {
  access_token: String,
  refresh_token: Option<String>,
  expires_at: Instant,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthResult {
  connected: bool,
  warning: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveAuthStatus {
  connected: bool,
  message: Option<String>,
  warning: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfList {
  files: Vec<DrivePdf>,
  next_page_token: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DrivePdf {
  id: String,
  name: String,
  mime_type: String,
  size: Option<String>,
  modified_time: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PdfListResponse {
  #[serde(default)]
  files: Vec<DrivePdf>,
  next_page_token: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
  access_token: String,
  expires_in: u64,
  refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct OAuthErrorResponse {
  error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveFileResponse {
  id: String,
  name: String,
  mime_type: String,
  size: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
  file_id: String,
  name: String,
  size: u64,
  pdf_base64: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStatus {
  limit_bytes: u64,
  used_bytes: u64,
  default_limit_bytes: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheSettings {
  limit_bytes: u64,
}

#[tauri::command]
pub async fn drive_authenticate(state: State<'_, DriveState>) -> Result<AuthResult, String> {
  let _auth_operation = state.auth_operation.lock().await;
  let client_id = oauth_client_id()?;
  let generation = begin_sign_in(&state)?;
  let client = http_client()?;
  let verifier = random_string(64);
  let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
  let oauth_state = random_string(48);
  let listener = TcpListener::bind(("127.0.0.1", 0)).await.map_err(|error| format!("Could not start Google sign-in callback: {error}"))?;
  let port = listener.local_addr().map_err(|error| error.to_string())?.port();
  let redirect_uri = format!("http://127.0.0.1:{port}");
  let mut auth_url = Url::parse(OAUTH_AUTH).map_err(|error| error.to_string())?;
  auth_url.query_pairs_mut()
    .append_pair("client_id", client_id)
    .append_pair("redirect_uri", &redirect_uri)
    .append_pair("response_type", "code")
    .append_pair("scope", DRIVE_SCOPE)
    .append_pair("state", &oauth_state)
    .append_pair("code_challenge", &challenge)
    .append_pair("code_challenge_method", "S256")
    .append_pair("access_type", "offline");

  open_system_browser(auth_url.as_str())?;
  let code = time::timeout(Duration::from_secs(300), receive_oauth_code(&listener, &oauth_state))
    .await
    .map_err(|_| "Google sign-in timed out. Try connecting again.".to_string())??;
  let tokens: TokenResponse = client.post(OAUTH_TOKEN)
    .form(&[
      ("client_id", client_id),
      ("code", code.as_str()),
      ("code_verifier", verifier.as_str()),
      ("grant_type", "authorization_code"),
      ("redirect_uri", redirect_uri.as_str()),
    ])
    .send().await.map_err(|error| format!("Google token exchange failed: {error}"))?
    .error_for_status().map_err(|error| format!("Google token exchange failed: {error}"))?
    .json().await.map_err(|error| format!("Google token response was invalid: {error}"))?;
  let refresh_token = tokens.refresh_token;
  let target = refresh_token_target(client_id);
  let store = SystemCredentialStore;
  let warning = match refresh_token.as_deref() {
    Some(refresh_token) => persist_refresh_token(&store, &target, refresh_token),
    None => {
      store.delete(&target).err().or_else(|| Some("Google did not provide a saved sign-in. You may need to log in again after restarting BoardCanvas.".to_string()))
    }
  };
  install_tokens(&state, generation, TokenSet {
    access_token: tokens.access_token,
    refresh_token,
    expires_at: token_expiry(tokens.expires_in),
  })?;
  *state.auth_warning.lock().map_err(|_| "Google sign-in status is unavailable".to_string())? = warning.clone();
  Ok(AuthResult { connected: true, warning })
}

#[tauri::command]
pub async fn drive_get_auth_status(state: State<'_, DriveState>) -> Result<DriveAuthStatus, String> {
  let _auth_operation = state.auth_operation.lock().await;
  let client_id = match oauth_client_id() {
    Ok(client_id) => client_id,
    Err(message) => return Ok(DriveAuthStatus { connected: false, message: Some(message), warning: None }),
  };
  if state.token.lock().map_err(|_| "Google sign-in state is unavailable".to_string())?.as_ref().is_some_and(|tokens| tokens.expires_at > Instant::now()) {
    let warning = state.auth_warning.lock().map_err(|_| "Google sign-in status is unavailable".to_string())?.clone();
    return Ok(DriveAuthStatus { connected: true, message: None, warning });
  }

  let target = refresh_token_target(client_id);
  let store = SystemCredentialStore;
  let memory_tokens = state.token.lock().map_err(|_| "Google sign-in state is unavailable".to_string())?.clone();
  let stored_refresh_token = match memory_tokens.as_ref().and_then(|tokens| tokens.refresh_token.clone()) {
    Some(refresh_token) => Some(refresh_token),
    None => store.load(&target)?,
  };
  let Some(refresh_token) = stored_refresh_token else {
    return Ok(DriveAuthStatus { connected: false, message: None, warning: None });
  };
  let generation = begin_sign_in(&state)?;
  install_tokens(&state, generation, TokenSet {
    access_token: String::new(),
    refresh_token: Some(refresh_token.clone()),
    expires_at: Instant::now(),
  })?;
  let refreshed = match refresh_access_token(client_id, &refresh_token).await {
    Ok(tokens) => tokens,
    Err(RefreshError::InvalidGrant) => {
      invalidate_tokens(&state)?;
      let message = match store.delete(&target) {
        Ok(()) => "저장된 Google 로그인이 만료되었습니다. 다시 로그인해 주세요.".to_string(),
        Err(error) => format!("저장된 Google 로그인이 만료되었습니다. 로그인을 다시 진행해 주세요. {error}"),
      };
      return Ok(DriveAuthStatus { connected: false, message: Some(message), warning: None });
    }
    Err(RefreshError::Other(message)) => return Err(message),
  };
  let next_refresh_token = refreshed.refresh_token.unwrap_or_else(|| refresh_token.clone());
  let warning = if next_refresh_token != refresh_token {
    persist_refresh_token(&store, &target, &next_refresh_token)
  } else {
    None
  };
  install_tokens(&state, generation, TokenSet {
    access_token: refreshed.access_token,
    refresh_token: Some(next_refresh_token),
    expires_at: token_expiry(refreshed.expires_in),
  })?;
  *state.auth_warning.lock().map_err(|_| "Google sign-in status is unavailable".to_string())? = warning.clone();
  Ok(DriveAuthStatus { connected: true, message: None, warning })
}

#[tauri::command]
pub async fn drive_list_pdfs(state: State<'_, DriveState>, page_token: Option<String>) -> Result<PdfList, String> {
  let token = access_token(&state).await?;
  let mut request = http_client()?.get(format!("{DRIVE_API}/files"))
    .bearer_auth(token)
    .query(&[
      ("q", "mimeType = 'application/pdf' and trashed = false"),
      ("spaces", "drive"),
      ("pageSize", "100"),
      ("orderBy", "name"),
      ("fields", "nextPageToken,files(id,name,mimeType,size,modifiedTime)"),
    ]);
  if let Some(page_token) = page_token.filter(|value| !value.is_empty()) {
    request = request.query(&[("pageToken", page_token)]);
  }
  let response = request.send().await.map_err(|error| format!("Google Drive file list failed: {error}"))?;
  let response: PdfListResponse = json_response(response).await?;
  Ok(PdfList { files: response.files, next_page_token: response.next_page_token })
}

#[tauri::command]
pub async fn drive_download_pdf(app: AppHandle, state: State<'_, DriveState>, file_id: String) -> Result<DownloadResult, String> {
  validate_file_id(&file_id)?;
  let token = access_token(&state).await?;
  let _cache_guard = state.cache_lock.lock().await;
  let root = cache_dir(&app)?;
  fs::create_dir_all(&root).map_err(|error| format!("Could not create PDF cache: {error}"))?;
  cleanup_partial_downloads(&root)?;
  let limit = read_settings(&root)?.limit_bytes;
  let active = state.active_hash.lock().map_err(|_| "PDF cache state is unavailable".to_string())?.clone();
  let hash = hash_id(&file_id);
  let target = root.join(format!("{hash}.pdf"));

  let metadata: DriveFileResponse = json_response(http_client()?.get(format!("{DRIVE_API}/files/{file_id}"))
    .bearer_auth(&token).query(&[("fields", "id,name,mimeType,size")]).send().await
    .map_err(|error| format!("Google Drive PDF lookup failed: {error}"))?).await?;
  if metadata.id != file_id || metadata.mime_type != "application/pdf" {
    return Err("The selected Google Drive file is not a PDF.".to_string());
  }
  if let Some(size) = metadata.size.as_deref().and_then(|size| size.parse::<u64>().ok()) {
    ensure_source_pdf_size(size)?;
    if size > limit { return Err(format!("This PDF is larger than the configured cache limit ({limit} bytes). Raise the cache limit or choose a smaller PDF.")); }
  }
  if target.exists() && is_pdf(&target) {
    ensure_source_pdf_size(fs::metadata(&target).map_err(|error| format!("Could not inspect cached PDF: {error}"))?.len())?;
    let file = OpenOptions::new().write(true).open(&target).map_err(|error| error.to_string())?;
    file.set_modified(SystemTime::now()).map_err(|error| error.to_string())?;
    let bytes = fs::read(&target).map_err(|error| format!("Could not read cached PDF: {error}"))?;
    return Ok(download_result(metadata, bytes));
  }
  if target.exists() { fs::remove_file(&target).map_err(|error| format!("Could not remove invalid cached PDF: {error}"))?; }

  let temp = root.join(format!("{hash}.part"));
  if temp.exists() { fs::remove_file(&temp).map_err(|error| format!("Could not clear incomplete PDF: {error}"))?; }
  let mut file = OpenOptions::new().write(true).create_new(true).open(&temp)
    .map_err(|error| format!("Could not create temporary PDF: {error}"))?;
  let mut cleanup = RemoveOnDrop(Some(temp.clone()));
  let response = http_client()?.get(format!("{DRIVE_API}/files/{file_id}"))
    .bearer_auth(token).query(&[("alt", "media")]).send().await
    .map_err(|error| format!("Google Drive PDF download failed: {error}"))?;
  if !response.status().is_success() { return Err(response_error(response).await); }
  if response.headers().get(header::CONTENT_TYPE).and_then(|value| value.to_str().ok())
    .is_some_and(|value| !value.to_ascii_lowercase().starts_with("application/pdf")) {
    return Err("Google Drive returned a non-PDF file.".to_string());
  }
  if let Some(size) = response.content_length() {
    ensure_source_pdf_size(size)?;
    if size > limit { return Err(format!("This PDF is larger than the configured cache limit ({limit} bytes). Raise the cache limit or choose a smaller PDF.")); }
    ensure_capacity(&root, limit, active.as_deref(), size)?;
  }
  let mut response = response;
  let mut written = 0u64;
  let mut header_bytes = Vec::with_capacity(5);
  while let Some(chunk) = response.chunk().await.map_err(|error| format!("Google Drive PDF download failed: {error}"))? {
    let next = written.checked_add(chunk.len() as u64).ok_or_else(|| "PDF size overflow".to_string())?;
    ensure_source_pdf_size(next)?;
    ensure_capacity(&root, limit, active.as_deref(), next)?;
    if header_bytes.len() < 5 { header_bytes.extend_from_slice(&chunk[..chunk.len().min(5 - header_bytes.len())]); }
    file.write_all(&chunk).map_err(|error| format!("Could not write cached PDF: {error}"))?;
    written = next;
  }
  if !header_bytes.starts_with(b"%PDF-") { return Err("Google Drive returned invalid PDF data.".to_string()); }
  file.sync_all().map_err(|error| format!("Could not finish cached PDF: {error}"))?;
  drop(file);
  fs::rename(&temp, &target).map_err(|error| format!("Could not finalize cached PDF: {error}"))?;
  cleanup.0 = None;
  let cached = OpenOptions::new().write(true).open(&target).map_err(|error| error.to_string())?;
  cached.set_modified(SystemTime::now()).map_err(|error| error.to_string())?;
  ensure_source_pdf_size(fs::metadata(&target).map_err(|error| format!("Could not inspect cached PDF: {error}"))?.len())?;
  let bytes = fs::read(&target).map_err(|error| format!("Could not read cached PDF: {error}"))?;
  Ok(download_result(metadata, bytes))
}

#[tauri::command]
pub async fn drive_set_active_pdf(app: AppHandle, state: State<'_, DriveState>, file_id: Option<String>) -> Result<(), String> {
  let _guard = state.cache_lock.lock().await;
  let root = cache_dir(&app)?;
  fs::create_dir_all(&root).map_err(|error| format!("Could not create PDF cache: {error}"))?;
  cleanup_partial_downloads(&root)?;
  let hash = file_id.map(|id| {
    validate_file_id(&id)?;
    let hash = hash_id(&id);
    let path = root.join(format!("{hash}.pdf"));
    if !is_pdf(&path) { return Err("The PDF must be downloaded into the app cache before it can be pinned.".to_string()); }
    Ok(hash)
  }).transpose()?;
  *state.active_hash.lock().map_err(|_| "PDF cache state is unavailable".to_string())? = hash;
  Ok(())
}

#[tauri::command]
pub async fn drive_get_cache_status(app: AppHandle, state: State<'_, DriveState>) -> Result<CacheStatus, String> {
  let _guard = state.cache_lock.lock().await;
  let root = cache_dir(&app)?;
  fs::create_dir_all(&root).map_err(|error| format!("Could not create PDF cache: {error}"))?;
  cleanup_partial_downloads(&root)?;
  cache_status(&root, &read_settings(&root)?)
}

#[tauri::command]
pub async fn drive_set_cache_limit(app: AppHandle, state: State<'_, DriveState>, bytes: u64) -> Result<CacheStatus, String> {
  if !(MIN_CACHE_LIMIT..=MAX_CACHE_LIMIT).contains(&bytes) {
    return Err(format!("Cache limit must be between {MIN_CACHE_LIMIT} and {MAX_CACHE_LIMIT} bytes."));
  }
  let _guard = state.cache_lock.lock().await;
  let root = cache_dir(&app)?;
  fs::create_dir_all(&root).map_err(|error| format!("Could not create PDF cache: {error}"))?;
  cleanup_partial_downloads(&root)?;
  let active = state.active_hash.lock().map_err(|_| "PDF cache state is unavailable".to_string())?.clone();
  ensure_capacity(&root, bytes, active.as_deref(), 0)?;
  write_settings(&root, bytes)?;
  cache_status(&root, &CacheSettings { limit_bytes: bytes })
}

#[tauri::command]
pub async fn drive_sign_out(state: State<'_, DriveState>) -> Result<(), String> {
  let _auth_operation = state.auth_operation.lock().await;
  if let Ok(client_id) = oauth_client_id() {
    SystemCredentialStore.delete(&refresh_token_target(client_id))?;
  }
  invalidate_tokens(&state)
}

fn install_tokens(state: &DriveState, generation: u64, tokens: TokenSet) -> Result<(), String> {
  let mut auth = state.token.lock().map_err(|_| "Google sign-in state is unavailable".to_string())?;
  if state.auth_generation.load(Ordering::SeqCst) != generation {
    return Err("Google Drive was disconnected while signing in. Connect again.".to_string());
  }
  *auth = Some(tokens);
  Ok(())
}

fn begin_sign_in(state: &DriveState) -> Result<u64, String> {
  let _auth = state.token.lock().map_err(|_| "Google sign-in state is unavailable".to_string())?;
  Ok(state.auth_generation.fetch_add(1, Ordering::SeqCst).wrapping_add(1))
}

fn invalidate_tokens(state: &DriveState) -> Result<(), String> {
  let mut auth = state.token.lock().map_err(|_| "Google sign-in state is unavailable".to_string())?;
  state.auth_generation.fetch_add(1, Ordering::SeqCst);
  *auth = None;
  *state.auth_warning.lock().map_err(|_| "Google sign-in status is unavailable".to_string())? = None;
  Ok(())
}

async fn access_token(state: &DriveState) -> Result<String, String> {
  let _auth_operation = state.auth_operation.lock().await;
  let (tokens, generation) = {
    let auth = state.token.lock().map_err(|_| "Google sign-in state is unavailable".to_string())?;
    (auth.clone(), state.auth_generation.load(Ordering::SeqCst))
  };
  let tokens = tokens.ok_or_else(|| "Connect Google Drive before listing or downloading PDFs.".to_string())?;
  if tokens.expires_at > Instant::now() { return Ok(tokens.access_token); }
  let refresh_token = tokens.refresh_token.clone().ok_or_else(|| "Google Drive sign-in expired. Connect again.".to_string())?;
  let client_id = oauth_client_id()?;
  let response = match refresh_access_token(client_id, &refresh_token).await {
    Ok(response) => response,
    Err(RefreshError::InvalidGrant) => {
      invalidate_tokens(state)?;
      if let Ok(client_id) = oauth_client_id() { SystemCredentialStore.delete(&refresh_token_target(client_id))?; }
      return Err("Google Drive sign-in expired. Sign in again.".to_string());
    }
    Err(RefreshError::Other(message)) => return Err(message),
  };
  let access = response.access_token.clone();
  let refreshed_token = response.refresh_token.unwrap_or_else(|| refresh_token.clone());
  let target = refresh_token_target(client_id);
  let warning = if refreshed_token != refresh_token { persist_refresh_token(&SystemCredentialStore, &target, &refreshed_token) } else { None };
  install_tokens(state, generation, TokenSet {
    access_token: response.access_token,
    refresh_token: Some(refreshed_token),
    expires_at: token_expiry(response.expires_in),
  })?;
  if warning.is_some() {
    *state.auth_warning.lock().map_err(|_| "Google sign-in status is unavailable".to_string())? = warning;
  }
  Ok(access)
}

enum RefreshError {
  InvalidGrant,
  Other(String),
}

async fn refresh_access_token(client_id: &str, refresh_token: &str) -> Result<TokenResponse, RefreshError> {
  let response = http_client().map_err(|_| RefreshError::Other("Google token refresh could not be started.".to_string()))?
    .post(OAUTH_TOKEN)
    .form(&[("client_id", client_id), ("refresh_token", refresh_token), ("grant_type", "refresh_token")])
    .send().await.map_err(|_| RefreshError::Other("Google token refresh failed. Check your connection and try again.".to_string()))?;
  let status = response.status();
  if !status.is_success() {
    let code = response.json::<OAuthErrorResponse>().await.ok().and_then(|body| body.error);
    return if code.as_deref() == Some("invalid_grant") {
      Err(RefreshError::InvalidGrant)
    } else {
      Err(RefreshError::Other(format!("Google token refresh failed (HTTP {status}).")))
    };
  }
  response.json().await.map_err(|_| RefreshError::Other("Google token response was invalid.".to_string()))
}

fn oauth_client_id() -> Result<&'static str, String> {
  option_env!("BOARD_GOOGLE_OAUTH_CLIENT_ID").map(str::trim).filter(|value| !value.is_empty())
    .ok_or_else(|| "Google Drive is not configured. Set BOARD_GOOGLE_OAUTH_CLIENT_ID to a Google OAuth Desktop client ID, then rebuild.".to_string())
}

fn token_expiry(expires_in: u64) -> Instant {
  Instant::now() + Duration::from_secs(expires_in.saturating_sub(30))
}

async fn receive_oauth_code(listener: &TcpListener, expected_state: &str) -> Result<String, String> {
  loop {
    let (mut stream, address) = listener.accept().await.map_err(|error| format!("Google sign-in callback failed: {error}"))?;
    if !address.ip().is_loopback() { continue; }
    let mut request = Vec::with_capacity(1024);
    let mut buffer = [0u8; 1024];
    while request.len() < 8192 && !request.windows(4).any(|window| window == b"\r\n\r\n") {
      let count = stream.read(&mut buffer).await.map_err(|error| format!("Google sign-in callback failed: {error}"))?;
      if count == 0 { break; }
      request.extend_from_slice(&buffer[..count]);
    }
    let first_line = String::from_utf8_lossy(&request).lines().next().unwrap_or_default().to_string();
    let target = first_line.split_whitespace().nth(1).unwrap_or("/");
    let callback = Url::parse(&format!("http://127.0.0.1{target}"));
    let Some(callback) = callback.ok() else { continue; };
    if callback.path() != "/" { continue; }
    let pairs: std::collections::HashMap<String, String> = callback.query_pairs().into_owned().collect();
    if pairs.get("state").map(String::as_str) != Some(expected_state) {
      respond(&mut stream, "400 Bad Request", "Sign-in state did not match. Return to BoardCanvas and try again.").await;
      continue;
    }
    if let Some(error) = pairs.get("error") {
      respond(&mut stream, "400 Bad Request", "Google sign-in was cancelled. Return to BoardCanvas.").await;
      return Err(format!("Google sign-in was not completed ({error})."));
    }
    let code = pairs.get("code").cloned().ok_or_else(|| "Google sign-in callback did not contain an authorization code.".to_string())?;
    respond(&mut stream, "200 OK", "Google Drive connected. You can close this tab and return to BoardCanvas.").await;
    return Ok(code);
  }
}

async fn respond(stream: &mut tokio::net::TcpStream, status: &str, message: &str) {
  let body = format!("<!doctype html><title>BoardCanvas</title><p>{message}</p>");
  let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
  let _ = stream.write_all(response.as_bytes()).await;
}

fn open_system_browser(url: &str) -> Result<(), String> {
  #[cfg(target_os = "windows")]
  let mut command = { let mut cmd = Command::new("rundll32.exe"); cmd.args(["url.dll,FileProtocolHandler", url]); cmd };
  #[cfg(target_os = "macos")]
  let mut command = { let mut cmd = Command::new("open"); cmd.arg(url); cmd };
  #[cfg(all(unix, not(target_os = "macos")))]
  let mut command = { let mut cmd = Command::new("xdg-open"); cmd.arg(url); cmd };
  command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
    .map(|_| ()).map_err(|error| format!("Could not open the system browser for Google sign-in: {error}"))
}

fn http_client() -> Result<Client, String> {
  Client::builder().connect_timeout(Duration::from_secs(20)).timeout(Duration::from_secs(300))
    .build().map_err(|error| format!("Could not initialize secure Google connection: {error}"))
}

async fn json_response<T: for<'de> Deserialize<'de>>(response: Response) -> Result<T, String> {
  let response = if response.status().is_success() { response } else { return Err(response_error(response).await); };
  response.json().await.map_err(|error| format!("Google Drive returned an invalid response: {error}"))
}

async fn response_error(response: Response) -> String {
  let status = response.status();
  let detail = response.json::<serde_json::Value>().await.ok()
    .and_then(|body| body.get("error").and_then(|error| error.get("message")).and_then(serde_json::Value::as_str).map(str::to_string));
  detail.map(|message| format!("Google Drive request failed ({status}): {message}"))
    .unwrap_or_else(|| format!("Google Drive request failed ({status})."))
}

fn download_result(metadata: DriveFileResponse, bytes: Vec<u8>) -> DownloadResult {
  DownloadResult { file_id: metadata.id, name: metadata.name, size: bytes.len() as u64, pdf_base64: STANDARD.encode(bytes) }
}

fn ensure_source_pdf_size(size: u64) -> Result<(), String> {
  if size > MAX_SOURCE_PDF_BYTES {
    return Err(format!("This PDF exceeds the {MAX_SOURCE_PDF_BYTES}-byte import limit. Choose a smaller PDF; this failed import does not change the current PDF."));
  }
  Ok(())
}

fn validate_file_id(file_id: &str) -> Result<(), String> {
  if file_id.is_empty() || file_id.len() > 256 || !file_id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-') {
    return Err("Invalid Google Drive file ID.".to_string());
  }
  Ok(())
}

fn random_string(length: usize) -> String {
  rand::thread_rng().sample_iter(&Alphanumeric).take(length).map(char::from).collect()
}

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
  app.path_resolver().app_cache_dir().map(|path| path.join("google-drive-pdfs"))
    .ok_or_else(|| "Could not locate the app's temporary PDF cache directory.".to_string())
}

fn settings_path(root: &Path) -> PathBuf { root.join("cache-settings.json") }

fn read_settings(root: &Path) -> Result<CacheSettings, String> {
  let path = settings_path(root);
  if !path.exists() { return Ok(CacheSettings { limit_bytes: DEFAULT_CACHE_LIMIT }); }
  let settings: CacheSettings = serde_json::from_slice(&fs::read(path).map_err(|error| format!("Could not read PDF cache settings: {error}"))?)
    .map_err(|error| format!("PDF cache settings are invalid: {error}"))?;
  if !(MIN_CACHE_LIMIT..=MAX_CACHE_LIMIT).contains(&settings.limit_bytes) { return Err("PDF cache settings contain an invalid limit.".to_string()); }
  Ok(settings)
}

fn write_settings(root: &Path, limit_bytes: u64) -> Result<(), String> {
  let path = settings_path(root);
  let temp = root.join("cache-settings.tmp");
  let bytes = serde_json::to_vec(&CacheSettings { limit_bytes }).map_err(|error| error.to_string())?;
  let mut file = File::create(&temp).map_err(|error| format!("Could not write PDF cache settings: {error}"))?;
  file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|error| format!("Could not finish PDF cache settings: {error}"))?;
  fs::rename(temp, path).map_err(|error| format!("Could not save PDF cache settings: {error}"))
}

fn cache_status(root: &Path, settings: &CacheSettings) -> Result<CacheStatus, String> {
  let used_bytes = cache_entries(root)?.iter().map(|entry| entry.1).sum();
  Ok(CacheStatus { limit_bytes: settings.limit_bytes, used_bytes, default_limit_bytes: DEFAULT_CACHE_LIMIT })
}

fn cleanup_partial_downloads(root: &Path) -> Result<(), String> {
  for entry in fs::read_dir(root).map_err(|error| format!("Could not inspect PDF cache: {error}"))? {
    let entry = entry.map_err(|error| format!("Could not inspect PDF cache: {error}"))?;
    if !entry.file_type().map_err(|error| error.to_string())?.is_file() { continue; }
    let path = entry.path();
    let is_partial = path.extension().is_some_and(|extension| extension == "part")
      && path.file_stem().and_then(|name| name.to_str()).is_some_and(|name| name.len() == 64 && name.bytes().all(|byte| byte.is_ascii_hexdigit()));
    if is_partial || path.file_name().is_some_and(|name| name == "cache-settings.tmp") {
      fs::remove_file(path).map_err(|error| format!("Could not remove incomplete PDF cache data: {error}"))?;
    }
  }
  Ok(())
}

fn ensure_capacity(root: &Path, limit: u64, protected: Option<&str>, additional: u64) -> Result<u64, String> {
  if additional > limit { return Err(format!("This PDF is larger than the configured cache limit ({limit} bytes).")); }
  let mut entries = cache_entries(root)?;
  let mut used: u64 = entries.iter().map(|entry| entry.1).sum();
  while used.saturating_add(additional) > limit {
    let oldest = entries.iter().enumerate()
      .filter(|(_, entry)| Some(entry.0.as_str()) != protected)
      .min_by_key(|(_, entry)| entry.2)
      .map(|(index, _)| index)
      .ok_or_else(|| "The cache limit cannot be met while the current PDF is open. Close it or raise the cache limit.".to_string())?;
    let (hash, size, _) = entries.remove(oldest);
    fs::remove_file(root.join(format!("{hash}.pdf"))).map_err(|error| format!("Could not evict an old cached PDF: {error}"))?;
    used = used.saturating_sub(size);
  }
  Ok(used)
}

fn cache_entries(root: &Path) -> Result<Vec<(String, u64, SystemTime)>, String> {
  let mut entries = Vec::new();
  let directory = fs::read_dir(root).map_err(|error| format!("Could not inspect PDF cache: {error}"))?;
  for entry in directory {
    let entry = entry.map_err(|error| format!("Could not inspect PDF cache: {error}"))?;
    if !entry.file_type().map_err(|error| error.to_string())?.is_file() { continue; }
    let path = entry.path();
    if !valid_cache_file(&path) { continue; }
    let metadata = entry.metadata().map_err(|error| format!("Could not inspect cached PDF: {error}"))?;
    entries.push((path.file_stem().unwrap().to_string_lossy().into_owned(), metadata.len(), metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH)));
  }
  Ok(entries)
}

fn valid_cache_file(path: &Path) -> bool {
  path.extension().is_some_and(|extension| extension == "pdf")
    && path.file_stem().and_then(|name| name.to_str()).is_some_and(|name| name.len() == 64 && name.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

fn is_pdf(path: &Path) -> bool {
  if !fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_file()) { return false; }
  let mut header = [0; 5];
  File::open(path).and_then(|mut file| std::io::Read::read_exact(&mut file, &mut header)).is_ok() && &header == b"%PDF-"
}

fn hash_id(file_id: &str) -> String {
  use std::fmt::Write as _;
  let mut hash = String::with_capacity(64);
  for byte in Sha256::digest(file_id.as_bytes()) { write!(&mut hash, "{byte:02x}").unwrap(); }
  hash
}

struct RemoveOnDrop(Option<PathBuf>);
impl Drop for RemoveOnDrop {
  fn drop(&mut self) { if let Some(path) = self.0.take() { let _ = fs::remove_file(path); } }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::atomic::{AtomicU64, Ordering};

  static NEXT: AtomicU64 = AtomicU64::new(0);

  fn temp_cache() -> PathBuf {
    let path = std::env::temp_dir().join(format!("board-drive-cache-test-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
    fs::create_dir_all(&path).unwrap();
    path
  }

  #[test]
  fn eviction_is_oldest_first_and_protects_the_open_pdf() {
    let root = temp_cache();
    let old = hash_id("old-file");
    let current = hash_id("current-file");
    let newest = hash_id("newest-file");
    for (hash, bytes) in [(&old, 4u8), (&current, 4u8), (&newest, 4u8)] {
      fs::write(root.join(format!("{hash}.pdf")), vec![bytes; 4]).unwrap();
    }
    let now = SystemTime::now();
    OpenOptions::new().write(true).open(root.join(format!("{old}.pdf"))).unwrap().set_modified(now - Duration::from_secs(30)).unwrap();
    OpenOptions::new().write(true).open(root.join(format!("{current}.pdf"))).unwrap().set_modified(now - Duration::from_secs(20)).unwrap();
    OpenOptions::new().write(true).open(root.join(format!("{newest}.pdf"))).unwrap().set_modified(now - Duration::from_secs(10)).unwrap();

    ensure_capacity(&root, 9, Some(&current), 1).unwrap();

    assert!(!root.join(format!("{old}.pdf")).exists());
    assert!(root.join(format!("{current}.pdf")).exists());
    assert!(root.join(format!("{newest}.pdf")).exists());
    fs::remove_dir_all(root).unwrap();
  }

  #[test]
  fn file_ids_are_validated_before_url_and_cache_use() {
    assert!(validate_file_id("abc_123-XYZ").is_ok());
    assert!(validate_file_id("../secret").is_err());
  }

  #[test]
  fn interrupted_downloads_are_removed_before_cache_use() {
    let root = temp_cache();
    let partial = root.join(format!("{}.part", hash_id("interrupted")));
    let settings_partial = root.join("cache-settings.tmp");
    fs::write(&partial, [1, 2, 3]).unwrap();
    fs::write(&settings_partial, [1, 2, 3]).unwrap();

    cleanup_partial_downloads(&root).unwrap();

    assert!(!partial.exists());
    assert!(!settings_partial.exists());
    fs::remove_dir_all(root).unwrap();
  }

  #[test]
  fn sign_out_prevents_an_inflight_sign_in_from_restoring_tokens() {
    let state = DriveState::default();
    let generation = begin_sign_in(&state).unwrap();
    invalidate_tokens(&state).unwrap();

    let result = install_tokens(&state, generation, TokenSet {
      access_token: "in-memory-only".to_string(),
      refresh_token: None,
      expires_at: Instant::now() + Duration::from_secs(60),
    });

    assert!(result.is_err());
    assert!(state.token.lock().unwrap().is_none());
  }

  #[test]
  fn source_pdf_limit_accepts_boundary_and_rejects_one_byte_over() {
    assert!(ensure_source_pdf_size(MAX_SOURCE_PDF_BYTES).is_ok());
    let error = ensure_source_pdf_size(MAX_SOURCE_PDF_BYTES + 1).unwrap_err();
    assert!(error.contains("Choose a smaller PDF"));
  }
}
