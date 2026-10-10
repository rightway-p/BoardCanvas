# Board UI design tokens

These values are implemented as shared visual tokens for the settings panel, remote mapping and compact toolbar. They preserve the existing pen blue and pan amber colors; spacing, sizing and surfaces remain adjustable design choices.

| Token | Value | Used for |
|---|---:|---|
| `--canvas` | `#ececec` | Board workspace background |
| `--surface` / `--surface-soft` | `#fff` / `#f5f5f5` | Dialog, toolbar and quiet surfaces |
| `--text` / `--muted` | `#1e1e1e` / `#68717d` | Main and supporting text |
| `--line` | `#d0d0d0` | Dividers and light borders |
| `--pen-blue` / `--pan-amber` | `#2f6ee4` / `#b57918` | Pen and pan states |
| `--type-label` / `--type-body` / `--type-title` | `12 / 14 / 24px` | Supporting text, controls and dialog heading |
| `--space-1`…`--space-5` | `4 / 8 / 12 / 16 / 24px` | Repeated spacing scale |
| `--radius-card` / `--radius-panel` | `10 / 16px` | Buttons and larger panels |
| `--shadow-settings` | `0 12px 40px #17202d24` | Settings surface |
| `--focus-ring` | `0 0 0 3px #2f6ee455` | Visible keyboard focus |
| `--toolbar-control-size` | `32px` | Compact toolbar buttons and pen controls |
| `--settings-control-size` | `44px` | Settings navigation and touch controls |

The toolbar keeps the existing pen, eraser, clear, undo, redo, current color, current width, four presets and settings entry. The Settings surface is centered in the viewport, keeps its left category rail on wider screens and stacks the rail above content responsively. The Screen category groups background, embedded touch controls/trial/calibration, and screen controls as cards; the trial remains local to Settings. Remote actions align names, key badges and controls; page navigation is unavailable while Settings is open.

Remote registrations can be removed per action. Clearing one row leaves other actions assigned to the same key intact. The action list and page preview stack at narrower widths, while Settings cards collapse to one column when space is limited. Focus indicators, button names and text labels keep controls usable without color alone.
