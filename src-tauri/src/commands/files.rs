use base64::read::DecoderReader;
use base64::engine::general_purpose::STANDARD;
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use tauri::api::dialog::blocking::FileDialogBuilder;

const MAX_SAVED_DOCUMENT_BYTES: u64 = 512 * 1024 * 1024;
const MAX_ENCODED_DOCUMENT_BYTES: usize = ((MAX_SAVED_DOCUMENT_BYTES as usize + 2) / 3) * 4;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDocumentResult {
  saved: bool,
  path: Option<String>,
}

#[tauri::command]
pub async fn save_document_file(suggested_name: String, contents_base64: String, kind: String) -> Result<SaveDocumentResult, String> {
  ensure_encoded_length(contents_base64.len())?;
  let extension = match kind.as_str() {
    "work" => "boardwork",
    "pdf" => "pdf",
    _ => return Err("Choose either a board work file or a PDF export.".to_string()),
  };
  let suggested_name = suggested_file_name(&suggested_name, extension);
  let selected = FileDialogBuilder::new()
    .set_file_name(&suggested_name)
    .add_filter(if extension == "pdf" { "PDF document" } else { "Board work" }, &[extension])
    .save_file();
  let Some(path) = selected else { return Ok(SaveDocumentResult { saved: false, path: None }); };
  if !has_extension(&path, extension) {
    return Err(format!("Choose a file ending in .{extension} to save this document."));
  }

  let result_path = path.to_string_lossy().into_owned();
  tauri::async_runtime::spawn_blocking(move || write_base64_atomically(&path, &contents_base64, kind.as_str() == "pdf"))
    .await
    .map_err(|error| format!("Could not finish saving the document: {error}"))??;
  Ok(SaveDocumentResult { saved: true, path: Some(result_path) })
}

fn suggested_file_name(name: &str, extension: &str) -> String {
  let leaf = name.rsplit(['/', '\\']).next().unwrap_or_default();
  let stem = Path::new(leaf).file_stem().and_then(|value| value.to_str()).unwrap_or_default();
  let clean: String = stem.chars().map(|ch| {
    if ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') { '_' } else { ch }
  }).take(120).collect();
  let clean = clean.trim_matches([' ', '.']);
  let fallback = if extension == "pdf" { "board-export" } else { "board-work" };
  format!("{}.{}", if clean.is_empty() { fallback } else { clean }, extension)
}

fn has_extension(path: &Path, extension: &str) -> bool {
  path.extension().and_then(|value| value.to_str()).is_some_and(|value| value.eq_ignore_ascii_case(extension))
}

fn temporary_path(path: &Path) -> Result<PathBuf, String> {
  let name = path.file_name().and_then(|value| value.to_str()).ok_or_else(|| "The selected save path has an invalid file name.".to_string())?;
  for _ in 0..10 {
    let nonce: u64 = rand::random();
    let candidate = path.with_file_name(format!(".{name}.{nonce:016x}.tmp"));
    if !candidate.exists() { return Ok(candidate); }
  }
  Err("Could not allocate a temporary file beside the selected destination.".to_string())
}

fn write_base64_atomically(destination: &Path, encoded: &str, is_pdf: bool) -> Result<(), String> {
  let temporary = temporary_path(destination)?;
  let file = OpenOptions::new().write(true).create_new(true).open(&temporary)
    .map_err(|error| format!("Could not create a temporary save file: {error}"))?;
  let result = (|| -> Result<(), String> {
    let mut writer = io::BufWriter::new(file);
    let mut decoder = DecoderReader::new(encoded.as_bytes(), &STANDARD);
    let mut buffer = [0u8; 64 * 1024];
    let mut first_bytes = Vec::with_capacity(5);
    let mut first_chunk = true;
    let mut written = 0u64;
    loop {
      let count = decoder.read(&mut buffer).map_err(|error| format!("The document data is not valid base64: {error}"))?;
      if count == 0 { break; }
      let next = written.checked_add(count as u64).ok_or_else(|| "Document size overflow".to_string())?;
      ensure_decoded_length(next)?;
      if first_chunk {
        first_bytes.extend_from_slice(&buffer[..count.min(5)]);
        first_chunk = false;
        if is_pdf && !first_bytes.starts_with(b"%PDF-") {
          return Err("The selected PDF export data is invalid.".to_string());
        }
      }
      writer.write_all(&buffer[..count]).map_err(|error| format!("Could not write the selected document: {error}"))?;
      written = next;
    }
    if is_pdf && first_bytes.len() < 5 { return Err("The selected PDF export data is incomplete.".to_string()); }
    writer.flush().map_err(|error| format!("Could not finish writing the document: {error}"))?;
    writer.get_ref().sync_all().map_err(|error| format!("Could not flush the document to disk: {error}"))?;
    drop(writer);
    replace_selected_file(&temporary, destination).map_err(|error| format!("Could not save to the selected path: {error}"))?;
    Ok(())
  })();
  if result.is_err() { let _ = fs::remove_file(&temporary); }
  result
}

