# Board 2.0.1 per-user NSIS packaging independent review

Date: 2026-10-05. Baseline: `214a64b51955a221f162d7aaf64580dd6de94e06`, final local uncommitted diff. Scope: `src-tauri/tauri.conf.json` and `docs/update-recovery-plan.md`; Windows per-user NSIS packaging approved by the user, with version `2.0.1` and identity `com.rightway.boardcanvas` retained. Implementer: `/root/nsis_installer`. This reviewer edited only this review record and made no implementation edits, installer launches, commits or pushes.

## Independent reviewers and execution evidence

- Codex/Ponytail executor and reviewer: independent collaboration subagent `/root/nsis_review`, separate from the implementer. The inherited runtime identifies itself as GPT-6; its exact runtime model ID is not exposed and is not inferred. High reasoning effort inherited from the parent. Final diff, local installed Tauri CLI schema, updater status path, generated NSIS source and built artifact were inspected directly.
- Antigravity executor: the same independent `/root/nsis_review` subagent invoked the official installed `C:/Users/pjd01/AppData/Local/agy/bin/agy.exe`. Live `models` output confirmed `gemini-3.1-pro-high`; the session init confirmed that actual model. High effort, plan mode, supplied final source snapshot only, with explicit instructions against tools or edits.
- AGY session `cddfb0ce-abeb-47cb-8912-e36b75126d02`: **SUCCESS**, process exit **0**, substantive response; 33.7445881 seconds wall time, 27.1676039 seconds result duration. Stream step types were only `user_input` and `agent_response`; no tool calls, edits, permission requests or permission bypasses.
- AGY snapshot: 14,857 characters, including the final icon correction, scoped diff, config/manifests, recovery plan and clearly attributed worker build outcome. Local artifacts: `%TEMP%/board-nsis-agy-snapshot.txt`, `board-nsis-agy-review.jsonl`, `board-nsis-agy-stderr.txt`, `board-nsis-agy-result-meta.json`.
- The first CLI invocation failed argument parsing with exit 2 because `--print-timeout 240` requires a duration unit. It started no review session. The corrected `240s` invocation above completed successfully. Original parser diagnostic is retained in `%TEMP%/board-nsis-agy-initial-argument-stderr.txt`; no review-execution blocker remains.

## Actionable findings and fix disposition

**No confirmed actionable finding remains in the final scoped diff.** Codex and AGY independently found no correctness, data-preservation or approval-scope defect.

`src-tauri/tauri.conf.json:36`: the first packaging attempt exposed NSIS's required `.ico` input. The implementer reused the repository's existing `icons/icon.ico` through `bundle.icon`; the final NSIS build succeeded. This is a resolved build requirement, not a new asset, dependency or custom installer layer.

`src-tauri/tauri.conf.json:33`: native bundling is enabled with only `nsis` targeted; `:39` selects `currentUser`. The installed Tauri 1 schema accepts these settings. Existing package identity/version remain unchanged. Updater configuration is absent, its schema default is inactive, and `Cargo.toml` still has no updater feature. Existing `get_updater_status` additionally requires active configuration, HTTPS endpoints and a public key.

## False positives, deferrals and acceptance boundaries

- Unsigned installer and inactive updater are intentional within this approved packaging scope. AGY treated demands to enable them now as false positives. The artifact's Authenticode status is **NotSigned**, and no signing or updater readiness is claimed. Authenticode and Tauri updater package signatures are distinct.
- Missing real installation/migration/rollback validation is **remaining acceptance work**, not evidence of a config defect. AGY described treating its absence as a defect in this build-only scope as a false positive. This record does not waive the actual install/data-preservation requirements or treat them as passed.
- Preserving the original standalone EXE candidate is intentional. It is not assumed to be the user's actual v1 installation or a validated rollback baseline.
- `allowDowngrades` remains the native default; no rollback capability is inferred from it. No recovery module, journal, checkpoint, signed prior installer, feed or hosting is supplied by this change.
- The generated native uninstaller includes an explicit app-data deletion checkbox and conditional deletion branch. Its existence does not verify upgrade or WebView profile preservation. Safe real installation, upgrade, uninstall choices and profile reuse remain to be tested with preserved copies.

## Validation and final state

- Implementer-reported validation in its execution transcript: **51/51 tests passed**, web build passed, and final `npm run desktop:build -- --bundles nsis` passed. No separate build/test log files were retained. These runs are attributed to `/root/nsis_installer`, not presented as independent reviewer test runs.
- Independent reviewer smoke checks passed for parsed config, version, identity, NSIS target, `currentUser`, local schema defaults, inactive updater, absent Cargo updater feature and existence of the reused icon. Independent `git diff --check` passed; only line-ending notices occurred.
- Independently inspected generated `src-tauri/target/release/nsis/x64/installer.nsi`: `INSTALLMODE currentUser` at line 23, unchanged `BUNDLEID` at line 30, `RequestExecutionLevel user` at line 72, `SetShellVarContext current` at line 363 and default `$LOCALAPPDATA\\BoardCanvas` at line 406. This confirms generated build-time choices, not an observed installation.
- Independently inspected artifact: `src-tauri/target/release/bundle/nsis/BoardCanvas_2.0.1_x64-setup.exe`, **2,924,776 bytes**, PE ProductName `BoardCanvas`, FileVersion `2.0.1`, SHA-256 `87F6C656454319DC7B0F72C3B1EF32DFB9629D0F243F8DFADA5F97A2EBF8DB2B`, Authenticode `NotSigned`.
- Independently rechecked the preserved `C:/Workspace/2_myProjects/Board/src-tauri/target/release/boardcanvas.exe`: **4,482,560 bytes**, SHA-256 `D2BC13517F84E32BCF68DD07E95A9F10CDB4BEA01AD9FEC947E69C36231821B0`, matching the recorded pre-packaging baseline.
- Ponytail result: **Lean already. Ship.** Native NSIS configuration and existing icon reused; no custom installer, abstraction, dependency or speculative recovery code added. This phrase assesses complexity only and does not authorize distribution or imply real installation acceptance.
- **Scoped local Codex + Ponytail + Antigravity source/artifact review complete; no unresolved actionable finding or review-execution blocker.** Actual Windows installation, upgrade/downgrade, v1 bootstrap, data/WebView profile reuse, interrupted installation and rollback acceptance are untested. Distribution readiness and the full update/recovery requirement remain incomplete.
