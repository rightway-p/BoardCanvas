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
- `app.js`: drawing logic and state
- `src-tauri/`: desktop wrapper
- `.github/workflows/desktop-build.yml`: CI build pipeline