fn ensure_encoded_length(size: usize) -> Result<(), String> {
  if size > MAX_ENCODED_DOCUMENT_BYTES {
    return Err(format!("This document exceeds the {MAX_SAVED_DOCUMENT_BYTES}-byte save limit. Reduce its size before saving."));
  }
  Ok(())
}

fn ensure_decoded_length(size: u64) -> Result<(), String> {
  if size > MAX_SAVED_DOCUMENT_BYTES {
    return Err(format!("This document exceeds the {MAX_SAVED_DOCUMENT_BYTES}-byte save limit. Reduce its size before saving."));
  }
  Ok(())
}

#[cfg(windows)]
fn replace_selected_file(source: &Path, destination: &Path) -> io::Result<()> {
  use std::os::windows::ffi::OsStrExt;
  use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH};
  let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
  let destination: Vec<u16> = destination.as_os_str().encode_wide().chain(Some(0)).collect();
  let result = unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) };
  if result == 0 { Err(io::Error::last_os_error()) } else { Ok(()) }
}

#[cfg(not(windows))]
fn replace_selected_file(source: &Path, destination: &Path) -> io::Result<()> {
  fs::rename(source, destination)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn suggested_name_is_a_safe_leaf_with_the_required_extension() {
    assert_eq!(suggested_file_name("C:\\private\\My * Board.pdf", "boardwork"), "My _ Board.boardwork");
    assert_eq!(suggested_file_name("...", "pdf"), "board-export.pdf");
  }

  #[test]
  fn only_the_requested_file_kind_extension_is_accepted() {
    assert!(has_extension(Path::new("C:/Exports/board.BOARDWORK"), "boardwork"));
    assert!(!has_extension(Path::new("C:/Exports/board.pdf"), "boardwork"));
  }

  #[test]
  fn save_size_guards_accept_boundaries_and_reject_oversize_lengths() {
    assert!(ensure_encoded_length(MAX_ENCODED_DOCUMENT_BYTES).is_ok());
    assert!(ensure_encoded_length(MAX_ENCODED_DOCUMENT_BYTES + 1).is_err());
    assert!(ensure_decoded_length(MAX_SAVED_DOCUMENT_BYTES).is_ok());
    assert!(ensure_decoded_length(MAX_SAVED_DOCUMENT_BYTES + 1).is_err());
  }

  #[test]
  fn invalid_pdf_data_does_not_replace_an_existing_file() {
    let directory = std::env::temp_dir().join(format!("board-save-test-{:016x}", rand::random::<u64>()));
    fs::create_dir_all(&directory).unwrap();
    let path = directory.join("saved.pdf");
    fs::write(&path, b"original").unwrap();
    let encoded = base64::Engine::encode(&STANDARD, b"not a PDF");
    assert!(write_base64_atomically(&path, &encoded, true).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"original");
    let _ = fs::remove_dir_all(directory);
  }

  #[test]
  fn valid_pdf_bytes_are_written_to_the_selected_path() {
    let directory = std::env::temp_dir().join(format!("board-save-test-{:016x}", rand::random::<u64>()));
    fs::create_dir_all(&directory).unwrap();
    let path = directory.join("saved.pdf");
    let bytes = b"%PDF-1.7\nfixture";
    let encoded = base64::Engine::encode(&STANDARD, bytes);
    write_base64_atomically(&path, &encoded, true).unwrap();
    assert_eq!(fs::read(&path).unwrap(), bytes);
    let _ = fs::remove_dir_all(directory);
  }
}
