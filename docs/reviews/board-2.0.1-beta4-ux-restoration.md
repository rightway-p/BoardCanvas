# Board 2.0.1-beta.4 UX restoration review

Status: **independent source review complete — PASS (final floating-size correction included)**. All accepted findings resolved; historical reopened sections below are superseded by the final disposition.
Independent Codex/Ponytail reviewer, actual AGY executor and adjudicator: `/root/recovery_design_review`, separate from root and implementation CLI33174/gpt-5.6-luna. Source base f3ef06db58cf2a9672abf462586c556cf26189cd. Reviewer source-read only; only this record written, no implementation/commit/push/publish/install.

## Interim actionable findings

1. `js/board-2.0.1-ui.js:868–875`: Save replaces devSettingsDraft while rendered input/calibration/trial listeners keep captured old draft. First Save→edit again→Save loses later values. Initial ArrowRight-based browser reproduction is withdrawn: slider value did not actually change. Static stale-closure finding remains valid; it is not counted as runtime reproduction. Minimal fix keep correct shared draft reference or rebuild binding after Save; cancel single trial when saving.
2. `js/board-2.0.1-ui.js:834`: generic slider output appends ms for zoomSensitivity; dimensionless sensitivity must have no time suffix. Parent accepted targeted repair.
3. `js/board-2.0.1-ui.js:826–828`: removing overlay checkbox and showDevTouch makes stored showTouchOverlay unused, dropping prior touch location/radius/hold-time trial diagnostics. Parent explicitly requires preserving checkbox/value/diagnostics in isolated single-touch trial only, no presentation canvas diagnostics/devmodal resurrection.
4. Ponytail: old header/close/overlay DOM generated then removed is needless embedded-template work. Parent approved direct embedded markup cleanup with #3.

## Executed actual AGY scope / incomplete boundaries

- Initial direct prompts36,606 and48,024 characters failed to start (Windows argument transport; ResourceUnavailable). Failed attempts do not count as executed reviews; stale LASTEXITCODE0 metadata was not trusted without terminal result.
- Bounded exact-current JS render/trial/calibration/savecancel scope22,300 chars started successfully; conversation `3d56ba5b-d6fc-4127-a49e-1e6277268a05`, process PTY8847. Terminal result still pending at this record. AGY wrote only its private brain planning artifact, no project source. Preliminary artifact confirms stale-draft and units issues. Its claim tab change does not cancel trial is a false positive: tab onclick already calls cancelDeveloperTrial before render; final correction may cancel at render entry too for robust Save behavior.
- Companion exact HTML/CSS/version/tokens-doc diff30,560 chars actual AGY conversation `66075446-14f7-4e70-9714-d6b27c32c46b` SUCCESS/exit0,50.6777835s,1turn,input16435/output5005/thinking3717/cache8140/total21440. No actionable from that scope. It is static scope review, not proof of all narrow geometry/accessibility. Existing root geometry evidence and new root runtime checks remain operator-attributed.
- Parent-close helper hook, category-exit discard, four updater bindings, direct toolbar.children inert preservation, legacy internal classification keys/camera ratio preservation were read independently. Final fixes, focused regression coverage, actual narrow-window trial layout and final hashes still required. Native recovery/update source unchanged, previous reviews reused; not a new native implementation approval.

## Initial interim snapshot SHA256

Source changed while implementation/checks continued; these identify initial reviewed scope and are not final freeze hashes.
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\index.html`: `24D774BC4533B022A992917643BE1EF2FD9046A615D8368691A4957448838CA3`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\styles.css`: `D2005A5B1A7979BEFC963A8F6E478FFDD5E0D43FA5E8A29A78A9B6DE06AD8224`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\js\board-2.0.1-ui.js`: `C54AD430AC7BC30DDF8250DF99021C4335F795630ED03F60C4278FC557CFEC94`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\js\session-pdf-toolbar.js`: `A16A5330986D9189A1D3DE164BDEAA43633AF1B508A10DB9D0D31C6B1009FACE`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\docs\design-tokens.md`: `BD7C288B61AC48C53E2F4999FB31496336F3B40FD242B358278CAC550D8BF29B`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\tests\board-state.test.js`: `CC0B847603511AA9D751C22850C10B83AFB9D0085CA7F11C33ADF81FB4E2A02E`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\package.json`: `64684CDF7FF7851E805B565F638FF584E83840390C7AC88CBD02FDF252E7593B`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\src-tauri\Cargo.toml`: `EC545B632A9C6B67C04E441CF0E1117B77C32FBA7282B3DC1A3858C4DEE21A7B`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\src-tauri\Cargo.lock`: `1489F6D52A20F1C3E87D8B9BF6896834DC53ACFC672178EF50B9773D356E3B43`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\src-tauri\tauri.conf.json`: `E2129216B84D7CB98F20ACB5C393836910E9D06AFF857A8BA6667803B2C230D0`

