# Session persistence repair review

Status: **SOURCE REVIEW PASS (2026-10-07 final corrective scope)**. Independent Codex/Ponytail, actual guarded-entry browser validation and substantive AGY code/tests reviews completed; all actionable findings below are corrected. Historical failure/blocker entries remain for provenance. Installed beta.6/native Web Locks/public update/rollback and hardware acceptance remain pending; source PASS does not claim those results.

## Independent executors and initial reviewed scope (historical)

- Codex/Ponytail reviewer and isolated browser fixture operator: `/root/recovery_design_review`, separate from implementation and parent native operator; inherited high-capability GPT-6 review role.
- Implementation: parent-assigned cheap workers `session_persistence_fix` and `session_finalize`; reviewer changed no product source.
- Actual AGY model: `gemini-3.1-pro-high`, effort `high`, executed by this independent reviewer through installed CLI.
- Frozen `js/session-pdf-toolbar.js`: SHA256 `C3288185E2E1D3008F2130857AD591ABA74241A3418E242558C4A41FFBC5EC66`.
- Frozen `tests/session-restore.test.js`: SHA256 `6BAB35C4DBAEDCEE8FE6F9AB68086569CF861B1F7A3382EC08182AD3C6142B79`.

## Actionable findings and disposition

1. Original A→B race and localStorage failure mixed saved JSON/PDF were reproduced independently before implementation. The single writer, captured byte identity, atomic original-pair backup and failed/stale commit rollback address these paths. Deferred A→B/A→blank and quota tests pass.
2. A failed rollback previously held persistence silently. Parent confirmed this violated the agreed protocol. The final existing hold setter now emits one warning on false→true; regression checks pause/original-backup warning once, subsequent writes blocked and no success status. Fixed in the frozen scope above.
3. Unit tests mock all three new IDB helpers and alone do not prove transaction behavior. Parent requested a separate actual-helper fixture; reviewer executed exact production helpers in a fresh isolated Edge/Playwright IndexedDB origin. Ten assertions passed. This closes the validation gap without adding a production dependency or claiming the unit mock itself tests IndexedDB.
4. **Confirmed competing-context cleanup deletes another writer's pending backup.** Same-context queue does not serialize another tab/WebView. Existing dedicated overlay creates a second WebviewWindow with the same URL origin (`runtime-overlay.js:817–865`), and `events-init.js:393/414/426` restores/saves without a context ownership restriction. `tmp/session-cross-context-review.cjs` executes actual IDB helpers in two fresh same-origin pages: A reads a committed backup then pauses before cleanup; B stages C over saved B; A deletes B's new pending backup; B's forced recovery reports true with JSON B/PDF C and no backup. Result: `{"recoveryReturned":true,"raw":"B","pdf":[67],"backupPresent":false,"expectedOldPdfByte":66}`. Parent notified. Required disposition: exclusive cross-context save/recovery ownership using a verified standard lock or existing sole-writer handoff; no schema2/global controller mandated.

## Independent validation and limits

- `node --test tests/session-restore.test.js`:20/20 PASS independently on both initial and final warning-inclusive repair. Parent workers report final20/20 and whole122/122 plus web build/diff PASS.
- `tmp/session-real-idb-review.cjs`, result `tmp/session-real-idb-review-result.json`: actual production `openSessionDatabase`, backup/stage, recover and commit-marker bodies; real browser IndexedDB transactions. Final12 PASS assertions cover stage backup, uncommitted torn-pair restoration, forced rollback after a commit marker, committed fixed-key cleanup, aborted stage, aborted rollback retaining the original backup, retry restoration and failed pending-backup read returning false without deleting it.
- Failure injection changes only transaction abort/readonly-failure behavior; helpers are not replaced by fake success implementations. Context is fresh and isolated; no user/native profile, installed app, journal or presentation data accessed.
- This is graceful pair-preservation/recovery evidence, not a hard-kill atomicity proof across localStorage and IndexedDB, not hardware or managed update/rollback acceptance.

## Ponytail / false positives

