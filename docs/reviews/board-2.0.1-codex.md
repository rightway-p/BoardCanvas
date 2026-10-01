# Board 2.0.1 independent Codex review

## Identity and scope

- Reviewer/executor: independent Codex subagent `/root/policy_review`; not an implementation worker.
- Model: inherited Codex session. Exact model ID is not exposed to this reviewer and is not inferred.
- Baseline/HEAD at review: `6db75496c2de02072070ac10170e979c39bce938`.
- Scope: uncommitted tracked changes and new files in the `board-2-0-1/Board` worktree, against `docs/board-2.0.1.md`; module loading, input/camera, page and ink history, manual/session storage, PDF export, presets/developer controls, remote input, Drive/update integration. Native auth/cache checks include the earlier focused review; native save was still being completed during this pass.
- Initial outcome: **changes required**. See final delta review below for the current disposition. Implementation continued concurrently. Findings below record observed source and reproduction evidence, not a claim that a subsequently edited file still contains every issue. A final delta review is required.

## Actionable findings

1. **P1 — Legacy keyboard PDF navigation keeps the wrong page identity.** `js/render-doc-draw.js:436`, `:444`; callers in `js/events-init.js`. Arrow handlers call `renderPdfPage()` without changing `boardPageIndex`. PDF 2 can be displayed while `currentBoardPage()` still identifies PDF 1, so subsequent ink/history is assigned to the wrong page and inserted blanks are skipped. Route keyboard navigation through the unified sequence navigation.
2. **P1 — Secondary touch movement enters the active pen stroke.** `js/render-doc-draw.js:819`. Down/end check the active pointer but move did not. A runnable VM probe with pointer 1 active and a pointer 2 move recorded `[2]` in `draw()`. Apply the same pointer-ID check before movement dispatch; cover this integration boundary.
3. **P1 — Fresh multipage PDF export requires visiting every page.** `js/board-export.js:115`. `pdfWorldSize` is initialized only when a page is rendered, but export rejects missing frames. A generated two-page PDF with only the first page visited failed with `PDF page 2 has no saved drawing frame`. Derive an unvisited page's frame without requiring UI navigation.
4. **P1 — PDF rendering can overwrite a blank board.** `js/board-2.0.1-ui.js:89`, `js/render-doc-draw.js:221`. Switching to a blank board did not invalidate an outstanding PDF render; its completion can install the old raster. Resizing a blank board with a PDF still loaded also schedules `renderPdfPage(0)`, which clamps to PDF page 1. Invalidate rendering on page changes and gate scheduled rendering to the active PDF entry.
5. **P1 — Navigation during an active stroke commits ink to a different page.** `js/board-2.0.1-ui.js:174` and page/structure mutation functions. A remote NextPage during pen contact replaces visible strokes/current page, but the active stroke survives; pointer-up appends it to the new page. Finish or reject active input before shared page/work mutation boundaries.
6. **P2 — Rotated PDF export loses source orientation and annotation alignment.** `js/board-export.js:61` and PDF embedding path. A source page sized 200x100 with rotation 90, displayed as 100x200 by PDF.js, exported as 200x100 with rotation 0. Account for the source's visual rotation/crop in both source-page and ink transforms. Existing tests only exercise unrotated pages.
7. **P2 — Blank export depends on the current viewport.** `js/render-doc-draw.js:200`, `js/board-export.js` blank-page path. Passing current canvas dimensions as every blank page's frame changes output aspect/cropping after resizing. Persist each blank board's original drawing frame and use it for export/restore.
8. **P2 — Preset hold can survive release outside its button.** `js/presets-ui.js:187`. The timer was canceled only by button pointerup/pointercancel, without pointer capture or leave cancellation. Press, move outside, release before three seconds: the editor can still open later. Cancel or capture the pointer and verify the initiating pointer remains active.
9. **P2 — Remote mode switch can strand an active pan gesture.** `js/board-2.0.1-ui.js:330`. Toggling from pan to pen while contact remains active makes the pointer-up listener skip `endPanOrZoom`; the pending timer and active pan state remain. End/cancel the active gesture when switching modes.
10. **P2 — Cache availability is displayed as authenticated Drive connectivity.** `js/board-2.0.1-ui.js:28`. `drive_get_cache_status` works without OAuth, including an unconfigured fresh installation, yet its success sets `연결됨`. Keep cache status separate from authenticated connectivity; never imply successful sign-in from a local cache read.

