# Board 2.0.1 remaining implementation audit

Date: 2026-10-06. Independent reviewer/executor: `/root/nsis_review`, separate from implementation worker `/root/figma_layout_fix` and coordinator `/root`. Inherited GPT-6/high reasoning; exact runtime model ID unavailable. Read-only audit of canonical README, 업데이트-완료현황.md, actual source and existing tests/review records. No implementation edits or test reruns. Baseline `a8bbe729e88402315720dddbaf0f37514c6d5c55` plus the already-reviewed local settings-order HTML change.

Status: **focused pre-implementation audit complete — Codex/Ponytail and actual read-only AGY corroboration executed successfully**. Upcoming implementation review remains separate.

Latest coordinator-provided direct user context: GitHub Releases deployment is approved. The user's actual v1 is a portable EXE not present on this PC; the preserved local candidate is not that confirmed baseline. Approval of a release host does not supply signed artifacts or establish previous-version recovery compatibility.

## Confirmed implementation gaps

1. **Restart and work-file open retain saved view instead of resetting it.** `js/board-2.0.1-ui.js:128` restores `page.view`; work open keeps views at `:410` and renders at `:443`. Session parser retains them at `js/session-pdf-toolbar.js:513–514`; restoration applies the sequence at `:576`/`:619` and renders at `:636`, then UI initialization renders again at `board-2.0.1-ui.js:1041`. There is no entry-only reset to blank origin/scale1 or current PDF fit. Ordinary page navigation at `:221–225` correctly saves/restores views and must remain so. Source tests cover fit and page-state preservation, but no current test establishes the requested restart/open reset.

   Requirement provenance: the canonical README section 11 still describes an earlier assistant saved-view proposal, while the status table calls reset verification incomplete. Coordinator `/root` supplied the later direct human decision in the current conversation: after cache-only restoration and empty undo/redo discussion, the user requested unconditional first position/default scale and approved it. This later decision establishes the gap; it must be appended to canonical records as a changed decision, without silently erasing the older proposal. Root assigned entry reset implementation to a separate worker.

2. **Update timing/restart and recovery are not implemented end to end.** `js/board-2.0.1-ui.js:365–387` checks, asks install confirmation, saves cache, then directly calls `installUpdate`. No explicit restart-timing state or recovery checkpoint/journal/previous-version restoration path is present. `src-tauri/tauri.conf.json` has currentUser NSIS bundling, but no enabled updater configuration; `src-tauri/Cargo.toml:17` lacks the updater feature. `src-tauri/src/commands/drive.rs:305–310` reports configured only with active updater, HTTPS endpoints and public key. Current disabled behavior is intentional and must remain until real signed distribution/recovery criteria are satisfied. Exact Windows installer/process behavior must be checked before choosing a separate restart call; this audit does not assume installing can be separated from installer-driven exit/relaunch.

3. **A concrete external-integration responsibility boundary remains mixed.** `drive.rs:305` implements updater status inside the Drive module, and `board-2.0.1-ui.js:365` owns native update check/install as well as UI. If implementing update lifecycle, isolate this existing update integration boundary and have UI dispatch into it. This is a small responsibility correction, not evidence that all UI/input/page/persistence code needs refactoring. Existing `BoardState` domain operations and session persistence should be reused.

## Already implemented versus pending validation/configuration

