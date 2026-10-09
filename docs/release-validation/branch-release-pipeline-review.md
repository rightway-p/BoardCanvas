# Branch release pipeline independent review

Review date: 2026-10-10 KST. Final verdict: **PASS** for frozen workflow/test source. No unresolved actionable finding or review blocker. Actual GitHub Actions build/deployment execution is still pending; this review did not dispatch, publish, install or update an app.

## Actors and execution

- Independent reviewer/executor: `/root/recovery_design_review`, separate from source implementer. Inherited high-capability Codex review; exact backend model ID is not exposed.
- Implementation: `/root/branch_release_pipeline`, orchestration explicitly selected `gpt-6-luna` / medium / fork none and successful start. Environment configuration: `/root/release_notes_implementation`, same selection/start metadata. Backend session UUID not exposed; none invented.
- Codex/Ponytail method: connected workflow/source review, actual embedded PowerShell branch/publication fixtures with external git/gh mocked, fresh temporary git tagger reproduction, final actionlint and targeted behavior tests. Existing package/runtime reviews reused without repetition.
- Actual AGY CLI, invoked by independent reviewer, `gemini-3.1-pro-high` / high effort / text-only:
  - Full corrected workflow snapshot: session `0a33f577-745c-469a-bbbb-deeb3fa9fb30`, exit 0, substantive SUCCESS, 75.530 seconds. Found incomplete-publish rerun false success.
  - Final bounded correction + exact final behavior tests + stable latest routing: session `e3b6bd1f-7627-4050-a25f-49c358b13631`, exit 0, substantive SUCCESS/NO_ACTIONABLE, 44.123 seconds. Final provided tests were explicitly checked to equal final source tail.
  - Logs `tmp/branch-pipeline-agy*`, `tmp/branch-pipeline-final-agy*`; final prompt SHA256 `8db14c7265eb885be1b9e738619f817cd58688011e386e685bbc4a1da5652930`.

## What the workflow does

`.github/workflows/signed-release.yml:8`: only pushes to dev/main that change package.json, Cargo.toml or tauri.conf.json trigger release work. CI-only bootstrap and ordinary JS/CSS-only same-version pushes do not publish. Manual dispatch rejects other branches and channel/branch mismatch. Validated exact triggering SHA is checked out again for build.

`.github/workflows/signed-release.yml:189`: beta uses dev-only environment; stable uses main-only environment plus reviewed record containing passed beta/hardware validation and named reviewer. Read-only validation has contents:read; build/release job alone has contents:write and environment secrets. Four versioned signed assets are published. No recovery-test-feed feature is requested. New immutable tags are created only after successful build/sign, without force; existing tags must resolve to source SHA.

`.github/workflows/signed-release.yml:76`: an existing release is not enough to declare rerun success. Draft/wrong-channel/missing assets fail closed. For current beta source, immutable and rolling JSON/signature pairs must match both SHA256s and expected version/channel. Stale pair, partial pair or unknown lookup stays explicit error, with manual verified recovery instructions; versioned installer/tag are not automatically overwritten. Superseded source does not change rolling feed/latest. Current stable rerun checks actual latest tag through supported gh output.

## Actionable findings / fixes

| Location | Repro / risk | Final resolution |
|---|---|---|
| workflow:29,269 | Parallel newer beta finishes then older beta overwrites rolling feed. | Same-ref concurrency, no running-job cancellation, plus remote source freshness guard. Lock alone is insufficient because queue order can differ from source chronology. |
| workflow:255 | Fresh runner has no tagger name/email; git tag -a fails. | Local GitHub Actions bot identity configured only before annotated tag. Independent empty-identity temp repo reproduced exit128. |
| workflow:199 | Interim publish guard read missing SOURCE_SHA and skipped every feed update. | Exact validated SHA inherited through job env; both publish steps receive it. |
| workflow:76 | Version release created but rolling upload fails; rerun gave green skip while feed remains stale. | Explicit complete-release/feed inspection, fail closed/manual trusted-pair repair. No new crypto dependency or silent auto repair. |
| workflow:132 | Metadata7 upload succeeds but sig6 remains; mere filename/version check falsely green. | Compare BOTH exact versioned/rolling file SHA256s; mismatch fails. |
| workflow:76 | Fully uploaded draft is not a completed public release. | Version/feed draft=false checks via gh API; draft behavior cases added. |
| workflow latest inspection | isLatest does not exist in gh release view JSON and was not requested. | Supported tag-omitted latest view with --json tagName, exit/error checked. |
| workflow:316 | Omitting --latest on superseded stable can still let automatic latest selection change pointer. | Explicit --latest=false for superseded source. |