## Interim JS actual AGY completed

Session3d56ba5b-d6fc-4127-a49e-1e6277268a05 reached terminal SUCCESS/exit0,148.0917731s,1turn,input48158/output18726/thinking12764/cache69259/total66884. Independent executor/adjudicator /root/recovery_design_review. Accepted stale-draft and sensitivity-units findings already delegated. Claimed tab-switch timer leak is false positive because actual tab handler cancels trial before render; Save/render cancellation improvement is valid separately. AGY produced private brain plan/walkthrough only; its wording that issues were resolved describes proposed sample code, not implementation verification. Its autoapproved-plan narrative does not authorize or prove project source edits. Reviewer does not copy that proposed code. Final source review remains incomplete pending worker fixes/hash freeze and bounded corrective AGY.

Root-attributed initial actual browser900x570: Aboutupdate44px, documents4cards, single/multi definitions/trial/thresholds, centered modal. Left12,12,34,546/right854,12,34,546/client544=scroll544; floating433,54,34,504; allcontrolsvisible/noscroll. Verticalplusy202/number226/minus250. Startmeasurement→About→Screen resets saved single tab. These are current interim operator observations, not final savecancel verification or hardware acceptance.

## Runtime evidence correction — final review still pending

Root withdrew initial ArrowRight reproduction because that interaction did not change the slider value. This does not invalidate independently traced stale-draft closure defect. After the worker fix, supported AXsetValue600ms/0.009→Save→close/reload→Screen preserved600ms and0.009. Root also observed reload sensitivity output0.009000000000000001 versus live0.009; display formatting must avoid long binary-floating text. These observations are operator-attributed, not reviewer-executed. Isolated overlay preservation, direct embedded markup cleanup and bounded sensitivity display fix are pending. No final PASS until frozen corrective source review+actualAGY+hash confirmation.

## Final corrective source and full scope disposition — PASS

- Independent Codex/Ponytail reviewer and actual AGY executor/adjudicator `/root/recovery_design_review`; separated from implementation33174/15458/35226 gpt-5.6-luna and root. Source freeze announced by root after35226 result96/96JS/web/syntax/diff checks. Reviewer independently read final rendering/savecancel/trial/feedback/formatter/tests and ancillary parent/category/gesture/updater flow, no source edits.
- All accepted actionables handled: Save uses Object.assign to preserve draft identity used by input/calibration closures and cancels trials; initial/live sensitivity is dimensionless fixed3decimal; saved overlay checkbox and isolated position/radius/hold-time feedback survive with proper timer/pointer cleanup; markup directly renders embedded content rather than creating discarded modal/header controls. No hidden7tap or devmodal resurrection, presentationcanvas diagnostics removed, data/storage keys and real camera ratio preserved. Legacy classification internal keys retained with correct user labels.
- Actual final corrective AGY session `b8af037e-276b-4af8-b79a-56da57c82249` SUCCESS/exit0,22.8792934s,1turn,input11913/output2573/thinking1975/cache8129/total14486. Exact20,416-character current changed functions+overlayCSS+new lifecycle test; no tools/plan/artifact. Response PASS, no unresolved actionable.
- Actual ancillary interface AGY session `27251f4f-55a8-47ea-b713-7361f976e4c0` SUCCESS/exit0,18.2696776s,1turn,input8224/output2061/thinking1753/cache8156/total10285. Exact8,656-character parent close/inert/category, single gesture.startedAt and four updater initialization bindings. Response PASS, no actionable. Previous full HTML/CSS/version/doc scope66075446 and unchanged trial/calibration scope3d56ba5b reused; changed overlayCSS covered final scope. Independent Codex read all10-file diff including test updates and confirmed finalhashes.
- False positives / limitations: old AGY tab-switch timer leak claim rejected because handler already cancels; later cancellation at render entry also protects other render paths. Initial ArrowRight alleged reproduction remains withdrawn, never restored as runtime proof. AGY broad claims of perfect tests/no security risk are not whole-product acceptance. No unconfirmed full-screen measurement or new sidebar categories introduced; no all23SVGpixel/nativehardware verification asserted.
- Root final browser supported AXsetValue evidence (isolated8773 browser, native user values untouched): firstSave700ms+overlayfalse→same-window secondSave800ms→close/reload800ms/false persisted; edit900ms→Cancel800ms restored; multi tab+pinch threshold20→Save→close/reloadmulti selected/20px persisted; initial/live sensitivity0.009 short output; checkbox accessible in normal Screen. Prior900x570 left/right/floating visible controls/no-scroll bounds above retained. Hardware two-pointer and actual pen-longhold behavior remain Sunday validation, not asserted here. Worker96tests/web/syntax/diff passed; production native/helper builds and public beta.4 install/deploy remain root steps separate from source PASS.
- Every accepted finding in this delta is handled and both independent review paths actually executed successfully. Source PASS permits already-authorized production build/public beta update validation, not stable/hardware acceptance. Reviewer wrote only this record; no implementation, staging, commit, push, publish or installation.

