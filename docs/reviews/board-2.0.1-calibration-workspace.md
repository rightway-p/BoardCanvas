# Calibration workspace — independent review

Status: **PASS — preview source only** (2026-10-06). Base `0f5dc78aaa755660d7514ce03a9de802ea2c1163`. Installed/public beta.4 source `9546e2dd7df4ec983e6267513932305db276df86` and its installer remain unchanged. No version change, install, release, merge or publication is part of this review.

## Review executors and scope

- Independent Codex reviewer: subagent `/root/recovery_design_review`, separated from parent/operator `/root` and implementation CLI workers; GPT-6 high-capability review role. Read-only correctness and Ponytail review of the complete two-file diff, current calibration template and lifecycle. Reviewer wrote only review/worklog records.
- Implementation/operator attribution: implementation CLI sessions 54459, 74590, 36569 and final spacing correction 85453; parent reports successful exits. Final spacing worker model `gpt-5.6-luna`, low effort. Browser runtime, keyboard checks and full test execution were performed by `/root`; independently inspected the final 520×570 screenshot pixels.
- Actual Antigravity CLI executor: independent reviewer, `C:/Users/pjd01/AppData/Local/agy/bin/agy.exe`, `--mode plan --model gemini-3.1-pro-high --effort high --output-format stream-json --print-timeout 240s --print`.
- AGY execution session: PTY 28901; actual conversation `4981d1aa-521a-48ec-853e-8d4a9382755e`; exit **0**, terminal **SUCCESS**, response **PASS**, 25.2915 seconds, one turn. Input 22329 / output 3107 / thinking 3106 / total 25436 tokens. Bounded 27605-character prompt included exact current template/calibration lifecycle, complete CSS diff, remaining JS diff and runtime boundaries; omitted giant duplicate old/new template lines from the diff because the current template was separately included. Previous unchanged input/native/updater review remains applicable.
- Execution evidence: `tmp/calibration-workspace-review-agy.jsonl`, `tmp/calibration-workspace-review-agy.err`, `tmp/calibration-workspace-review-meta.json`, `tmp/calibration-workspace-review-prompt.txt`.

## Findings, false positives and disposition

1. **Actionable, resolved** — `js/board-2.0.1-ui.js:828,1044`: original measurement start and test area were separated. Root reproduced 900×570 start at y630.23–666.23 outside the content viewport y66–557 after area focus scrolled the page. Workspace now presents intent/start/cancel above the area, followed by numeric settings/history. Start scrolls the workspace, then focuses the area with `preventScroll: true`; no measurement-time auto-scroll was added. Existing finger-release auto-record remains, explicit cancel creates no record.
2. **Actionable, resolved** — `styles.css:1032`: provisional 520×570 workspace overflowed by about 40px (area bottom 597.05 vs content bottom 557). Independent cascade review confirmed `.settings-card p` overrode the intended calibration paragraph margin/font: both paragraphs had 8px top/12px bottom margins and 14px font. Final scoped action-strip paragraph rule restores margin 0, label font and 1.4 line height. Existing 2.8em reserved height remains, avoiding status-induced jumps. This fixes the cascade without shrinking the trial area or changing unrelated cards.
3. **False positives / rejected scope changes** — no new AGY false positive. Fullscreen measurement and a manual finish-to-record button are not required by this accepted correction and were not added. Fullscreen measurement remains a separate undecided proposal. A failed generic-locator lookup during root keyboard testing was a selector mismatch, not evidence of application failure; the supported data-key locator was used for the actual check.
4. **Ponytail** — existing cancellation, pointer capture/release, summaries, draft Save/Cancel and thresholds are reused; native focus/scroll APIs replace implicit focus scrolling. No new dependency/file/abstraction/storage key or input math. No additional deletions required: Lean already. Ship. No unresolved actionable finding or review blocker.

## Final validation and limits

Root-attributed final browser geometry, including the longer zoom-out hint:

| Preview viewport | Content y range | Start/cancel y range | Entire area y range / height | Result |
|---|---|---|---|---|
| 520×570 | 123–557 | 189.266–233.266 / 44px | 324.453–544.453 / 220px | PASS |
| 900×570 | 66–557 | 132.56–176.56 / 44px | 267.75–487.75 / 220px | PASS |
| 1280×720 | 119.594–661.391 | 185.86–229.86 / 44px | 321.047–641.047 / 320px | PASS |

Screenshots: `tmp/calibration-workspace-final-520.jpg`, `tmp/calibration-workspace-final-570.jpg`, `tmp/calibration-workspace-final-720.jpg`. Independent pixels inspection of the 520 screenshot confirms buttons and whole area remain visible together. Root verified cancel → disabled, canceled status, records 0/10; restart works. At 1280×720, Shift+Tab from area reached measurement cancel without moving scrollTop 454, Space canceled without a record; browser errors were empty.

Root fresh full suite: **97/97 PASS**, exit 0, reported test duration 2569ms (command 3.2876s). Prior targeted calibration checks **35/35 PASS**; implementation syntax, web build and diff checks passed. No redundant native build was requested for this preview-only unit.

Source review confirms reset remains explicit, cancel/tab/category/dialog cleanup releases captures/frame/armed state, record application changes only the settings draft, and real PDF/strokes/camera are isolated. Existing internal zoom intent keys are preserved. Browser geometry/keyboard/unit tests do **not** establish physical two-finger device acceptance; physical touch calibration and long-hold behavior remain Sunday hardware checks. Installed beta.4 has not been altered. OAuth external setup, Figma synchronization, public rollback and stable acceptance are not completed by this change.

## Frozen source hashes

Hashes rechecked after actual AGY result; match its pre-execution snapshot:

| File | SHA-256 |
|---|---|
| `js/board-2.0.1-ui.js` | `D0AB1EE6A5B79163C6C17F9384184D06CE1A20375B08259A2BD6B09667886247` |
| `styles.css` | `E4F606DA1AA5C14C353192200F4E48002EE022B2E2BD1F7EABD7864D7197E7E5` |