| Scope | Source-backed implementation | Remaining boundary |
| --- | --- | --- |
| Popups, PDF viewport/background, pen/presets, pages/undo/export, remote trial, settings/developer touch | Existing source and prior independent test/browser evidence; no new confirmed missing feature in this focused pass | Actual touch sensor/remote, native OS window/save behavior and target-device acceptance |
| Settings gear last; app information inside settings | `index.html:74–115`, existing about category; independent Codex/Ponytail/AGY plus actual top/left/right/about UI evidence in settings-order review | No new implementation gap |
| Drive login/list/download/cache | `drive.rs:118` PKCE/loopback login, `:166` list, `:186` download; UI `board-2.0.1-ui.js:48`/`:67`; real backend rather than mock | Build-time Desktop OAuth client ID (`drive.rs:119`, `:366`), Drive API/consent and real account E2E; no need to invent another login implementation |
| NSIS per-user packaging/version2.0.1 | Current bundle configuration and independently reviewed successful installer build | Installer execution, upgrade/downgrade, profile/data preservation and interruption tests; not equivalent to missing packaging code |
| Update and previous-version recovery | Version/check UI and disabled native configuration guard exist | Lifecycle/recovery code missing, plus signed current/previous artifacts, public key/HTTPS feed and verified previous installation/data compatibility |
| Figma | 23 editable SVG groups, final gear-order artifact/reload verified | Native components/auto-layout/tokens remain unbuilt; static artwork is not app implementation or all-screen pixel acceptance |
| ESP32 / full-screen measurement overlay | ESP32 explicitly later scope; overlay proposal not approved as required work | Do not count these as 2.0.1 implementation gaps |

## Recommended next implementation priorities

1. Entry-only restart/work-open view reset and meaningful regression tests for blank/PDF, ink preservation and ordinary page navigation preservation. Do not change page navigation into an unconditional reset.
2. Minimal update lifecycle/state boundary with explicit install timing, concurrency protection and cache-failure gating. Keep production updater disabled. Verify Windows install API behavior before deciding restart semantics. Tests can use a supplied fake adapter; they cannot establish real signed install/recovery acceptance.
3. Recovery preflight/checkpoint/journal foundation only after its data owner/path and validated previous-version contract are specified. Do not offer a working rollback button or overwrite an existing installation when the only previous artifact is an unverified standalone candidate. Release integration requires actual external materials listed above.

## False positives, fixes and review boundary

- Saved-view behavior is correct for page navigation but conflicts with the later restart/open decision. Initial uncertainty from stale canonical proposal was resolved by coordinator-provided direct user decision.
- Old audit wording “bundle inactive” is historical; current NSIS bundle is active and built. Updater remains inactive.
- `appInfoButton` names the settings gear; `?` is preset help. Neither implies a leftover separate external info feature.
- Native/Drive/device test gaps do not establish absent feature code. No broad refactor or duplicated OAuth/persistence mechanism is recommended.
- This is pre-implementation gap identification, not acceptance of the upcoming fixes. Independent code and AGY reviews must review those final diffs separately.

## Antigravity corroboration

- Executor: independent `/root/nsis_review`; CLI `C:/Users/pjd01/AppData/Local/agy/bin/agy.exe`. Live model enumeration and stream initialization confirmed `gemini-3.1-pro-high`, plan mode/high effort.
- Actual session `56f747fe-172e-45c0-ab4d-d711b3707e8f`; result SUCCESS, process exit 0, wall time 35.30 s (result duration 26.47 s). Supplied 21,868-character baseline excerpts/requirements snapshot; no tools, edits or delegation permitted. This execution corroborated entry-view reset and update/Drive responsibility gaps. It is not a review of subsequent worker edits.
- Rejected overstatement: AGY described saving `view` itself as wrong. Keeping saved page view metadata can be compatible; the confirmed gap is entry restoration behavior, and ordinary page navigation must preserve views. It also described cache restoration as localStorage-only; actual PDF bytes use IndexedDB (`session-pdf-toolbar.js:358`), so its wording must not replace source evidence.
- AGY classified updater external materials as pending, but this does not erase the source-confirmed missing lifecycle/recovery code above. No signed install or actual rollback was executed.
- Logs/snapshot: `%TEMP%/board-gap-audit-20261006-agy.jsonl`, `board-gap-audit-20261006-agy-meta.json`, `board-gap-audit-20261006-agy-stderr.txt`, `board-gap-audit-20261006-snapshot.txt`.
- Ponytail conclusion: implement only the concrete entry reset and update lifecycle boundary; no whole-app restructuring justified. Existing tests were read, not rerun during this audit.
