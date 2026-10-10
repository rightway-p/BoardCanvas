# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

BoardCanvas — a whiteboard/annotation app. The source is vanilla HTML/CSS/JS (no bundler, no framework). It runs in two modes:

- **Web**: open `index.html` directly or serve the root (`python -m http.server 5500`). Live at https://rightway-p.github.io/BoardCanvas/.
- **Desktop**: wrapped by Tauri 1.6 (`src-tauri/`). Windows is the primary target; Linux is prepared but overlay features are Windows-only.

## Commands

```bash
npm install                 # installs Tauri CLI + PDF libs (pdfjs-dist, pdf-lib)
npm run desktop:dev         # tauri dev — auto-runs prepare-dist.js via tauri.conf.json
npm run desktop:build       # tauri build (release binary)
npm run web:build           # just runs scripts/prepare-dist.js to populate dist/
npm run ical:server         # node scripts/ical-server.js (unrelated helper)

# Rust-only iterations (from src-tauri/)
cargo build --release
cargo run
```

There are **no tests and no linter** configured. Binaries are OS-bound (Windows .exe must be built on Windows; Linux build on Linux). CI: `.github/workflows/desktop-build.yml` triggers on push to `main`/`dev`.

## Architecture

### Two parallel JS module systems — do not confuse them

1. **Sequential classic scripts** (the actual app). `index.html` loads these via plain `<script>` tags in a fixed order; they share globals on `window`. The same list is duplicated in `app.js` (a fallback bootstrap used when the HTML is served without the normal script tags, e.g. direct file open):

   ```
   js/globals.js → js/runtime-overlay.js → js/session-pdf-toolbar.js →
   js/presets-utils.js → js/presets-ui.js → js/strokes-core.js →
   js/strokes-history.js → js/stroke-eraser.js → js/render-doc-draw.js →
   js/events-init.js
   ```

   **Load order matters** — later files reference globals defined earlier. Adding a new chunk requires updating both `index.html` and `app.js`'s `APP_CHUNK_SCRIPTS` array.

2. **ES6 modules** (`js/runtime.js`, `js/overlay.js`, `js/diagnostics.js`, `js/init.js`) — a newer, parallel layer intended for diagnostics. Loaded via `type="module"` and wired up in `js/init.js`, which re-exposes them on `window` (`window.Diagnostics`, `window.Overlay`, `window.Runtime`) for the classic scripts to call. These modules are **not required** for the app to function; they are the diagnostic/overlay-verification path.

### Build pipeline

`scripts/prepare-dist.js` is the only build step on the JS side. It wipes `dist/`, then copies:
- top-level `index.html`, `styles.css`, `app.js`
- the full `js/` directory
- vendored PDF libraries from `node_modules/` into `dist/vendor/` (pdfjs-dist legacy + pdf-lib)

Tauri's `tauri.conf.json` points `devPath`/`distDir` at `../dist` and calls this script as `beforeDevCommand`/`beforeBuildCommand`, so `tauri dev`/`tauri build` regenerate `dist/` automatically. `withGlobalTauri: true` makes the Tauri JS API available as `window.__TAURI__`.

### Rust backend

`src-tauri/src/main.rs` exposes Tauri commands invoked from JS via `window.__TAURI__.invoke(name, args)`. Current commands (registered in the `invoke_handler!` macro near the bottom):

```
get_runtime_log_path, append_runtime_log,
get_global_cursor_position, get_window_cursor_position,
set_webview_background_alpha, set_window_overlay_surface,
verify_window_styles, get_window_rect,
set_window_click_through, verify_webview_background_alpha
```

Most of the interesting logic is Windows-specific (`#[cfg(target_os = "windows")]`) — it manipulates `WS_EX_LAYERED` / `WS_EX_TRANSPARENT`, DWM, and WebView2 background color to implement transparent overlay mode. Non-Windows builds return an error for those commands.

Dependencies of note in `Cargo.toml`: `tauri 1.6` with `window-all`, `windows-sys 0.61`, `webview2-com 0.19`, and a **patched `wry`** pointed at `vendor/wry-0.24.11` (`[patch.crates-io]` at the bottom). The patch fixes a Linux CI build; don't remove it without understanding the trait-import fix referenced in commit `4f1064f`.

### Runtime logging

Rust writes to `%TEMP%/boardcanvas-runtime.log` via `append_runtime_log`. JS queues log lines through `js/runtime.js::queueRuntimeLog` and flushes them via the Tauri command. When debugging, this file is usually the best source of ground truth.

### Diagnostics (browser console)

When the desktop app is running, `window.Diagnostics` is available for investigating overlay issues:

```javascript
await Diagnostics.runFullDiagnostics()
await Diagnostics.verifyOverlayState()
await Diagnostics.verifyMouseModeState(true)
```

See `DIAGNOSTICS_GUIDE.md` and `MODULES.md` for specifics.

## Known active bugs

Tracked in `BUGFIX_TRACKER.md` (check this **before** attempting overlay-related fixes — it lists approaches already tried and what failed):

1. Overlay visual bug — window not transparent despite successful API calls.
2. Overlay mouse-mode interaction bug — clicks pass through the toolbar; WM_NCHITTEST implementation is the planned next step.

## Conventions

- The Korean-language docs (`MODULES.md`, `DOCS_INDEX.md`, `BUGFIX_TRACKER.md`, `BUG_ANALYSIS.md`, `QUICKREF.md`, `TODO.md`, `NAVIGATION*.md`) are the living design notes. `README.md` points into them.
- `app.js` is currently a ~40-line bootstrap — do not treat it as the "main app file" despite historical references to it being 4771 lines. The logic lives in `js/*.js` chunks.
- `dist/` is a build artifact — never edit files there; edit the sources and let `prepare-dist.js` regenerate.
