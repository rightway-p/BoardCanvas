# Board 2.0.1 Antigravity broad source review

## Completed source review and final fix rechecks

- Independent executor: Codex subagent /root/policy_review.
- Reviewer: official Antigravity CLI 1.2.14, gemini-3.1-pro-high, effort high, plan mode.
- Successful session: bcf9d5c2-3324-452e-b0e5-c7fd41a54d94; status SUCCESS; exit code 0; substantive response received.
- Snapshot captured: 10/02/2026 03:29:51; 26 numbered source/test/config files plus remaining CSS/package diff, 284088 characters.
- Baseline: 6db75496c2de02072070ac10170e979c39bce938; includes uncommitted tracked and untracked source.
- Delivery: official stdin stream-json; model reviewed provided source only. Tool steps observed: 0. No permissions changed or bypassed.
- Scope: broad frontend and native code review; not runtime verification or final PR approval. Source was still changing after capture.

## Executor triage caveats

- Current source must be rechecked before retaining the two old findings (preset cancellation and Drive connected label); implementation was concurrent.
- Duplicate replacement requests overwriting an unresolved promise is a concrete control-flow concern. The reviewer's stronger claim that the payload must remain permanently GC-rooted is not established merely by an unresolved promise.
- Download-before-confirmation increases avoidable memory use and work, but the label memory DoS and exact OOM threshold were not independently reproduced. Prefer moving download into the approved callback without claiming all large-file memory risks are solved.
- The suggested rollback/autosave reproduction using a password-protected PDF is not sufficient: parsing failure occurs before replacementBackup is installed. Actual rollback paths and existing scheduled/beforeunload saves need inspection before treating this as a confirmed finding.
- Documentation of memory cost is not user acceptance of data loss. The reviewer's accepted-risk labels are assessments, not approved waivers.
- All fixed classifications below are source-review opinions about the captured snapshot and require targeted final rechecks, particularly rotated/cropped PDF output.

## Antigravity response (verbatim)

# Board 2.0.1 독립 리뷰 결과 (Antigravity)

본 리뷰는 제공된 Board 2.0.1 소스 스냅샷(기준 커밋 6db7549)을 바탕으로, 도구 실행 없이 텍스트 기반으로만 수행된 코드 리뷰입니다. 명시된 보안, 데이터 무결성, 네이티브 연동 안전성 등의 우선순위에 따라 식별된 새로운 결함 및 기존 Codex 리뷰의 조치 결과를 분류했습니다.

## 1. 이전 리뷰(Codex) 조치 결과 확인

제공된 소스 코드를 바탕으로 Codex가 지적했던 10개의 결함에 대한 현재 수정 상태를 확인했습니다.

### 수정 완료된 결함 (Fixed)
- **[Fixed] P1 - 레거시 키보드의 PDF 페이지 식별자 불일치:** `js/events-init.js`에서 키보드 네비게이션이 `goToBoardPage`를 호출하도록 수정되어 페이지 식별 로직이 통합되었습니다.
- **[Fixed] P1 - 보조 터치 이동 시 활성 펜 스트로크 오염:** `js/render-doc-draw.js`의 `handlePointerMove`에서 `BoardState.isActivePointer` 검사가 추가되어 보조 입력이 차단되었습니다.
- **[Fixed] P1 - 새 다중 페이지 PDF 내보내기 시 미방문 페이지 누락:** 로드 즉시 `boardPageSequence.forEach`를 통해 모든 페이지에 `pdfWorldSize`가 초기화되어 방문하지 않은 페이지도 문제없이 내보내기가 가능해졌습니다.
- **[Fixed] P1 - PDF 렌더링 지연 완료가 빈 칠판을 덮어쓰는 문제:** 페이지 이동 및 빈 칠판 전환 시 `pdfRenderToken`을 증가시키고 기존 태스크를 취소(`stopPdfRenderTask`)하도록 보호되어 안전해졌습니다.
- **[Fixed] P1 - 활성 스트로크 중 페이지 이동 시 엉뚱한 페이지에 잉크 저장:** 페이지 이동(`goToBoardPage`), 패닝 모드 변경 시 `finishActiveBoardInput()`이 선행 호출되도록 수정되었습니다.
- **[Fixed] P2 - 회전/크롭된 PDF 내보내기 시 방향 및 좌표 어긋남:** `js/board-export.js`에서 `imageX`, `imageY`, `pageMinX` 등 PDF-lib 임베딩 시 회전된 원본 뷰포트를 정확히 계산하여 잉크를 얹도록 수정되었습니다.
- **[Fixed] P2 - 빈 페이지 내보내기가 현재 뷰포트에 의존함:** 내보내기 시 `entry.worldSize`를 기반으로 저장된 프레임 비율을 계산하여 내보내도록 수정되었습니다.
- **[Fixed] P2 - 원격 모드 전환 시 활성 패닝 제스처 멈춤:** `setPanMode` 호출 시 현재 입력을 종료시키는 방어 코드가 추가되었습니다.

