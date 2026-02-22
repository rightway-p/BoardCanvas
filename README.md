# BoardCanvas

Web-based whiteboard app with dockable toolbar and lightweight floating mode.

## Features

- Pen and eraser drawing
- Eraser modes:
- Pixel eraser
- Stroke eraser
- Clear all
- Fullscreen toggle
- Pen color picker
- Board background color picker
- Pen presets (fixed 4 slots)
- Dockable toolbar: top, bottom, left, right
- Floating mini toolbar:
- Drop the drag handle near screen center to switch to floating
- Shows only core controls
- Real-time drag movement while floating
- Dock preview guide (dashed outline) while dragging
- Last-used settings persisted in localStorage

## Toolbar behavior

- Drag toolbar handle toward an edge to dock.
- Drag toolbar handle to center area to use floating mode.
- In floating mode, only these controls are shown:
- Pen / Eraser
- Clear all
- Pen color presets
- Fullscreen

## Presets

- Pen preset:
- Click to apply
- Right-click or Shift+Click to save current pen state
- Board color preset:
- Click to apply
- Right-click or Shift+Click to save current board color

## Run locally

Open `index.html` directly, or use a local server:

```bash
python -m http.server 5500
```

Then open `http://localhost:5500`.

## Project files

- `index.html`: UI markup
- `styles.css`: layout and visual styles
- `app.js`: drawing logic, toolbar mode/state, persistence

