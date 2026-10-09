# Beta opt-in and explicit stable return — independent review

Status: PASS — independent Codex/Ponytail and substantive actual AGY reviews completed for the frozen source and r2 local package. Publication/installation/stable return are not validated by this record.

## Actors and scope

- Independent Codex/Ponytail reviewer and AGY operator: `/root/recovery_design_review`, separate from implementation. Inherited high-capability reviewer model; exact backend model/session identifier is not exposed.
- Implementation executor: `/root/release_notes_implementation`; root orchestration explicitly selected `gpt-6-luna`, medium, successful start. No independent backend UUID is exposed.
- Actual AGY model: `gemini-3.1-pro-high`, effort high, executable `C:/Users/pjd01/AppData/Local/agy/bin/agy.exe`.
- Baseline HEAD: `87c2b191c3739031140697371b6f29cca7e0c04a`; reviewed input is the frozen, uncommitted working tree, not that commit alone.
- Scope: 11 source/test files listed in the frozen hash table below. Preexisting beta.6 validation document changes are excluded. Existing updater signature/checkpoint/ACK implementation reviews are reused for unchanged code.

## Findings and disposition

| Origin | Finding | Disposition and reason |
| --- | --- | --- |
| Independent Codex | Updater status sets the beta checkbox true, but subsequent recovery status omits the preference and resets it false. | Fixed: checked changes only for a boolean field. Actual extracted production-function regression passes. Native preference and installed channel remain distinct. |
| AGY native | Eager preference reads cause corrupted beta JSON to block stable updates, authorization, launch and helper installation. | Fixed: stable targets bypass preference reads; beta targets still fail closed. Candidate lookup treats read failure as OFF. Malformed-file regression checks stable allowed/beta denied. Final bounded AGY confirmation passed below. |
| AGY native | Remove duplicate stage-final opt-in validation. | False positive. Downloads await network I/O; the preference may change during staging. Final validation is required and preserved. |
| AGY native | Preference writer omits reparse-path rejection. | False positive. `reject_managed_path` is a direct wrapper of `reject_reparse_path`, covering ancestor components; the writer invokes it and uses existing atomic/flushed replacement. |

No new abstraction/dependency or blanket downgrade policy was introduced. Normal update requires a strictly newer signed version; explicit promotion is restricted to installed beta and signed stable. Pinned rollback remains a distinct user-authorized recovery action. Beta targets are checked at prepare, stage completion, authorization, launch, and external helper apply. Signed feed channel must match the requested feed.

## Actual Antigravity executions

| Scope | Actual conversation ID | Execution and adjudication |
| --- | --- | --- |
| Native policy and connected installation flow | `9cb5b1cc-6ac3-48d4-ac33-43d0dcd1c790` | Exit 0, substantive SUCCESS, 169.817 seconds; one valid finding fixed above and two false positives. Log: `tmp/beta-optin-native-agy.jsonl`. Despite a text-only prompt, AGY attempted `ReplaceFileContent`; result records `denied_actions: write_file`. The attempted action was rejected and is not implementation authorization. |
| JS/UI, flow, release note and checkbox regression | `108c4245-7ab6-4648-bc40-aedc0898ea99` | Exit 0, substantive SUCCESS, 31.962 seconds, NO_ACTIONABLE. `tmp/beta-optin-ui-agy.jsonl`. |
| Signed feed channel binding addition | `42d061f4-c4d1-4453-b160-aca1a66627f0` | Exit 0, substantive SUCCESS, 15.588 seconds, NO_ACTIONABLE. `tmp/beta-optin-feed-channel-agy.jsonl`. |
| Lazy preference-read first attempt | `4c7ebdac-fe76-416a-9a1b-8518f9501378` | Exit 0 framework SUCCESS but empty response and zero input/output usage: FAILED as review evidence. Actual nonempty 10,035-character prompt retained; no substantive review. `tmp/beta-optin-lazy-final-agy.jsonl`. |
| Lazy preference-read bounded retry | `3c877036-d269-4648-94bf-4a45b032f3df` | Exit 0, substantive SUCCESS, 100.390 seconds, NO_ACTIONABLE. Actual nonempty 3,437-character prompt; `tmp/beta-optin-lazy-retry-agy.jsonl`. Supersedes the empty attempt as final delta review evidence. |