### 미해결 결함 (Open / Stale)
- **[Open] P2 - 버튼 밖에서 포인터 해제 시 프리셋 편집 타이머 누수:** `js/presets-ui.js:184-191`에서 여전히 `pointerdown` 시 포인터 캡처(`setPointerCapture`)나 `pointerleave` 이벤트 처리가 누락되어 있습니다. 버튼을 누른 채 영역 밖으로 포인터를 이동한 후 떼면 3초 후 여전히 편집 창이 열리는 버그가 남아있습니다.
- **[Open] P2 - Drive 캐시 확인 성공이 인증된 연결 상태로 오인됨:** `js/board-2.0.1-ui.js:28`의 `refreshDriveStatus`는 인증 여부와 무관하게 로컬 캐시 조회만 성공하면 무조건 UI에 `status.textContent = "연결됨"`을 출력하는 문제가 방치되어 있습니다.

---

## 2. 신규 발견 결함 (New Actionable Findings)

네이티브 통합, 비동기 상태 경합, 데이터 무결성 측면에서 새롭게 식별된 구체적인 결함입니다.

### [P1/P2] Drive PDF 가져오기 시 메모리 DoS 및 비효율적 다운로드
- **파일/라인:** `js/board-2.0.1-ui.js:52-54` (`importDrivePdf` 내부)
- **재현:** Drive PDF 목록에서 대용량 PDF를 클릭합니다.
- **문제점:** 현재 코드는 사용자에게 기존 작업 대체 여부(저장/취소 대화상자)를 묻기 **전에**, IPC를 통해 전체 파일을 Base64 문자열로 가져온 뒤 `Uint8Array`로 미리 변환하여 메모리에 상주시킵니다. 사용자가 대체를 취소하거나 화면을 장시간 방치하면 수십~수백 MB의 무의미한 메모리 할당이 유지되어 OOM(Out of Memory)을 유발할 수 있습니다.
- **최소 수정:** `invokeDrive`를 이용한 다운로드 및 바이트 배열 변환 로직을 `requestBoardWorkReplacement`의 콜백 함수 내부로 이동시켜, 사용자가 파일 대체를 '승인'한 직후에만 실제로 데이터를 메모리에 적재하도록 지연 실행해야 합니다.

