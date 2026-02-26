# BoardCanvas

BoardCanvas is a whiteboard app built with HTML/CSS/JS, wrapped as a desktop app using Tauri.

## Features

- Pen and eraser drawing
- Eraser modes: pixel eraser, stroke eraser
- Clear all
- Fullscreen toggle
- Overlay mode (Windows desktop runtime only, for now)
- Pen color and board background color
- Pen presets (4 fixed slots)
- Dockable toolbar (top, bottom, left, right)
- Floating mini toolbar mode
- Last-used settings persisted in localStorage
- PDF background loading with page navigation (`Left` / `Right` arrow)

## Web Run (no desktop wrapper)

Open `index.html` directly, or run a local server:

```bash
python -m http.server 5500
```

Then open `http://localhost:5500`.

Live web app (GitHub Pages):

- https://rightway-p.github.io/BoardCanvas/

## Desktop Wrapper (Windows now, Linux prepared)

This repository includes a Tauri wrapper under `src-tauri`.

### 1) Prerequisites

Windows:

- Node.js LTS
- Rust toolchain (`rustup`)
- WebView2 runtime (usually already installed on modern Windows)

Linux (Ubuntu/Debian):

- Node.js LTS
- Rust toolchain (`rustup`)
- System libraries:

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.0-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
```

### 2) Install dependencies

```bash
npm install
```

### 3) Run desktop app (dev)

```bash
npm run desktop:dev
```

### 4) Build desktop binary

```bash
npm run desktop:build
```

This command automatically generates `dist/` from:

- `index.html`
- `styles.css`
- `app.js`

Build output (per OS):

- Windows: `src-tauri/target/release/boardcanvas.exe`
- Linux: `src-tauri/target/release/boardcanvas`

## Cross-platform Note

One source codebase supports both OSes, but binaries are built per OS.

- Windows binary must be built on Windows.
- Linux binary must be built on Linux.
- Overlay mode is currently enabled only on Windows desktop runtime.

## GitHub Actions: Auto Build

Workflow file:

- `.github/workflows/desktop-build.yml`

Triggers:

- Push to `main`
- Push to `dev`
- Manual run (`workflow_dispatch`)

Artifacts:

- Push runs: `boardcanvas-windows`
- Manual run with `build_linux=true`: `boardcanvas-windows`, `boardcanvas-linux`

## Project structure

- `index.html`: UI markup
- `styles.css`: styles and layout
- `app.js`: drawing logic and state (4771 lines, being modularized)
- `js/`: Modular code (new)
  - `runtime.js`: Platform detection, Tauri communication, logging
  - `overlay.js`: Overlay mode control with built-in diagnostics
  - `diagnostics.js`: Developer diagnostic tools (exposed as `window.Diagnostics`)
  - `init.js`: Module integration bridge
- `src-tauri/`: desktop wrapper
  - `src/main.rs`: Rust backend with diagnostic commands
- `.github/workflows/desktop-build.yml`: CI build pipeline
- `MODULES.md`: Module architecture documentation
- `DIAGNOSTICS_GUIDE.md`: Troubleshooting guide for overlay issues

## Modular Architecture (New)

The codebase is being refactored into modules for better maintainability. See [MODULES.md](MODULES.md) for details.

### Quick module overview:

```javascript
// Runtime & logging
import { queueRuntimeLog, detectRuntimePlatform } from './js/runtime.js';

// Overlay with auto-verification
import { setDesktopWebviewBackgroundAlpha, diagnoseOverlayState } from './js/overlay.js';

// Developer diagnostics (also available as window.Diagnostics)
import { Diagnostics } from './js/diagnostics.js';
```

### Diagnostic Tools

For debugging overlay transparency and mouse mode issues, use the built-in diagnostics:

```javascript
// In browser console (F12)
await Diagnostics.runFullDiagnostics();
await Diagnostics.verifyOverlayState();
await Diagnostics.verifyMouseModeState(true);
```

See [DIAGNOSTICS_GUIDE.md](DIAGNOSTICS_GUIDE.md) for complete troubleshooting guide.

## Known Issues

See GitHub Issues for current bugs. Main issues:

1. **Overlay visual bug**: Window not transparent despite successful API calls
   - **Status**: 🔴 Critical bug found and fixed (2026-02-25)
   - **Fix**: `set_window_overlay_surface` LAYERED removal logic corrected
   - Diagnosis: `Diagnostics.verifyOverlayState()`
   - See [BUGFIX_TRACKER.md](BUGFIX_TRACKER.md) for fix details

2. **Overlay mouse mode interaction bug**: Clicks pass through toolbar
   - **Status**: 🟡 Partial solution (recovery zone added)
   - **Plan**: WM_NCHITTEST implementation for better handling
   - Diagnosis: `Diagnostics.verifyMouseModeState(true)`
   - See [BUGFIX_TRACKER.md](BUGFIX_TRACKER.md) for next steps

## Documentation

### 🧭 Start Here
- � **[DOCS_INDEX.md](DOCS_INDEX.md)** - Complete document index (recommended)
  - 📊 All documents at a glance
  - 🎯 Role-based essential docs
  - ⚡ Quick find by situation
  - 🔄 Daily workflow patterns
- �🗺️ **[NAVIGATION.md](NAVIGATION.md)** - Complete document navigation guide
  - 📊 Visual document structure
  - 🎯 Scenario-based paths (5 scenarios)
  - 🔍 Quick search by keyword
  - 📱 Role-based learning paths
- ⚡ **[NAVIGATION_QUICK.md](NAVIGATION_QUICK.md)** - Quick navigation reference (1 page)

### 📚 Troubleshooting Documents

- 📋 **[BUGFIX_TRACKER.md](BUGFIX_TRACKER.md)** - Fix tracking & prevention guide
  - ✅ Applied fixes with test checklists
  - ❌ Failed approaches (avoid repetition)
  - 🔄 Planned improvements by priority
  - 📊 Testing procedures

- 🔍 **[BUG_ANALYSIS.md](BUG_ANALYSIS.md)** - Detailed bug analysis
  - Root cause analysis
  - Technical solutions
  - Code examples

- 🛠️ **[DIAGNOSTICS_GUIDE.md](DIAGNOSTICS_GUIDE.md)** - User troubleshooting guide
  - Step-by-step diagnosis
  - Recovery procedures
  - Console commands

### 🚀 Quick Access
- ⚡ **[QUICKREF.md](QUICKREF.md)** - Build and test commands
- 📋 **[TODO.md](TODO.md)** - Current work items
- 🏗️ **[MODULES.md](MODULES.md)** - Code architecture