All ten findings were sent directly to the frontend implementation worker and/or coordinator as identified. No implementation was changed by this reviewer.

## Prior findings and fix confirmation

- Pending OAuth completion after logout: **fixed by source inspection**. `begin_sign_in`, `install_tokens`, and `invalidate_tokens` synchronize via the token mutex and an auth generation; refresh checks that generation under the same mutex. A regression test rejects token installation after logout.
- OAuth token response snake_case, orphan partial cache cleanup, active-cache pin serialization, refresh-after-logout: prior focused review confirmed the corrections. Active data remains protected by cache serialization and the protected entry check.
- Remote modifier matching/persistence, settings isolation, mapped-key display: fixes inspected; six remote tests pass. Unmatched modal navigation uses native defaults while document-level isolation prevents board shortcuts.
- Manual work import now validates PDF page references with a candidate document before committing the replacement, rejects noninteger pageIndex and nonfinite view values, and retains the previous document if loader rendering fails. This addresses the previously reported malformed-file paths.
- Save-and-replace now awaits a verified native/browser file-save result and refuses replacement when only an unverifiable download fallback is available. Native command registration is present; native dialog end-to-end behavior was not exercised in this pass.
- Ordinary Save button initially passed MouseEvent into `requireVerified`, suppressing its fallback. The handler is now an explicit zero-argument wrapper; **fixed by source inspection during this pass**.
- CSS translation of the fixed-size canvas was removed. Canvas context transforms now use the retained backing-pixel convention consistently for ink and PDF. Resize no longer rescales world geometry just because viewport dimensions change.

## False positives and accepted scope boundaries

- Omitting inserted blanks by default is required; the defect was the missing opt-in export path, not omission itself. The new export dialog has unchecked opt-in controls.
- Download helper argument order is correct: `(blob, fileName)`.
- A documented large-PDF base64 memory cost is a limitation, not proof of user acceptance of OOM/data loss. No blanket waiver is claimed.
- Missing Google OAuth deployment configuration and signed update artifacts are explicit external requirements, not simulated successes. An inactive updater is appropriate until real configuration exists.
- No duplicated framework, speculative service layer, or unnecessary new frontend dependency was found in the Ponytail pass. Small pure state/export helpers and regression tests have concrete callers/purposes. No unrelated deletion is recommended.

## Validation and limits

- Ran `node --test tests/board-state.test.js tests/board-export.test.js tests/remote-controls.test.js`: **14 passed** at the reviewed snapshot.
- Ran read-only Node/VM reproduction probes for secondary pointer input, fresh multipage export, and rotated PDF output; all three exposed the failures described above.
- `git diff --check` passed (line-ending conversion warnings only).
- Structure helper tests cover add/delete undo/redo capturing latest page state, final-page protection, anchored zoom math, and duration/tolerance gating. They do not by themselves prove actual browser event routing, hold cancellation, rendering, export pixel alignment, or transactional storage.
- Actual bezel-touch hardware, live Google OAuth, signed installation, OS-native save dialog cancellation/overwrite, and a final browser acceptance pass remain unverified by this reviewer.
- Updater install awaits `persistSessionState()` and the launch check waits for initial recovery. This source-level wiring was inspected; actual installation and concurrent storage failure handling were not validated end to end.
- Frontend changes after this report require focused re-review and appropriate regression checks. A separate broad Antigravity review is still required before the PR review is complete.