- Reuses existing session file, schema1, fixed `last-pdf`, existing status display and IndexedDB store. No new controller, framework or dependency needed.
- Temporary quota preflight is conservative because it temporarily stores another JSON value; a false save result can occur before a replacing write would hit quota. It preserves existing data and is an intentional safety tradeoff, not a demonstrated mixed-pair defect.
- Legacy-reader process-crash recovery is not guaranteed by the new pending-backup key. Do not claim crash atomicity or silently promote schema2. The normal verified graceful update path awaits successful persistence first.
- Existing unused `saveSessionPdfBytes`/`clearSessionPdfBytes` definitions remain cleanup candidates after reference checks; they are not a required architecture expansion in this repair.

## Actual AGY execution history

- Initial20427-character prompt: PTY61184; conversation `9c6080bb-f614-4b5a-81d2-18c8d0aaee00`; exit0/frameworkSUCCESS with **empty response** and stderr `print timeout after4m0s with turn in progress; returning partial output`. **Rejected as incomplete**, not PASS. Logs: `tmp/session-persistence-review-agy*`.
- Bounded retry helper PTY26906, conversation `9a9b45bd-9c22-4a4d-b10b-fb2ca864676b`, substantiveSUCCESS165.249s: three competing-context races consolidated into actionable4 above. Queue protects normal same-context callers, but actual supported second-context path exists. Speculative extra WAL/quota cost is an unmeasured graceful-failure tradeoff; no extra storage subsystem required solely from this assertion.
- Bounded retry writer+warning PTY99368, conversation `91daffd6-bfad-435b-a8e1-ff110b73d284`, substantiveSUCCESS124.223s: alleged post-commit missing-backup hold is **false positive**. Actual `markSessionWriteCommitted` retains the backup with `committed:true`; real IDB forced-rollback-after-marker assertions prove old pair restores. Recommendations to remove stale identity guards contradict the agreed stale-save=false/original-pair-preservation contract and are rejected with the A→B regression evidence.
- Bounded retry tests PTY66856, conversation `c8179758-aa47-42c7-a400-f12842738390`, substantiveSUCCESS155.893s: alleged test8 early failure is **false positive**, confusing `restoreSessionState`'s recovery entry with `persistSessionState`. Actual persist does not call recovery first; final20/20 execution and retained-backup assertions demonstrate the intended rollback-failure path.
- Logs: `tmp/session-persistence-agy-{helpers,writer,tests}*`. These actual reviews completed, but their confirmed actionable is unresolved; therefore source PASS is withheld.

## Next closure

Resolve cross-context ownership, rerun the focused competing-context fixture through the real guarded entry, review only the corrective delta and recheck new frozen hashes before source PASS. Native beta5 manual baseline establishment is a separate operator activity; it is not evidence that this unshipped repair has passed an installed managed update or rollback.

## Corrective locked-entry review (2026-10-07)

Current product source SHA256331952183BF62C37D60C98E1D418C0FB7E940CEDD2265920C537AB586521690E. Implementation executor `session_cross_context_fix`, actual cheap CLI `gpt-6-luna`, medium, session01a1142a-eb19-70f3-abac-e54f399d7611, exit0. Independent reviewer remains `/root/recovery_design_review`; no product edits. The whole save/recovery and startup JSON/PDF pair read now use origin-scoped `board-session-persistence-v1` exclusive Web Locks. Every writer stages its captured bytes even dirty=false; missing/rejected locks hold persistence without mutations. Parent-approved redundant localStorage quota probe removed; actual commit failure uses retained IDB original-pair rollback. Uncalled raw byte writer/clear helpers removed after caller search.

Actual guarded entry fixture `tmp/session-locked-entry-review.cjs/result.json`: two fresh isolated HTTPS Edge pages, real Web Locks/IndexedDB/localStorage. Six checks PASS: guarded save, restore waits other writer, matching captured JSON/PDF read, clean writer restores its own captured bytes after another writer changed cache, actual native QuotaExceededError restores last good pair, missing locks fail closed. Rendering only stubbed; no native/user profile, sensor or hard-kill claim.

Actual AGY final product logic: PTY8768, conversation `c85ee4cc-0978-4bee-a9c5-0c409f8e96e2`, gemini-3.1-pro-high/high, exit0, substantiveSUCCESS114.281s, NO_ACTIONABLE_FINDINGS. Its broad descriptive words “atomic/perfect” are not adopted as crash guarantees; both stores remain separate and unsupported-lock handling is intentionally conservative.