All actionables above were implemented by the execution worker and verified against frozen source; reviewer did not edit implementation.

## False positives / rejected alternatives / limits

- AGY finding of rerun false success was valid. Its feed-first suggestion was rejected: publishing metadata before versioned installer availability can advertise a 404 URL. Existing create-first plus explicit failure/manual repair is the minimal accepted solution.
- A new cryptography package, automatic release replacement, force-tagging and broad release controller were not required. Exact-pair consistency checks are not mislabeled cryptographic verification of remote assets; operator repair must verify signatures and installer hash against existing trusted public key.
- Independent initial temp branch fixture needed UTF-16 output decoding under Windows PowerShell; this was a fixture issue, fixed without product changes. First snapshot branch cases and feed freshness cases are snapshot evidence, not final remote CI execution.
- No workflow execution success is inferred from actionlint, mocked commands or API configuration. No key values were output, downloaded or read back.

## Verification

- Final independent actionlint **1.7.12 PASS**, which parses YAML and checks GitHub expression/context syntax. Binary reused from existing Temp actionlint installation; no new dependency added to project.
- All eight embedded PowerShell multiline blocks independently parsed successfully.
- Independent final `node --test tests/release-packaging.test.js`: **3/3 PASS**. Includes actual extracted PowerShell with mocked remote calls: incomplete/draft version, draft feed, wrong version, mismatched signature, complete beta pair, superseded beta, complete stable latest, wrong stable latest. No actual publication calls executed.
- Independent first validator fixture: nine branch/version/channel/evidence/tag/error conditions; `tmp/pipeline-context-fixture-result.json`. Separate actual publish-script fixture verifies latest source uploads feed and superseded source preserves versioned release but skips feed; `tmp/pipeline-feed-fixture-result.json`.
- Parent/worker reports final full suite **131/131 PASS**, web build and diff checks PASS. Reviewer independently reran targeted tests/actionlint/diff, not redundant full app builds.
- Official GitHub concurrency guidance confirms source-dispatch ordering is not guaranteed: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency . Source freshness guard is therefore retained.

## Read-only operational configuration check

Actual GitHub API reads by independent reviewer:

- beta-release: custom branch policy dev only.
- stable-release: custom branch policy main only; required reviewer rightway-p/User3213798; prevent_self_review=false deliberately allows owner approval; final can_admins_bypass=false independently rechecked after strengthening. This is a real gate, not a claim that stable acceptance occurred.
- Each environment has secret NAMES TAURI_PRIVATE_KEY, TAURI_KEY_PASSWORD, TAURI_UPDATER_PUBLIC_KEY with metadata timestamps 2026-10-09T15:01:21–25Z. Names/timestamps only inspected; secret values cannot be read back and were not requested.
- Existing native package remains unchanged. Stable beta/hardware requirements remain pending where not evidenced. Actual Actions deployment and public downloads must be checked after authorized push; no native install/update by reviewer.

## Frozen files

| File | SHA256 |
|---|---|
| .github/workflows/signed-release.yml | f2f16a4aeae93cc7255b43982bf3f59838adc7002c0b2df859267c7179e2702c |
| tests/release-packaging.test.js | 08cf24a39a5d256cf0955cc5255949f959c43d1b869fb46278339da23c445f20 |

Verdict: Ship this workflow source unit. Actual CI run/publication acceptance remains pending and must not be recorded as already passed.