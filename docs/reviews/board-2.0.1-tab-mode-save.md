# Board 2.0.1 developer tab mode save and blank export review

Date: 2026-10-05. Baseline: `265ba4452f7f3e4fc9f50c902a706ee6cc09f929`, current local uncommitted diff. Scope: selected developer settings tab commits the actual single/multi board mode only on Save; open starts from the actual mode; Cancel/close retains it. Also the canonical requirement that exported blank pages always preserve outside ink, independently of the PDF outside-ink checkbox. Implementation: `/root/tab_mode_save`. Reviewer did not edit implementation files.

## Independent reviewer and execution evidence

- Codex/Ponytail executor: independent subagent `/root/calibration_review`, separate from the implementer. Inherited parent runtime identifies itself as GPT-6; exact model ID is not exposed and is not inferred. High inherited reasoning effort. Source diff, actual functions and regression results reviewed.
- Antigravity executor: the same independent reviewer subagent invoking the official installed `agy.exe`, model `gemini-3.1-pro-high`, high effort, plan mode, source text supplied through stdin stream-json. Init event confirmed the actual model. Session `46969ac2-cd32-49a5-92fb-22f8063eddea`: SUCCESS, exit 0, substantive response, 94.3011221 seconds. No tool steps, file edits, approval requests or permission bypasses.
- AGY snapshot: 32584 characters containing the scoped diff, top-level initialization, open/save/close/mode setter, export source and relevant tests. Artifacts: `%TEMP%/board-tab-mode-save-agy-snapshot.txt`, `board-tab-mode-save-agy-review.jsonl`, `board-tab-mode-save-agy-stderr.txt`.
- The background-fill correction was made after AGY's response and is its exact recommended one-line change. Codex independently rechecked the final source, translated fill coverage regression and full tests. The AGY snapshot is not presented as already containing that later fix.

## Actionable finding and resolution

`js/board-export.js:49`: expanding a blank page while creating an opaque canvas left its outside area without the page background. Filling only `(0,0,frame.width,frame.height)` after the bounds translation could leave a black border and hide black outside ink. Codex and AGY independently identified the same defect. The implementer changed the fill to `(bounds.minX,bounds.minY,width,height)`, which maps to the entire backing canvas after `translate(-bounds.minX,-bounds.minY)`. The mixed PDF/blank regression checks the white fill extends beyond the original frame, as well as the blank output dimensions. **Fixed and independently rechecked.**

`js/board-export.js:136`: blank-page bounds now always include outside ink. Original PDF pages retain the existing checkbox-controlled crop behavior; blank-page inclusion in a mixed export remains governed by its existing option. The existing bounds and render helpers are reused, preserving pen radius and coordinate offsets. No new export abstraction or dependency.

## False positives and disposition

- AGY noted `finishActiveBoardInput()` may run twice when Save changes the actual mode: once before tuning values change and once in the reused mode setter. Inspection shows the first call clears the active gesture/pointer states, so the second is idle. The first call also remains necessary when saving tuning without changing mode; the setter must retain its own cleanup for the Screen selector caller. No confirmed defect or useful simplification; retained.
- No TDZ or function-order defect: top-level `developerSettingsTab` is initialized to a literal, and actual `boardInteractionMode` is read when opening the modal after initialization. The full source declaration evaluation passed.
- Larger expanded exports can still hit existing safe canvas size limits and fail visibly. This change preserves ink within those limits rather than bypassing the guard or silently cropping it. No data-loss requirement is waived.

## Validation and final state

- Independent `npm test`: **51/51 passed** after the final background correction. JavaScript syntax checks and `git diff --check` passed; line-ending notices only. The coordinator/implementer report current web build passed.
- Independent VM evaluation loaded the full current UI source with only the final UI bootstrap invocation omitted. It exercised actual `openDeveloperSettings`, `saveDeveloperSettings`, `discardDeveloperSettings`, `closeDeveloperSettings` and `setBoardInteractionMode`: switching a tab leaves the actual mode unchanged; Save persists the selected mode and synchronizes the Screen selector in both directions; Cancel preserves the prior actual/persisted mode; reopen selects that actual mode. Rendering/input cleanup were stubbed to isolate these state transitions. No initialization TDZ occurred.
- The mixed PDF/blank test exports with the default outside-ink option omitted/unchecked: the PDF keeps its source 612x792 dimensions, while the blank retains negative-coordinate ink and expands. The canvas mock also records the configured background color and fill coordinates beyond the saved frame. This is bounds/fill coverage verification, not a claim that real canvas pixels or a physical touch device were observed.
- Coordinator live-browser verification separately confirmed multi tab Save -> actual Screen multi, reopen selects multi, single tab Cancel -> stays multi, single tab Save -> actual Screen single. Original single mode restored. No console errors reported.
- Independently viewed coordinator screenshot `C:/Users/pjd01/.codex/tmp/board-tab-mode-save-final.png`: save/cancel guidance is visible and footer actions remain accessible with the existing scroll region. Actual touch hardware and native packaged export pixel rendering remain outside this scoped check.
- Ponytail result: **Lean already. Ship.** Existing mode setter, bounds/canvas helpers and test infrastructure are reused. No new layer, file protocol or dependency; no confirmed remaining complexity finding.
- **Review status: independent Codex + Ponytail + Antigravity review complete. No unresolved confirmed actionable finding or review-execution blocker.** This signs off the scoped local diff and regression checks; it does not approve a separate fullscreen calibration proposal or replace the parallel broader requirements audit.
