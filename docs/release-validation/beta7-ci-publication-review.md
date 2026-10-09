# beta.7 CI publication — independent operational review

Status: CI fix paired source review PASS; first public attempt failed and beta.7 publication verification remains pending until a corrected CI run succeeds.

Independent reviewer/operator: `/root/recovery_design_review`, separate from implementation and CI dispatch. Exact inherited backend reviewer model/session ID is not exposed. This record performs read-only operational verification, not installation or release publication.

## Actual first run

- Signed Windows release run `37954237796`, push event, triggering SHA `2ed4ce0b055292a3a14166651375d96ea559129f`: completed/failure.
- Validate job `113900539779` failed at release-context validation; build-and-release was skipped.
- `gh release view v2.0.1-beta.7` returned release not found at review time.
- Desktop Build `37954237765` was still in progress at first observation; its result is separate from signed publication.
- Failed log retained at `tmp/beta7-ci-initial-failed.log`.

## Confirmed actionable

`.github/workflows/signed-release.yml:89` permits the expected missing version-release `gh api` HTTP 404, but leaves native `LASTEXITCODE=1`. On a new beta release, subsequent validator work is PowerShell output writes; GitHub's pwsh wrapper exits with the remaining LASTEXITCODE. Thus a legitimate first publication fails without an explicit throw message.

Reviewer used actual read-only `gh api` on the missing public beta.7 release and a pwsh subprocess with the GitHub-style epilogue. Evidence `tmp/beta7-ci-404-wrapper-repro.ps1`: `allowed404ReachedEnd=True lastExit=1`, `actualWrapperExit=1`. No simulated installer or fixture-signature assumptions were used.

Recommended smallest correction: explicit success exit at the completed validation path; preserve all throws/non-404 lookup failures. Add a meaningful new-release 404 replay including the actual pwsh epilogue (existing replay cases cover already-published releases only). Implementation and paired source review of that correction remain pending.

Existing opt-in/native/UI paired review PASS is unchanged. Local r2 package hashes must not be assumed equal to a future GitHub runner build. Final public verification must independently inspect tag/target/prerelease/non-draft status and download four versioned assets plus the two rolling metadata files, verify signatures/trusted comments against existing public key, and compare canonical/rolling pairs.

Actual user install, native beta-toggle behavior, beta→older-stable return and hardware acceptance remain pending; reviewer will not open or modify the installed app.
## Frozen corrective source review

Implementation actor: `/root/branch_release_pipeline`, orchestration-selected `gpt-6-luna`, medium, successfully started; backend UUID not exposed. Independent reviewer and actual AGY operator remain `/root/recovery_design_review`.

The confirmed actionable is fixed by one explicit `exit 0` after successful validation/output writes. The fixture now includes the exact successful-validator tail and GitHub pwsh epilogue; expected release 404 succeeds and API 500 fails closed. Independent Codex/Ponytail found no remaining actionable: all preceding validation throws remain before the success exit, and signature/immutable-release/branch/stable gates are unchanged. No false positives or deferred source findings.

Actual AGY `gemini-3.1-pro-high`, high effort: conversation `92b0f577-3fc3-45d8-8e61-ce1d6529e12f`, exit 0, substantive SUCCESS/NO_ACTIONABLE, 67.613 seconds. Provided-source-only prompt had 18,700 characters, with complete validation body and two-file diff. Evidence `tmp/beta7-ci404-final-agy.jsonl`, stderr/meta/prompt beside it. No source editing or release dispatch was authorized to AGY.

Independent execution: packaging tests 3/3 PASS, actionlint 1.7.12 PASS. These tests exercise mocked API output/native exit semantics; the preceding actual gh/pwsh reproduction separately proves the original failure. They do not substitute for a real GitHub rerun or public asset verification.

Frozen SHA-256:
- `.github/workflows/signed-release.yml`: `2BF4B467A24B1718B7EDECB7009819FB9422A5FD1436166BD3EF2CA353D778C0`.
- `tests/release-packaging.test.js`: `8E701023799A36C072E4830F4CF89C08006320A8E0EBF9D396BE4AC3F4DFAA3F`.

Next operational gate: rerun corrected publication, then independently verify its actual CI-produced signed public artifacts. Local r2 installer hashes must not be used as evidence that a separate CI build matches.