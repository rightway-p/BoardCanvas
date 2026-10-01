# Native integrations

## Google Drive PDFs

The desktop OAuth client ID is a public deployment setting compiled into the app. In PowerShell, set `BOARD_GOOGLE_OAUTH_CLIENT_ID` to a Google OAuth client whose application type is **Desktop app**, then run the desktop build from the same shell. If it is missing, sign-in reports that exact configuration step; the app does not simulate a connection. Enable the Google Drive API and finish the OAuth consent setup for the requested `drive.readonly` scope before distributing the app.

Google sign-in opens the system browser, listens on a random `127.0.0.1` port for at most five minutes, validates OAuth `state`, and exchanges the code with PKCE. Access and refresh tokens live only in process memory and are cleared by `drive_sign_out` or app exit. A restart requires another sign-in.

The Rust IPC contract is:

| Command | Arguments | Result |
| --- | --- | --- |
| `drive_authenticate` | none | `{ connected: true }` |
| `drive_list_pdfs` | `{ pageToken?: string }` | `{ files, nextPageToken? }` |
| `drive_download_pdf` | `{ fileId }` | `{ fileId, name, size, pdfBase64 }` |
| `drive_set_active_pdf` | `{ fileId: string \| null }` | `null` |
| `drive_get_cache_status` | none | `{ limitBytes, usedBytes, defaultLimitBytes }` |
| `drive_set_cache_limit` | `{ bytes }` | `{ limitBytes, usedBytes, defaultLimitBytes }` |
| `drive_sign_out` | none | `null` |
| `save_document_file` | `{ suggestedName, contentsBase64, kind: "work" | "pdf" }` | `{ saved, path? }` |

The PDF cache lives under Tauri's app cache directory in `google-drive-pdfs`. It defaults to 2 GiB; the stored aggregate cache limit can be changed from 64 MiB to 16 GiB. Each source PDF also has a fixed 256 MiB engineering ceiling, independent of that cache setting. Metadata and response lengths are checked when available, and actual streamed or cached file size is checked before writing or reading/base64 conversion. Oversized imports fail with an explicit message and are never silently truncated. Oldest unused cached PDFs are removed first. The frontend should pin a PDF only after importing it successfully and should unpin the previous PDF only after the replacement succeeds. The download response includes base64 PDF data for the existing renderer, so importing a large file temporarily uses additional memory.

Work and PDF exports use the native save dialog in desktop builds. The decoded IPC payload is capped at 512 MiB; the encoded length is rejected before decoding, and the streaming decoder enforces the same decoded-byte ceiling. This accommodates a 256 MiB source PDF embedded in a work file with base64 overhead. The selected destination must end in `.boardwork` or `.pdf` according to the requested kind. Cancel returns `{ saved: false }`; success is reported only after the temporary file is completely written and moved atomically to the chosen path. A failed write keeps any existing destination intact. Browser builds must not treat a download request as a verified save or continue a destructive replace operation.

## Desktop updater

Updater support remains disabled in `tauri.conf.json`. The read-only `get_updater_status` command reports `{ configured: false }` until the config has `active: true`, a real HTTPS release endpoint, and a non-placeholder Minisign public key. Tauri 1 requires the Cargo `updater` feature to match `active: true`, so both must be enabled together after those deployment values exist. Tauri validates the key when an update is checked and needs the matching private signing key to build signed artifacts. None of those values were provided, so the app does not advertise or simulate updates. Once the publisher supplies them, keep installation behind the user's choice and include the updater bundle target in release builds. Do not place the private key or its password in the repository.

References: [Google OAuth for desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app), [Google Drive files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list), [Tauri 1 updater](https://v1.tauri.app/v1/guides/distribution/updater/).