### [P2] 작업 대체 대화상자의 비동기 상태 경합 (Promise Leak)
- **파일/라인:** `js/board-2.0.1-ui.js:255` (`requestBoardWorkReplacement` 내부)
- **재현:** Drive 파일 목록에서 두 개의 다른 파일을 연속으로 빠르게 더블 클릭하거나, 대화상자가 열린 상태에서 단축키 등을 통해 다른 파일을 다시 엽니다.
- **문제점:** 기존 대체 대기 요청이 존재하는데도 방어 로직 없이 `pendingWorkReplacement` 및 `pendingWorkResolve` 변수를 강제로 덮어씁니다. 이로 인해 첫 번째 클릭에 의해 생성된 Promise가 영원히 해결(resolve)되지 않으며, 해당 클로저에 묶인 대용량 파일 데이터가 가비지 컬렉션(GC)되지 않는 심각한 누수가 발생합니다.
- **최소 수정:** 함수 진입 시 `if (pendingWorkResolve) { pendingWorkResolve(false); }`를 실행하여 이전 요청을 명시적으로 취소(reject/resolve) 처리하거나, 대화상자가 이미 활성화되어 있으면 새 요청을 무시하도록 방어 코드를 추가해야 합니다.

### [P3] PDF 로드 실패 롤백 후 자동 저장(Autosave) 호출 누락
- **파일/라인:** `js/render-doc-draw.js:358-380` (`loadPdfFromFile`의 catch 복구 블록)
- **재현:** 칠판에 새로운 잉크를 그린 직후, 비밀번호가 걸려 있거나 손상된 PDF 파일을 드래그 앤 드롭으로 엽니다.
- **문제점:** 예외 처리 로직(`if (replacementBackup)`)이 이전 PDF 파일, 칠판 잉크 상태, 화면 위치 등을 메모리에 완벽하게 복원합니다. 그러나 복원 후 상태(`sessionPdfBytesDirty` 등)를 IndexedDB에 기록하도록 트리거하는 `scheduleSessionAutosave()`가 복구 블록 내에서 호출되지 않습니다. 사용자가 추가적인 액션 없이 앱을 종료하면 직전의 잉크 상태가 디스크에 동기화되지 않아 유실될 수 있습니다.
- **최소 수정:** 백업 롤백 블록이 끝나는 시점에 `scheduleSessionAutosave()`를 명시적으로 호출해야 합니다.

---

## 3. 오탐 및 유예 사유 (False Positives & Accepted Boundaries)

- **[허용됨] 대용량 PDF 내보내기/저장 시 메인 스레드 프리징:** `js/board-2.0.1-ui.js:214` 및 `js/render-doc-draw.js:206`에서 `String.fromCharCode(...bytes.subarray())`를 사용하여 32KB 단위로 쪼개 거대한 Base64 바이너리 문자열을 동기적으로 생성합니다. 콜스택 제한 오버플로우는 방지하고 있으나, 수십 MB에 달하는 작업에서 메인 스레드가 블로킹됩니다. 개발 문서에 대용량 PDF 렌더링 부하가 "알려진 한계(Limitation)"로 명시되어 있으므로 당장의 치명적 결함으로 분류하지는 않았으나, 향후 `FileReader.readAsDataURL`을 이용한 비동기 변환 처리가 권장됩니다.
- **[허용됨] 페이지 구조 변경 시 로컬 히스토리 생존 현상:** `add`한 칠판 페이지를 `Undo`로 지웠다가 다시 `Redo`로 복구했을 때, 이전 세션의 스트로크 히스토리(`strokeHistoryByContext`)가 폐기되지 않고 그대로 유지됩니다. 요구사항의 "구조 복원 시 최신 잉크 유지" 철학과 일치하며, 엉뚱한 페이지로 잉크가 흘러가는 부작용이 발견되지 않았으므로 정상 동작으로 판단했습니다.
- **[오탐] Drive PDF 핀 교체 시 단일 트랜잭션 안전성:** `importDrivePdf` 코드 내에서 기존 캐시 핀을 해제(`fileId: null`)하지 않고 즉시 새 파일 ID로 `drive_set_active_pdf`를 덮어씁니다. Rust 측의 키 덮어쓰기 원자성을 고려할 때, 이는 오히려 '새 파일이 성공적으로 열린 후 기존 핀을 해제'한다는 스펙을 부작용 없이 완벽하게 충족하는 올바른 구현입니다.


