# Screen pen toolbar browser validation

Validation ran against the checkout source in a headless Chromium 1223 browser using an isolated Playwright context and a static server bound to `127.0.0.1`. The six and twenty test palettes were seeded in browser-local storage only. No user settings, profile, or native Board process was used.

Run date: 2026-10-18. Validation executor: `/root/browser_validation` (requested model `gpt-6-luna`, high reasoning; actual model ID was not exposed).

Run command from the checkout root in PowerShell:

```powershell
$env:PLAYWRIGHT_MODULE='C:\Users\pjd01\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright'
$env:PLAYWRIGHT_EXECUTABLE_PATH='C:\Users\pjd01\AppData\Local\ms-playwright\chromium_headless_shell-1223\chrome-headless-shell-win64\chrome-headless-shell.exe'
node scripts/check-screen-pen-toolbar.cjs
```

## Layout

The left and right placements passed at CSS viewport 1920×1080 and 1920×1048 (DPR 1), and 1536×864 (DPR 1.25). Each had six visible presets, each 28×28 CSS pixels with 4-pixel gaps. Fit, navigation lock, pen, eraser, clear, undo/redo, settings, and fullscreen controls were visible; toolbar sibling overlaps, clipping/overflow, and document scrolling were absent.

The 1280×720 (DPR 1.5) compact case passed with six presets at 28×28 CSS pixels and 2-pixel gaps. Placement transitions in one browser page passed through left, top, right, bottom, floating, and 1920×1048 left without stale palette layout or page scrolling. Twenty-preset overflow remained reachable in top/left/right/floating and at 1280×600 left/floating; the final extra preset applied while navigation lock stayed on.

The viewports represent CSS sizes. The 1920×1048 case reserves 32 pixels for a title bar. Headless Chromium does not validate Windows OS display scaling or the native Tauri window frame; 1536×864@1.25 and 1280×720@1.5 are browser-emulated scale-factor smoke cases.

## Input and rendering

Trusted Playwright mouse pointer input passed locked pan in single and multi modes without creating ink. CDP pen-pointer pan passed under lock. Single- and multi-mode locked touch pan and the unlocked automatic two-touch zoom passed through Chromium touch emulation. The existing hold-to-zoom timing remained 2000 ms; a held locked drag changed camera scale without creating ink. Lock state persisted through fit, page insertion, a remote next-page action, and a preset click. Unlocking from eraser restored pen mode.

At DPR 1 and 2, pen widths 1 and 4 were exercised at camera scales 0.5, 1, 2, and 6. Active and committed stroke widths matched the expected CSS thickness, previously committed width remained unchanged after subsequent zoom, opacity 0.5 was preserved, a tap committed a dot, and the pixel eraser changed rendered ink.

Pointer cancellation and blur cleared the active input IDs in browser-injected event checks, and locked input continued afterward. For explicit `releasePointerCapture`, the runner first observed a trusted `gotpointercapture` for pointer 1, then released capture while pressed and moved outside the canvas. Chromium delivered a trusted `lostpointercapture`; the app cleared both active IDs, kept lock enabled, and accepted the next trusted pan gesture.

Run result: 8/8 geometry cases passed; placement-transition and 20-preset smoke suites passed; 11/11 lock interaction checks passed; stroke and touch suites passed. The final run exited with status 0. The runner requires a trusted `gotpointercapture` before requesting release and a trusted `lostpointercapture` before pointerup, so pending capture state alone cannot pass the recovery case.

## Captures and evidence

- Full viewport: `tmp/screen-pen-toolbar/right-1920x1080-dpr1.png`
- Right toolbar element: `tmp/screen-pen-toolbar/right-1920x1080-dpr1-toolbar.png`
- Left toolbar element: `tmp/screen-pen-toolbar/left-1920x1080-dpr1-toolbar.png`
- Per-case geometry JSON, transition results, palette smoke, and interaction/stroke/touch results are alongside the captures in `tmp/screen-pen-toolbar/`.

Validation runner: `scripts/check-screen-pen-toolbar.cjs`. It accepts `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_EXECUTABLE_PATH` to select an already-installed Playwright runtime/browser without adding dependencies.