Actual AGY final tests: PTY38673, conversation `5a71210c-14c6-4d80-b17b-16a5980383c6`, same model/high, exit0, substantiveSUCCESS124.209s. Accepted validation gap: restore test must assert the writer's final shared bytes and demonstrate writing while rendering remains pending. Rejected literal advice to assert newer bytes immediately inside render: that assumes a specific scheduling order. A deterministic render gate is the minimal valid correction. Test-only correction pending; no production change needed. Source logic PASS alone does not close the paired test review yet.

## Local beta.6 package and factual documentation inspection

Independent reviewer checked nineteen frozen source files, four signed assets and two binary hashes against `tmp/production-beta/2026-10-07-beta6-production/production-proof.json`; no mismatches. Existing minisign_verify rlib (no new dependency/product edits) was used by temporary `tmp/beta6-signature-review.rs`: metadata and actual installer signatures verify against current public key, and each altered-byte copy is rejected. Evidence `tmp/beta6-signature-review-result.txt`. This is stronger than signer-success output; no helper install/bootstrap or journal access performed.

Final proof corrected to SHA2568AA6D6DC84BDEC8353EFB83A769CAB1E52DF4E00568E58235DA8E16104A1B21F; validation note SHA256C098DF92AF0AD3D821EFC46FC42524CE00FDE05DB337158B64E575671B5901B4. Build base95376a8 is explicitly dirty: file hashes identify uncommitted beta.6 inputs, not a falsely attributed release commit. Application800128DE… is upcoming beta.6, distinct from separately evidenced manually installed production beta.5 D754044A…. No installed/public beta.6 update, rollback, native Web Locks capability or hardware/OAuth acceptance is claimed.

Docs-only actual AGY PTY23432, conversation `b350e1f8-8508-473a-bd95-8d334774a09b`, gemini-3.1-pro-high/high, exit0, substantiveSUCCESS25.569s, NO_ACTIONABLE_FINDINGS. Its prompt covered validation/proof provenance and the final actual architecture evidence appendix. One subsequent proof-hash reference correction in the note was independently checked as literal metadata only. Historical failed/timeout and competing-context findings above remain preserved; final corrective test closure follows below.

## Final corrective closure — SOURCE PASS

Final test SHA25637CE0BDB651292325BA1311CEE84F9BCB72D93E3F99964C76651DCE60500A1D9; product source remains331952183BF62C37D60C98E1D418C0FB7E940CEDD2265920C537AB586521690E. Cheap executor beta6_package corrected only the existing restore test: deterministic render entry/gate, writer completes and shared writer JSON/[8,9] asserted while reader render remains blocked, then reader captured paired.pdf/[4,5] asserted. Node standard timeout2000 detects a lock-held-through-render deadlock. No production edits/rebuild required. Independent target23/23 PASS; executor full125/125 PASS.

Final bounded actual AGY: PTY40875, conversation `4c71038a-8618-4acb-8fc9-61c479aa8361`, gemini-3.1-pro-high/high, exit0, substantiveSUCCESS51.234s, NO_ACTIONABLE_FINDINGS, prompt2978 characters. Exact final test hash recorded in `tmp/session-persistence-agy-test-barrier-meta.json`; logs share that prefix. This closes the accepted validation gap; the proposed immediate scheduler-dependent render assertion remains a documented false positive. All actionable code, warning, cross-context and assertion findings in this review are now fixed and independently rechecked. The empty first timeout was not counted as successful review.

Final documentation-only literal/provenance updates independently checked: proof SHA2568417553305F0A1FCB173D43C6BC60385DDB8A93C66F813D43AE3DE20EE586E05; validation SHA256D55BC93CE9E712792E5D2DAE19AD1F079CC1C7E6F31A931EED5078CC74A0EB2C. The later test-only correction is explicitly distinguished from unchanged production build inputs. Rechecked nineteen source files/four assets/two binaries: no mismatches (`tmp/beta6-independent-package-hashes.json`). Previously verified signature bytes and installer hashes remain unchanged. Docs/provenance AGY b350e1f8 coverage reused; subsequent literal hash/test-only provenance corrections introduce no completion promotion.

`docs/ARCHITECTURE.md` now records actual minimum owner closure, canonical ink+camera commit, controlled replacement/lifecycle paths and real capability limits; older root proposal is preserved. No new global controller/module relocation/schema2/dependency is mandated. This reviewer authored only review/architecture records and isolated verification artifacts, never product implementation, install/journal or external publication.