## Retained evidence

- Exact source snapshot: C:/Users/pjd01/AppData/Local/Temp/board-201-agy-source-snapshot.txt
- Snapshot file hashes: C:/Users/pjd01/AppData/Local/Temp/board-201-agy-source-hashes.json
- Raw stream: C:/Users/pjd01/AppData/Local/Temp/board-201-agy-source-review.jsonl
- Diagnostics: C:/Users/pjd01/AppData/Local/Temp/board-201-agy-source-review.stderr.txt

## Failed earlier broad attempt

Session 9d73b7a7-95b7-43e0-b1bd-a9b0d65a1879 returned wrapper SUCCESS/exit0 but no response and denied RunCommand. It was correctly treated as incomplete, never as a pass. No permission bypass was used. The later substantive source-only review above resolves that execution blocker for the captured source, but not outstanding code findings or final delta review.

- Raw JSON: C:/Users/pjd01/AppData/Local/Temp/board-201-agy-broad-review.json
- Diagnostics: C:/Users/pjd01/AppData/Local/Temp/board-201-agy-broad-review.stderr.txt
- Start hashes: C:/Users/pjd01/AppData/Local/Temp/board-201-agy-broad-snapshot.json

## Earlier native-only review

Session 9d006361-fbab-47c0-9215-be441bdcf3f6 identified pending OAuth restoring tokens after logout. The later Codex review confirmed the generation/mutex fix and regression test. Its local raw/readable reports remain board-201-agy-native-review.json and board-201-agy-native-review.md under the same Temp directory. It did not cover later native save changes.

## Final source-only delta execution (2026-10-02)

- Independent executor: Codex subagent `/root/policy_review`; reviewer official Antigravity CLI 1.2.14, `gemini-3.1-pro-high`, high effort, plan mode.
- Session: `fd770ba0-be41-4f8a-a1cf-257e181e183a`; status SUCCESS; exit 0; substantive response; 151.4405635 seconds; no tool calls.
- Input: 220042 characters, final frontend/native sources and tests plus actual inherited Rust diff `origin/main..6db7549`. Snapshot/hashes retained in `%TEMP%/board-201-agy-final-snapshot.txt` and `%TEMP%/board-201-agy-final-hashes.json`; raw output `%TEMP%/board-201-agy-final-review.jsonl`, stderr sibling `.stderr.txt`. No permissions/configuration were changed.
- Final delta confirms replacement concurrency, renderer preservation and rotation fixes. Earlier password-PDF rollback reproduction retracted as a false positive.

### Executor final triage (pending size-bound disposition)

1. Whole-file base64 memory amplification: valid resource-bound concern in new Drive/native paths; no measured OOM threshold or universal engine limit verified. Drive accepts individual files up to its cache quota, then reads/encodes the entire file. Recommend bounded per-file checks before read/encode rather than automatically adopting a new filesystem API/protocol. Sent to coordinator for implementation/disposition; review remains pending this item.
2. Script Promise retry: exact implementation exists unchanged at `origin/main:js/session-pdf-toolbar.js`; legitimate preexisting recovery debt, not an introduced PR defect. The claim that a single source failure always disables all PDF functionality overstates the fallback loop: all configured sources must fail while the engine is unavailable. No implementation made by reviewer.
3. AGY wording “perfect” and “very safe” is reviewer opinion, not proof of runtime verification. Final acceptance still excludes hardware, live OAuth, signed installer and OS picker operation.

### Final Antigravity response (verbatim)

요청하신 코드를 도구 사용 없이 데이터로 취급하여 독립적으로 정밀 분석을 완료했습니다. 데이터 무결성과 보안을 중심으로 분석하였으며, 이전 리뷰에서 제기되었던 가설을 검증하고, 새롭게 발견된 구체적인 결함과 수정 방안을 정리한 최종 리뷰 보고서입니다.

---