### Final source SHA256

All10 source hashes rechecked unchanged after final actual AGY against prompt snapshot. Initial snapshots remain historical above.
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\index.html`: `24D774BC4533B022A992917643BE1EF2FD9046A615D8368691A4957448838CA3`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\styles.css`: `0279AE4285F298A2694AF1AC4EE2AEB704BD9F56DC3C3911C626E6573F87FA79`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\js\board-2.0.1-ui.js`: `455FB2A79E241FE65B369F04B04B1A21BBFC69F3B198C0F00249941B0D22C63C`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\js\session-pdf-toolbar.js`: `A16A5330986D9189A1D3DE164BDEAA43633AF1B508A10DB9D0D31C6B1009FACE`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\docs\design-tokens.md`: `BD7C288B61AC48C53E2F4999FB31496336F3B40FD242B358278CAC550D8BF29B`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\tests\board-state.test.js`: `8233B5E52F2B2A9D9BE62C40C8C7FAF441C94EC1C0C5407FDEAC145A8799E305`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\package.json`: `64684CDF7FF7851E805B565F638FF584E83840390C7AC88CBD02FDF252E7593B`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\src-tauri\Cargo.toml`: `EC545B632A9C6B67C04E441CF0E1117B77C32FBA7282B3DC1A3858C4DEE21A7B`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\src-tauri\Cargo.lock`: `1489F6D52A20F1C3E87D8B9BF6896834DC53ACFC672178EF50B9773D356E3B43`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\src-tauri\tauri.conf.json`: `E2129216B84D7CB98F20ACB5C393836910E9D06AFF857A8BA6667803B2C230D0`

## Final visual-label finding — reopened

Independent reviewer directly inspected tmp/beta4-browser-single-trial.jpg1280x720. P2 actionable within user text-break/readability requirement: range label splits Korean word 시간 into 시 / 간; the checkbox inherits range-style three-column label grid, separating box from its description roughly140px. No clipping/overlap/data or function failure claimed. Recommend surgical CSS keep-all word wrapping on touch labels and flex alignment only for the existing dev-other first checkbox label; avoid nowrap and wider toolbar/layout redesign. Source PASS reopened only for this delta and post-fix geometry/hash/actualAGY; already built signed but unpublished beta4 assets must not be treated as final corrected release. Reviewer no source edit.

## Final narrow Korean text/checkbox correction — source PASS

- Independent Codex/Ponytail reviewer/actual AGY executor and adjudicator /root/recovery_design_review. Separate worker36991/gpt-5.6-luna made only scoped CSS change: touch-settings-card label word-break:keep-all, dev-other first checkbox label flex/justify-start/token-gap. No nowrap, markup/JS/test/toolbar/state/input changes. This preserves ordinary word wrapping, keeps checkbox description adjacent, and leaves slider/calibration grids unchanged. Prior accepted visual P2 handled; no new actionable.
- Actual AGY session `4de45527-b110-4a66-89c0-c10957638352` SUCCESS/exit0,14.3669828s,1turn,input6781/output1473/thinking1187/cache8107/total8254. Bounded exact two-rule CSS+relevant cascade context, no tools/artifacts/implementation. PASS. Broad AGY rhetoric about perfect accessibility is not whole-runtime/hardware acceptance.
- Final CSS hash rechecked unchanged after actual AGY. Other9files unchanged from final10-file snapshot above; previous fullreviews reused. Source independent review complete/PASS; root final1280/570 screenshot confirmation and corrected production build remain separate runtime/release evidence. Old signed unpublished folder2026-10-06-beta4-ux-reviewed is excluded with NOT_FOR_RELEASE.txt; corrected output uses2026-10-06-beta4-ux-reviewed-final. No publicbeta4/stable/install claim from reviewer.
- Final `styles.css` SHA256: `663E092D0908926A0089989C2833B8BE3F9DFFD1B11BBA46C38CF70DBDC81A68` (supersedes earlier CSS hash only).

## Final-size floating toolbar finding — reopened