## Final independent delta review (2026-10-02)

Executor remains independent Codex subagent `/root/policy_review`; no implementation edits. All ten original actionable findings are resolved by current source inspection and focused checks. The final renderer regression found during fixes is also resolved: outgoing input/state is finalized before mutations; `renderBoardPage` restores the selected page without saving stale visible strokes into it. An independent VM probe executed the actual `openBoardWorkFile`, `renderBoardPage`, and `deleteBoardBlankPage` functions: imported ink/view survived, deleting the edited middle blank preserved both neighbors, and the removed-page undo snapshot retained its edits. This check supplements the helper tests.

- Findings 1/2/4/5/9: unified navigation, active-pointer checks, async render invalidation and pre-mutation gesture finalization inspected.
- Findings 3/7: export handles unvisited source pages and optional blank pages with persistent world frames.
- Finding 6: final PDF draw rotation is inverse of `/Rotate` (90 -> 270, 270 -> 90), with crop-aware offsets. Independent live PDF.js viewport comparison for a 200x100 page, crop (20,10,160,60), point (30,30), matched at all angles: 0=(10,40), 90=(20,10), 180=(150,20), 270=(40,150). This checks real PDF.js math, not only duplicated expected values; pixel rendering remains unverified.
- Findings 8/10: preset capture/cancel and movement threshold inspected; cache status no longer implies OAuth connectivity.
- Additional replacement race: manager rejects concurrent requests and remains occupied while an action executes, including immediate clean-blank imports. Cancellation settles the pending caller. Drive download now starts only inside the accepted replacement action.
- Native save source uses the internal Tauri dialog feature, selected-path writing and a temporary sibling/atomic replacement; coordinator reports actual production desktop build and 9 Rust tests passed after the feature correction. This reviewer did not operate the native OS picker.
- Final local verification: 21 JS tests passed (9 state, 6 export, 6 remote); `git diff --check` passed with only line-ending notices. No remaining confirmed actionable finding from this Codex review. This is source/test review completion, not a claim that external integration acceptance is finished.

### Inherited PR scope: origin/main..6db7549

Reviewed the six inherited commits separately, preserving existing user work. Eleven extracted Rust functions have identical normalized bodies/signatures apart from module visibility: runtime logging, cursor lookup, overlay/webview behavior, window rectangle/click-through and verification. Command names/registration remain unchanged with module qualification. Cargo.lock removes the registry identity of wry 0.24.11 to match the already-existing local Cargo patch; vendor source is unchanged. Remaining additions are architecture/plan documentation. No actionable inherited-scope finding.

### Remaining verification boundaries and false-positive dispositions

No browser download event while Save opens an OS/File System Access picker is not evidence of a broken Save handler; actual completion/cancellation/overwrite must be verified in that runtime. Live Google OAuth, bezel-touch hardware, signed update installation, and native save picker remain external/manual acceptance items. The prior AGY password-PDF rollback/autosave reproduction was not established: password parsing fails before replacement backup/commit. No confirmed data-loss finding is waived as an accepted risk. Broad AGY source-only review was completed and a final source-only delta recheck is recorded separately in the Antigravity report.
## Final bounded-transfer follow-up

The final Antigravity review identified unbounded whole-file transfer as a resource concern. Independently inspected the implemented 256 MiB source-PDF and 512 MiB work/save limits: frontend checks precede source reads, embedded-PDF decoding and outbound base64/IPC; Drive validates remote metadata, content length, cumulative stream bytes and cached metadata before whole-file reads; Rust save validates encoded length before dialog and decoded byte count while streaming. Exact-limit/one-over and padding boundaries are tested without giant allocations. Re-ran all JS tests: **23 passed**. No remaining confirmed actionable guard defect. These are engineering constraints, not claimed user requirements or guarantees against all low-memory failures; JSON serialization and PDF generation still allocate their output before result-size checks. Existing cache quota remains independent. No new file protocol or broad filesystem capability was added.
