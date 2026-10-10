# Settings visual polish — independent review

**PASS**, 2026-10-06. Scope: existing Settings styling in `styles.css` only; navigation, controls, JS, thresholds, toolbar and installed/public beta.4 remain unchanged. Base `e09fad99c5caf18adb9f041c99349682a0de44ef`. Separate `tmp/setup-wizard.html` proposal is not production source and not part of this CSS approval.

## Executors

- Independent Codex correctness/Ponytail reviewer: `/root/recovery_design_review`, GPT-6 high-capability review role, separated from implementation agent `setup_wizard_mock` (`gpt-5.6-luna`, medium; start confirmed by parent) and operator `/root`. Read-only source/call-path inspection; wrote this review record only.
- Actual AGY executor: this independent reviewer, `C:/Users/pjd01/AppData/Local/agy/bin/agy.exe`, `--mode plan --model gemini-3.1-pro-high --effort high --output-format stream-json --print-timeout 240s --print`.
- Full frozen CSS review: PTY6432 / AGY conversation `1d8d9947-96d3-4d8b-ad63-7454a6889780`; exit0, terminal SUCCESS, established defects PASS; 87.0628477s, one turn, input24768/output12030/thinking11600/total36798. Required actual small-screen wrap check, rather than inventing runtime acceptance.
- Final narrow correction: PTY93650 / AGY conversation `9f17f466-61c9-4f2e-9cd6-3096fcaa6607`; exit0, terminal SUCCESS, PASS; 11.9557006s, one turn, input14482/output1126/thinking1015/total15608. The prompt included exact corrected two rules and standalone caller context. Unchanged prior CSS scope reuses the full review.
- Logs/prompts/meta: `tmp/settings-polish-review-*`, `tmp/settings-polish-delta-*`.

## Findings / false positives / handling

1. **Actionable, resolved:** `styles.css:1186–1187`, `js/remote-controls.js:201–220,325–328`. The initial global `.remote-settings-status` rule used tokens declared only on `.settings-dialog`. Existing `BoardRemote.openSettings()` also supports a standalone native HTML dialog, where those variables would be undefined and the original status background lost. Final minimal correction restores the original global status rule exactly, then scopes only the new border/background to `.settings-dialog .remote-settings-status`. No JS or legacy dialog redesign required. Codex and final actual AGY confirm resolution.
2. **Runtime verification request, satisfied:** `.settings-dialog` inherits `word-break: keep-all; overflow-wrap: break-word`; additional paragraph wrapping could alter calibration height. Parent/operator actual520×570 check: Settings content y123–557, start/cancel y189.26–233.26 (44px), trial area y324.45–544.45 (220px), cancel clears. Bounds match the prior workspace. At default883×884, screen/remote cards and navigation showed no overflow. These are parent runtime evidence, not independent-reviewer hardware execution.
3. **False positives:** none. AGY runtime-needed item was retained and resolved with actual geometry; no automatic PASS inferred from source alone. No proposal was converted into a confirmed product requirement.
4. **Ponytail:** four local palette tokens, existing selectors/cards and native CSS current-nav inset reused; no file/dependency/abstraction/function expansion. Global toolbar selectors/tokens untouched. No additional deletion needed: Lean already. Ship. All actionable findings handled; no blocker remains.

## Validation / boundaries

Implementation worker web build and diff checks PASS. No JS changes, so full JS/native tests were not redundantly rerun for this cosmetic unit. Parent actual small-screen and default-screen checks cover the new wrapping risk. Calibration-specific paragraph specificity,44px control size,220px small area, existing Save/Cancel and settings navigation are preserved. This does not establish physical touch, OAuth, Figma synchronization, public rollback or stable acceptance.

Final source SHA-256 rechecked after AGY SUCCESS: `styles.css` = `08E0DF34A2D989FE919D5009D25236CC4E0C9436EE1F4F2F346823D9C7AEC363`. Initial full-review hash `C27957D5B2C87F4D745531EEE7427D37B47687549EE4F37B14F01E7E5A44012E` is superseded solely by the reviewed standalone status scope correction.
