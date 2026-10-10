# Board 2.0.1 implementation scope

This change implements the agreed Board v2 work under the provisional version 2.0.1. It does not establish a permanent versioning policy.

## Acceptance criteria

- A narrow, uniform side toolbar without scrolling; popups remain inside the screen in top, left and right layouts. The drawing viewport excludes toolbar space.
- A single-touch pen/pan toggle. Drag pans; holding within a configurable tolerance for 3 seconds starts vertical anchored zoom with the same contact. Additional touches must not replace the active pointer.
- Current pen editing remains separate from palette presets. Tap applies a preset; a separate 3-second hold edits its color and width.
- PDF and ink share coordinates. Space outside the PDF remains writable. Fit restores the complete PDF or the blank board's original position and default scale. Each page retains its view.
- Blank boards can be inserted among PDF pages. Only blank boards can be removed, and the final document page is protected. Page navigation is not history. Page-local ink history and document structure history are separate; structural restoration retains the latest ink and view.
- Existing temporary recovery continues; recovered work starts with empty histories. Manual work files contain PDF bytes, ink and inserted boards. Replacement is transactional and offers save/discard/cancel for changed work.
- Export options start unchecked: outside-PDF ink and inserted blank pages. A blank-only document remains exportable. Export does not depend on the current viewport and never changes the source PDF.
- Configurable remote input mappings allow duplicates with a hint. Registration and a small 1–5 page test are isolated from the real document. Repeated keydown does not advance multiple pages.
- Developer controls are opened by seven taps on the version. Trial tuning is reversible until saved, and diagnostic overlays never enter saved work or exported PDF.
- Update availability is checked once at launch and manually from the menu. Installation is user initiated, and recovery persistence must succeed before an operation that can terminate the app.
- Google Drive imports PDFs through desktop authentication and a bounded temporary cache. The default limit is 2 GiB and can be changed. Eviction targets old unused downloads and protects active data.

## External verification conditions

Google OAuth requires a configured desktop client and consent setup. Signed application updates require a real release endpoint, signing configuration and published artifacts. Missing deployment configuration must be reported accurately, never simulated as a successful connection or update.

## Review and scope boundaries

Independent Codex and Antigravity reviews are both required. Record the reviewer, executor, actionable findings, false positives, fixes and unresolved blockers. Real bezel-touch hardware testing remains distinct from browser input tests.

Future ESP32 pen hardware is excluded. Gesture tuning and final eraser return behavior remain practical testing decisions. The original checkout and its unfinished mock are preserved; the mock is not the production implementation or evidence of its correctness.