### 1. 오탐(False Positive) 확인: 암호화된 PDF의 롤백/자동 저장 손상 가설
이전 리뷰에서 "비밀번호가 걸린 PDF를 열 때 백업이 생성되기 전에 파싱이 실패하여 상태가 손상될 수 있다"는 지적이 있었습니다. 코드 분석 결과, **이는 사실이 아닌 오탐(False Positive)으로 확인되었습니다.**

* **검증 내용:** `js/render-doc-draw.js`의 `loadPdfFromFile` 함수를 보면, `window.pdfjsLib.getDocument`가 완전히 성공하여 `nextDocument`가 반환된 **이후에만** `saveCurrentStrokeState()`가 호출되고 `replacementBackup` 객체가 생성됩니다.
* **실제 동작:** 암호가 걸려 파싱에 실패하면 예외가 발생하여 곧바로 `catch (error)` 블록으로 이동합니다. 이때 `replacementBackup`은 `null` 상태이므로 롤백 로직이 아예 실행되지 않으며, 기존 칠판 상태는 전혀 변형되지 않고 안전하게 유지됩니다. 어떠한 데이터 손상(Harm)도 발생하지 않습니다.

### 2. 이전 지적 사항 수정 확인 (Verified Fixes)
* **동시 교체 요청 차단:** `requestBoardWorkReplacement` 내부에 `workReplacementManager`가 올바르게 구현되어 있어, Drive에서 파일을 가져오는 동안 중복된 교체 요청을 안전하게 거부합니다.
* **페이지 삭제 시 인접 잉크 보호:** `BoardState.applyStructureOperation`이 인접 페이지의 상태를 덮어쓰지 않도록 안전하게 분리되었으며, 렌더러가 올바른 대상 인덱스를 참조하도록 수정되었습니다.
* **PDF 회전 및 크롭(Crop) 매핑:** `js/board-export.js`의 `pdfPageLayout`에서 Rotate90일 때 `drawRotation`을 270으로 명시적으로 할당하며, 4방향 쿼터턴(Quarter-turn)에 대한 시각적 좌표 변환(`sourcePointToVisual`)이 완벽하게 일치합니다.

---

### 3. 구체적인 신규/잔존 결함 (Actionable Issues)

#### 결함 A: Tauri IPC Base64 이중 인코딩으로 인한 심각한 메모리 초과 (OOM)
* **위치:**
  - `src-tauri/src/commands/drive.rs` (`drive_download_pdf`)
  - `src-tauri/src/commands/files.rs` (`save_document_file`)
  - `js/board-2.0.1-ui.js` (`importDrivePdf`, `saveBoardWorkFile`)
  - `js/render-doc-draw.js` (`exportAnnotatedPdf`)
* **설명:** 현재 앱은 Drive에서 PDF를 다운로드하거나 `.boardwork` 및 PDF를 저장할 때, **전체 파일 내용을 Base64 문자열로 변환하여 JSON 형태의 Tauri IPC로 전송**하고 있습니다. Google Drive 캐시 한도가 최대 16GB까지 설정될 수 있는데 반해, V8 엔진의 문자열 최대 길이는 약 512MB~1GB 수준입니다. 수백 MB 크기의 PDF를 처리할 경우 Base64 인코딩 과정과 JSON 직렬화 과정에서 런타임 메모리(RAM)가 파일 크기의 3~4배 이상 폭증하여 앱이 강제 종료되거나 V8 엔진 크래시가 발생합니다. 이는 대용량 데이터를 다루는 데 있어 치명적인 데이터 무결성 및 가용성 결함입니다.
* **구체적 해결 방안:**
  1. `drive.rs`의 다운로드 커맨드는 `pdf_base64` 문자열을 반환하지 말고, **캐시된 파일의 로컬 절대 경로(Path)**만 반환하도록 수정해야 합니다.
  2. 프론트엔드(`importDrivePdf`)에서는 Tauri의 기본 파일 시스템 API(`window.__TAURI__.fs.readBinaryFile`)를 사용해 경로에서 직접 `Uint8Array`로 데이터를 읽어오거나 Custom Protocol을 통해 불러와야 합니다.
  3. 반대로 저장할 때(`saveBoardWorkFile`, `exportAnnotatedPdf`)에도 렌더러에서 대형 Base64 문자열을 생성하지 말고, 프론트엔드 API로 임시 경로에 바이너리를 쓴 뒤 Rust에 해당 경로를 전달하여 `MoveFileExW`로 원자적(Atomic)으로 이동시키도록 IPC 구조를 변경해야 합니다.