Root actual1280 screenshot tmp/beta4-browser-single-trial-final.jpg confirms Korean time label wraps betweenwords and checkbox adjacent, previousvisualP2 resolved. New root actual900x570floating433,54,34,504→viewportreset1280x720+reload savedfloating restoration gives433,54,50,696 and Settingsbottom753>720, control unavailable; leftdocking remainsreachable. Independent read-only source diagnosis: initToolbarLayout clamps before finaldynamictoolbar size; toolbar ResizeObserver later calls updateBoardViewport but its floating earlyreturn does not reclamp. P2 actionable user all-controls-reachable/no-scroll requirement. Minimal reuse: validfloating updateBoardViewport branch invokes existing setToolbarFloatingPosition(savedX,savedY,false) usingcurrent measuredheight, keeps inset/canvas behavior; no settings/storage/toolbarUI redesign. Null guard must precede setter. SizeObserver notpositionobserver, setter only schedulespanfit so no directrecursiveviewportcycle. SourcePASS reopened for focusedfix/actualAGY/hash/runtime. No publicbeta4posted, priorbuiltassets excluded. Reviewer source unchanged.

## Final floating-size correction and frozen source disposition — PASS

- Independent Codex/Ponytail review and actual AGY execution/adjudication: /root/recovery_design_review, separate from root and cheap implementation CLI48974/gpt-5.6-luna. Exact updateBoardViewport nullguard/floatingexisting-setter(false) change plus meaningful real-setter regression test reviewed. This reuses existing clamp function after actual toolbar size changes, without storage mutations/UI redesign/dependencies. No new actionable, no cycle observed: setter schedulespanfit only and position variables do not create a size observer recursion.
- Actual AGY session `6d44344c-b202-4589-ba7d-c256ab7869ac` SUCCESS/exit0,14.5439804s,1turn,input7240/output1569/thinking1408/cache8110/total8809. Bounded exact changed function/test and relevant prior setter behavior; response PASS. Prior full10-file/JSrender+calibration/HTMLCSSversion/ancillary interface/Korean text reviews reused for unchanged scope. AGY universal praise not adopted as all-product acceptance.
- Root actual supported repro now passes:900x570floating433,54,34,504→1280x720reset/reload433,12,50,696, Settings679..711, allcontrolswithinviewport and Settingsclicks; back900x570/reload433,54,34,504, controlsreachable and Settingsclicks. Reviewer directly viewed tmp/beta4-browser-floating-restored-final.jpg and corroborated fulltoolbar/settingsvisible. Root1280 and570 word/checkbox screenshots also pass; sourcewrap/checkboxP2 resolved. No new native user data/input manipulation by reviewer.
- **Geometry metric correction:** toolbar overflow is visible, no scrollbar;1280scrollHeight698/clientHeight694 are not equal and are not used as a no-scroll proof. Current acceptance uses actual absence of toolbar scrollbar and viewport bounds for each control. Earlier compact measurements are historical only. General hardware touch/pen/remote remains Sunday validation.
- Worker final97/97JS/web/syntax/diff checks pass. All accepted findings handled, both independent review paths actually executed successfully, final10 hashes rechecked unchanged after last actualAGY. Source review complete/PASS, permits authorized correctedproductionbuild/publicbeta4update test; no stable/hardware/publicinstall completion asserted yet. Earlier two signed output folders are NOT_FOR_RELEASE/superseded; final root output2026-10-06-beta4-ux-publish-final only. Reviewer wrote only this record, no source/staging/commit/push/publish/install.

### Final10-file source SHA256 after last AGY
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\index.html`: `24D774BC4533B022A992917643BE1EF2FD9046A615D8368691A4957448838CA3`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\styles.css`: `663E092D0908926A0089989C2833B8BE3F9DFFD1B11BBA46C38CF70DBDC81A68`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\js\board-2.0.1-ui.js`: `FB651E3EFC1B25C3C78D6C72269A9A74F99061D0972F09AEF84F6654206611B9`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\js\session-pdf-toolbar.js`: `A16A5330986D9189A1D3DE164BDEAA43633AF1B508A10DB9D0D31C6B1009FACE`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\docs\design-tokens.md`: `BD7C288B61AC48C53E2F4999FB31496336F3B40FD242B358278CAC550D8BF29B`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\tests\board-state.test.js`: `914818B9F5D040EB165CA43A8038C6070EC09483406E635DBADB79F417C0C7FA`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\package.json`: `64684CDF7FF7851E805B565F638FF584E83840390C7AC88CBD02FDF252E7593B`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\src-tauri\Cargo.toml`: `EC545B632A9C6B67C04E441CF0E1117B77C32FBA7282B3DC1A3858C4DEE21A7B`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\src-tauri\Cargo.lock`: `1489F6D52A20F1C3E87D8B9BF6896834DC53ACFC672178EF50B9773D356E3B43`
- `C:\Users\pjd01\.codex\worktrees\board-2-0-1\Board\src-tauri\tauri.conf.json`: `E2129216B84D7CB98F20ACB5C393836910E9D06AFF857A8BA6667803B2C230D0`