AGY's general claims of readiness do not imply installed-app or downgrade acceptance. Only source review conclusions are adopted.

## Verification and limits

- Reviewer: actual UI regression 1/1; updater-flow and release-note tests 27/27; actual malformed-preference native app regression 1/1; diff whitespace check passed.
- Executor: full JS 133/133, native policy 9/9 in app and 9/9 in helper; web build and production helper/NSIS build passed.
- Root browser CUA: About beta toggle unchecked/disabled without Tauri, readable/no clipping. This verifies browser display only, not native preference persistence or stable installation.
- Existing Tauri 1 schema defaults Windows `allowDowngrades` to true; current config does not disable it. No real older-stable NSIS install was performed.
- Actual installed application was not opened, installed, updated or rolled back for this review. Stable feed availability, signed stable return, hardware use and native preference interaction remain runtime acceptance boundaries.

## Local r2 package/provenance

Current output: `tmp/production-beta/2026-10-10-beta7-optin-production-r2`; earlier beta.7 artifacts are superseded for this policy change.

Independent Node crypto verification used the compiled public key, Ed25519/Blake2b512 content signature and trusted-comment signature; metadata signature, installer signature and detached/embedded signature equality all passed. SHA-256/size checks passed for 29 runtime assets, 7 package files, 8 frozen working source inputs, 3 tests and 6 build/signed artifacts. Application PE FileVersion/ProductVersion are `2.0.1-beta.7`. Proof explicitly names a dirty working tree built on HEAD 87c2b19, not an immutable release commit. Build command/logs use production helper feature only, without `recovery-test-feed`. Original helper resource was restored with matching previous-resource hash.

- Installer SHA-256: `4520e9a0055de1e11cefd564f2fef4ed4e5b3b71f298ddf6f41b08a49138e724`.
- App EXE SHA-256: `38487ef3dc3a7b84981af04c432c2ca034a75a3cb08319ec9452cc2e82bd8666`.
- Built helper SHA-256: `9cb857aac3fff00024456ff62d9a4ff3ebd401deed6badf6deb44f3bedc668f0`.
- Evidence: `tmp/beta-optin-r2-independent-package-proof.json` and verification script beside it.

The beta.7 validation note correctly says prepared/not published/not installed. The ambiguous source_commit header was corrected to build_base_commit and explicitly identifies the uncommitted frozen working tree. Current production-proof.json SHA-256: `34804A35C599982D3FEB47EDE1DC454BD0A4866F797C7944D21199B37AE174F2`; its status-only revision does not change the verified artifacts or source inputs. No publication or stable acceptance is implied.

## Frozen source SHA-256

| Path | SHA-256 |
| --- | --- |
| index.html | 759CDF4815DC5724D5893BE5FE0855969BEBB205407BC5844938FF12960B91B8 |
| js/board-2.0.1-ui.js | 63A976CD281CA5016B14461E9FCC5692B10B953BF70FD0D3B363F6EE148EAD0C |
| js/updater-flow.mjs | A987CF990826532166ECC654FAFA8D984270E912EECE52D2B83B95DA5D76E632 |
| js/release-notes.mjs | B1FB221CD653DD85F6817B1520832D30E8A61309E313C358AB163C9B10CE2D94 |
| src-tauri/src/main.rs | 17164EAE62F4A47FE858FFC60BE1830A8ABFD67D4E7D233445F3CDE06135A60A |
| src-tauri/src/commands/update.rs | 7800A461E11CE3C564B8FFCB62BF2830728F1A4A98FA580DAC3A8C591CF2A4A3 |
| src-tauri/src/recovery.rs | 1E65DE9F6B360833B31FC8FF9FBE4AF1004BAC9D3B5DA2F88EFBEF4138CC208B |
| src-tauri/src/bin/boardcanvas-recovery.rs | EF0CF2E4A0F960B9099A2ACD1DE13F55D20A57E13DFEF54B0408134EDBB05C21 |
| tests/updater-flow.test.js | 804F705ACC6374C69316C78FAE867233C3FF674AED700888392F1F677D7F8B56 |
| tests/release-notes.test.js | 9EAA20A02A2D63799A536E8D6038A563C3242C21F6E895ADCCCCA03479B516D7 |
| tests/board-state.test.js | 773BE990D246D8C68EDA3C8AD6C2035C02E1B535B6A121F26D1949D3909B680B |