#### 결함 B: 일시적 네트워크 장애 시 외부 스크립트 영구 차단 (Promise 캐싱 결함)
* **위치:** `js/session-pdf-toolbar.js` 내 `loadExternalScript` 함수
* **설명:** PDF.js 또는 PDF-lib 엔진을 동적으로 로드할 때, 호출된 `Promise`를 `externalScriptLoadPromises` Map에 영구적으로 캐싱합니다. 만약 앱 실행 직후 일시적으로 인터넷이 끊겨 스크립트 로드에 실패(`onerror` 발생)하면, **거부된(Rejected) Promise가 그대로 캐시에 남습니다.** 이후 네트워크가 복구된 상태에서 사용자가 다시 다운로드나 내보내기를 시도하더라도, 캐시된 거부 상태의 Promise가 즉시 반환되어 실제 네트워크 재시도 없이 기능이 영구적으로 먹통이 됩니다. 앱을 재시작하기 전까지 복구할 수 없습니다.
* **구체적 해결 방안:** `script.onerror` 콜백 내부에서 `reject()`를 호출하기 직전에, 실패한 URL을 캐시에서 삭제하는 로직을 추가하여 이후 재시도 시 새 `<script>` 태그를 생성할 수 있도록 조치해야 합니다.
  ```javascript
  script.onerror = () => {
    externalScriptLoadPromises.delete(normalizedUrl);
    reject(new Error(`Failed to load script: ${normalizedUrl}`));
  };
  ```

---

### 총평
보안 측면(OAuth 상태 검증, 파일명 정리 등)과 저장 시의 원자성 보장(Windows `MoveFileExW` 등)은 매우 안전하게 구현되어 있습니다. 이전 리뷰에서 제기된 아키텍처상의 구조적 문제는 성공적으로 해결되었습니다. 위에서 지적된 IPC 메모리 병목 현상과 네트워크 재시도 로직만 보완한다면, 대용량 PDF 문서 처리 환경에서도 높은 수준의 데이터 무결성을 보장할 수 있습니다.


## Final closure: bounded-transfer recheck

- Independent executor: `/root/policy_review`; official Antigravity CLI 1.2.14, `gemini-3.1-pro-high`, high effort, plan mode.
- Session `7577cde9-508b-4d46-a0ac-591d5bba4a71`: SUCCESS, exit 0, substantive response, 94.9768625 seconds; no tool calls.
- Focused final snapshot: 31156 characters; `%TEMP%/board-201-agy-cap-snapshot.txt`; timestamp/SHA256 `%TEMP%/board-201-agy-cap-hash.txt`; raw output `%TEMP%/board-201-agy-cap-review.jsonl`; stderr sibling `.stderr.txt`.
- Disposition: prior unbounded-transfer concern addressed with explicit 256 MiB source-PDF and 512 MiB work/save caps across pre-read/pre-decode/pre-IPC and streaming boundaries. The caps are engineering constraints. No new filesystem protocol was introduced. Independent Codex recheck also found no guard defect; 23 JS tests passed.
- All confirmed actionable PR findings from these reviews are resolved. The unchanged script-loader retry issue is preexisting debt; the password-PDF rollback reproduction is a false positive. Review execution and final source rechecks are complete.
- AGY uses absolute phrases in its raw conclusion below; executor does not interpret these as a proof against every OOM or malformed document. Output generation/serialization still allocates memory, and caps do not certify low-memory hardware. Live OAuth, actual signed updating, bezel touch and OS-native save picker behavior remain explicitly unverified by this reviewer.

### Cap review response (verbatim)

제공해주신 코드에 대해 도구 사용 없이 메모리 전송 크기 제한(Memory transfer size guards) 구현만을 범위로 지정하여 독립적인 집중 검토를 진행했습니다.

**검토 결과: 추가 조치가 필요한 구체적인 가드 결함(Guard bug)은 발견되지 않았습니다. (No actionable guard finding)**

엔지니어링 정책에 따른 구체적인 가드 검증 결과는 다음과 같습니다:

1. **PDF 소스 최대 256MiB (PDF source max 256MiB):**
   - **Frontend:** `loadPdfFromFile`에서 파일 크기를 정확히 확인하여 256MiB를 초과하면 차단합니다.
   - **Backend (Rust):** `drive_download_pdf` 루틴에서 파일 메타데이터 검증, 청크(Chunk)를 읽어 들이는 다운로드 스트림 루프 (`ensure_source_pdf_size(next)`), 그리고 캐시를 읽기 전 최종 파일 크기 확인까지 3단계에 걸쳐 256MiB 상한을 철저히 검증하고 있습니다.

2. **작업 파일 입력 최대 512MiB (Boardwork input max 512MiB):**
   - `openBoardWorkFile` 진입 시 `isByteLengthWithinLimit(file.size, ...)` 가드가 파일 읽기 이전에 512MiB 초과 파일을 안전하게 차단합니다.

3. **`atob` 실행 전 내장 PDF 최대 256MiB 검증 (Embedded source PDF max 256MiB before atob):**
   - `importDrivePdf`와 `openBoardWorkFile` 두 곳 모두 메모리에 적재된 Base64 문자열을 `atob`로 디코딩하기 직전에 `isBase64WithinLimit` 함수를 호출합니다. 패딩을 감안한 정확한 디코딩 크기를 산출하여 256MiB 정책을 안전하게 적용합니다.

4. **Outbound Base64 인코딩 전 저장 출력 최대 512MiB (Saved output max 512MiB before outbound base64):**
   - `saveBoardWorkFile`(`data.size`) 및 `exportAnnotatedPdf`(`outputBytes.byteLength`)에서 직렬화(Blob 할당) 직후 단일 512MiB 검증을 거칩니다. 이 가드는 `encodeBase64` 변환이나 Tauri IPC 호출 이전에 동작하여 과도한 전송을 차단합니다.

5. **Rust 네이티브 파일 저장 가드 (Native saves encoded length pre-dialog and decoded stream count):**
   - `save_document_file` 진입 즉시 파일 저장 다이얼로그를 띄우기 전 `ensure_encoded_length`로 넘어온 Base64 길이 자체를 검증합니다. Base64 비율(4/3) 계산식 또한 정확합니다.
   - 파일 기록을 위한 디코딩 루프에서도 청크 누적치(`written.checked_add`)를 `ensure_decoded_length(next)`로 매번 확인해 비정상적인 스트림 길이를 빈틈없이 차단합니다.

**최종 결론:**
작업 직렬화나 문자열 변환 시 발생하는 순간적인 메모리 할당 구조는 유지되나, 모든 데이터 송수신(IPC) 진입점과 I/O 처리 과정에 명확한 상수 상한(256MiB/512MiB)을 강제하고 있습니다. 따라서 새로운 파일 시스템 통신 프로토콜을 도입하지 않고도, 무제한적인 메모리 전송과 기하급수적인 데이터 팽창 시도를 완벽히 통제하는 현재의 최소 가드(Minimal guards) 설계는 충분하고 적합합니다.
