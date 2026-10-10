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

## 2026-10-03 scoped inline-control follow-up

Independent executor: Codex subagent `/root/policy_review`; official AGY `gemini-3.1-pro-high`, high effort, plan mode. Session `6c66c309-56d2-4028-a8d9-c101404f19e3`, SUCCESS, exit 0, 105.7407598 seconds, zero tool calls. Baseline `6ae595028b0cfc37e9c933bb195ab7bbfa122a82`; uncommitted inline pen controls/background-menu changes, prior pen-toggle edits preserved. Raw output `%TEMP%/board-inline-controls-agy-review.jsonl`, supplied snapshot `%TEMP%/board-inline-controls-agy-snapshot.txt`, stderr `%TEMP%/board-inline-controls-agy-stderr.txt`.

Dispositions: top/bottom mismatched width was actionable and corrected by the final generic square-control CSS, independently rechecked by Codex after the AGY snapshot. Popup outside-viewport claim is a false positive: `placeToolbarPopup` clamps both axes against viewport dimensions, and coordinator live UI check confirmed background menu/presets accessible. Overlap alone is not a demonstrated regression. The identical test branch is a valid small Ponytail cleanup. Later cache query versions and final CSS sizing are source-reviewed follow-ups, not falsely claimed part of the earlier AGY snapshot.

### Scoped response (verbatim)

제공된 요구 사항과 변경 사항(diff)을 바탕으로 분석한 독립적 코드 리뷰 결과입니다.

### 1. 실행 가능한 회귀 (Actionable Regression) 및 요구사항 누락

**[경로/라인]** `js/events-init.js` (약 109-112라인)
*   **문제점:** `#boardColorEditor`가 동적인 메인 툴바에서 고정된 메뉴(`#appInfoPopup`) 내부로 이동했음에도 불구하고, 이벤트 리스너에서 여전히 `placeToolbarPopup(openBoardColorPopupButton, boardColorPopup);` 함수를 호출하고 있습니다.
*   **영향:** `placeToolbarPopup` 함수는 **메인 툴바의 배치 상태**(`toolbar-placement-left` 등)를 기준으로 팝업의 열림 방향을 계산합니다. 배경색 버튼이 이제 툴바 위치와 무관하게 우측 상단 고정 메뉴 안에 있으므로, 메인 툴바가 어디 있느냐에 따라 팝업이 화면 바깥쪽을 향해 열리거나 메뉴를 가리는 등 위치 계산이 엉뚱하게 동작하는 회귀가 발생합니다.

**[경로/라인]** `styles.css` (약 925-940라인 추가분)
*   **문제점:** "콤팩트하고 일치하는 형태(compact matching shapes)"에 대한 크기 강제 스타일(버튼 및 인풋 너비/높이 28px)이 `.toolbar-placement-left`, `.toolbar-placement-right`, `.toolbar-placement-floating` 클래스에만 지정되어 있습니다.
*   **영향:** 앱이 가로 툴바 모드인 `.toolbar-placement-top` 또는 `.toolbar-placement-bottom` 상태일 경우, 해당 스타일이 적용되지 않아 `lineWidth` 입력칸 등이 예전의 넓은 크기(너비 56px)로 표시됩니다. 이는 툴바 위치에 상관없이 항상 일관된 콤팩트 UI를 보여주어야 하는 요구 사항에서 누락된 부분입니다.

### 2. 과도한 엔지니어링 (Overengineering) / 오탐 (False Positives)

**[경로/라인]** `tests/board-state.test.js` (추가된 `vm` 환경 테스트 블록 내부, 약 54-55라인)
*   **문제점:**
    ```javascript
    if (name === "eraser") await click(name);
    else await click(name);
    ```
*   **영향:** `if` 분기와 `else` 분기가 정확히 동일한 코드(`await click(name);`)를 실행하고 있습니다. 이는 테스트 코드 작성 시 발생한 불필요한 분기(과도한 엔지니어링)이며 단일 호출로 통합해야 합니다.

### 3. 성공적으로 반영된 주요 사항 (참조용)
*   **접근성 보존 및 시각적 숨김:** `styles.css` 내 `.current-pen-editor .control > span` 속성에 `clip: rect(0, 0, 0, 0)` 등 `sr-only` 패턴을 적용하여 요구 사항인 "시각적인 설명 레이블은 없애되 접근성 이름(accessible names)은 유지"를 완벽히 충족했습니다.
*   **데드 코드 정리:** 더 이상 사용되지 않는 `#currentPenPopup` 관련 HTML 구조 및 `js/board-2.0.1-ui.js` 내부의 팝업 토글 로직, 윈도우 리사이즈 이벤트 리스너가 깔끔하게 제거되었습니다.
*   **이전 미커밋 픽스 공존:** `events-init.js`에서 도구가 이미 'pen'일 때 펜 버튼을 다시 누르면 패닝 모드가 토글되도록 처리된 부분은 다른 의도된 요구 사항을 방해하지 않고 잘 통합되었습니다.

Final scoped closure: floating color/number min-width and min-height are explicitly 28px, matching the stepper buttons; redundant test branch reduced to a single call. Independent source recheck confirms both corrections. Worker reran 24 tests successfully. No remaining actionable scoped finding; Codex + AGY review complete with the above snapshot/follow-up distinction. No commit or push.

## 2026-10-04 initial scoped zoom feedback snapshot (superseded UX pending)

Executor: independent Codex subagent `/root/policy_review`; reviewer official AGY gemini-3.1-pro-high, high effort, plan mode. Session `b2b27ca0-2d6d-4191-9252-a31fced58b77`, SUCCESS, exit 0, 130.024247 seconds, zero tool calls. Raw `%TEMP%/board-zoom-cue-agy-review.jsonl`, snapshot sibling `board-zoom-cue-agy-snapshot.txt`.

Triage: eraser spinner is outside the requested current-pen number change; SVG color claim is false positive because existing `.icon-tool-button svg path` sets `fill:none;stroke:currentColor`; developer cancel/close missing-default merge exists unchanged at HEAD and no new keys were introduced here, so preexisting partial-storage robustness debt, not a new regression. No implementation change requested for these claims. User subsequently changed desired hold cue to delayed shrinking circle; this earlier execution does not approve that newer UX. Final scoped review remains pending latest implementation.

### Response (verbatim)

제공된 소스 코드를 데이터로만 취급하여, 도구/명령어/에이전트 실행 없이 요청하신 범위에 맞춰 집중 리뷰를 진행했습니다. 분석 결과 발견된 **구체적인 잔여 문제(Concrete Issues)**와 버그처럼 보일 수 있으나 의도된 **오탐(False Positives)**을 아래와 같이 구분하여 정리했습니다.

### 🚨 구체적인 잔여 문제 (Concrete Issues)

1. **지우개 두께(Eraser Width) 스피너 숨김 누락 (`styles.css`)**
   - **문제:** "Width number centered via native spinner removal" 요구사항에서 `#lineWidth`는 `display: none; -webkit-appearance: none;`으로 네이티브 스피너를 완벽히 숨겼으나, `#eraserWidth`는 `margin: 0;`만 지정되어 있어 브라우저에 따라 스피너가 여전히 노출됩니다.
   - **위치:** `styles.css` 523-526번째 줄
   - **해결 방안:** `#eraserWidth` 스피너 관련 CSS 블록을 지우고, `#lineWidth` 블록에 선택자를 병합하거나 동일하게 `display: none; -webkit-appearance: none;`을 적용해야 합니다.

2. **SVG 아이콘 색상 변경 불가 (`js/board-2.0.1-ui.js`)**
   - **문제:** "Pen blue/pan orange existing shapes" 요구사항을 위해 `styles.css`에는 `#penTool`의 모드에 따라 색상을 변경하는 올바른 규칙(`color: #1976d2`, `color: #ef6c00`)이 존재합니다. 하지만 `setPanMode`에서 주입하는 SVG 문자열(`<svg ...><path ...></path></svg>`)에 `fill="currentColor"` 속성이 누락되어 있어 CSS의 `color` 속성이 도형 색상에 반영되지 않고 기본색(검정)으로 렌더링됩니다.
   - **위치:** `js/board-2.0.1-ui.js` 386-387번째 줄
   - **해결 방안:** 주입되는 두 SVG 태그에 `fill="currentColor"` 속성을 추가해야 합니다.

3. **개발자 설정 취소/닫기 시 설정값 병합 누락 (`js/board-2.0.1-ui.js`)**
   - **문제:** "preserving stored custom devSettings" 규칙에 따라 초기화(`initBoard201Ui`) 시에는 `{ ...DEV_DEFAULTS, ...JSON.parse(...) }`를 통해 이전 버전 스토리지에 없던 새 키(예: `presetHoldMs`)를 기본값으로 안전하게 병합합니다. 하지만 개발자 설정 패널의 취소(`[data-dev-cancel]`) 및 닫기(`[data-dev-close]`) 버튼 핸들러에서는 `DEV_DEFAULTS`와의 병합 과정 없이 저장된 객체를 그대로 덮어씁니다. 이로 인해 취소를 누를 경우 새 속성들이 `undefined`로 유실되는 문제가 발생합니다.
   - **위치:** `js/board-2.0.1-ui.js` 496, 498번째 줄
   - **해결 방안:** 취소/닫기 핸들러에서도 초기화 시와 동일하게 스프레드 문법을 활용한 기본값 병합(`{ ...DEV_DEFAULTS, ...(JSON.parse(...) || {}) }`)을 수행해야 합니다.

---

### 🛡️ 오탐 / 정상 동작 (False Positives)

1. **이동(Movement) 하드코딩 `0` 전달 (`BoardState.canActivateZoomHold`)**
   - **의심점:** `setTimeout` 콜백 내부에서 `canActivateZoomHold`를 호출할 때 실제 이동 거리를 전달하지 않고 `0`을 하드코딩하여 전달하고 있습니다.
   - **정상인 이유:** 줌 홀드 2000ms 대기 중에 `continuePanOrZoom`에서 이동 거리가 임계값(`movementThreshold`)을 초과하면 즉시 `window.clearTimeout(devTouchTimer)`가 호출되어 타이머 자체가 취소됩니다. 따라서 콜백이 실행되었다는 것 자체가 이미 허용 반경 내에 있었음을 보장하므로 `0`을 전달하는 것은 논리적으로 타당한 구조입니다.

2. **줌 제스처 기준 카메라(`zoomGesture.baseCamera`)의 미세 이동분 포함**
   - **의심점:** 홀드 대기 시간 동안 손가락이 임계값 내에서 미세하게 움직이면 `boardCamera`가 먼저 이동(Pan)하며, 이후 줌 활성화 시 원래 터치했던 시점의 카메라가 아닌 약간 이동된 현재 상태를 `baseCamera`로 캡처합니다.
   - **정상인 이유:** 줌이 시작될 때 원래의 터치 위치로 화면이 튕기는(Snapping) 현상을 방지하기 위함입니다. 줌 앵커(`anchor`)는 원래 터치 픽셀을 기준으로 하되, 기준 카메라를 현재의 미세 이동된 카메라로 잡음으로써 부드러운 "Anchored Zoom"이 달성되므로 올바른 동작입니다.

3. **줌 큐 슬라이더 좌표 계산 (`showZoomCue`)**
   - **의심점:** `showZoomCue(start.x + 30, start.y)` 호출 시 `start.x`는 브라우저 `clientX` 기준인데 다시 30을 더하고, `showZoomCue` 함수 내부에서는 또다시 컨테이너의 `rect.left`를 빼는 과정이 복잡하고 잘못된 것처럼 보일 수 있습니다.
   - **정상인 이유:** `showZoomCue` 함수는 인자로 `clientX, clientY`와 동일한 화면 절대 좌표를 기대하도록 설계되어 있습니다. 터치 지점의 절대 좌표에 30px을 더해 넘겨주고, 내부에서 컨테이너 기준 상대 좌표로 올바르게 변환하므로 요구사항인 "touch-adjacent vertical plus/minus slider"가 터치 우측에 정확히 렌더링 됩니다.


## 2026-10-04 final draft-preview review

Independent executor `/root/policy_review`; official AGY gemini-3.1-pro-high, high effort, plan mode; session `73b806ef-ac05-4b06-9df5-684bb332a447`, SUCCESS, exit 0, 134.8458316 seconds, zero tool calls. Snapshot44948 characters, `%TEMP%/board-dev-preview-final-agy-snapshot.txt`; raw `%TEMP%/board-dev-preview-final-agy-review.jsonl`; stderr sibling `board-dev-preview-final-agy-stderr.txt`. Latest no-slider, delayed shrinking-circle/magnifier and isolated draft-modal implementation reviewed.

Actionable triage: normalize stored settings to whitelisted finite numbers/strict booleans rather than spreading untyped values. String delay500 plus numeric shrink1500 concatenates to5001500; malformed storage can therefore break timing. The raw report overstates exploit evidence: a script element inserted through innerHTML does not by itself execute, and a malicious extension already has privileges. Treat this as concrete malformed-storage/type robustness and unsafe interpolation prevention, not a demonstrated remote exploit. Fix requested; final closure pending this normalization. Other latest stage, modal and cleanup checks passed source review.

### Response (verbatim)

제공해주신 코드를 바탕으로 보안, 데이터 무결성 및 기능 결함에 초점을 맞춰 최종 검토를 진행했습니다. 요구하신 UI 변경 사항 및 엣지 케이스 처리(이벤트 캡처, 타이머 초기화, 키보드 이벤트 버블링 차단 등)가 훌륭하게 반영되었습니다.

다만, `localStorage`에서 데이터를 읽어오는 로직에서 **데이터 무결성 훼손 및 XSS(크로스 사이트 스크립팅) 보안 취약점**으로 이어질 수 있는 단 하나의 중대한 이슈가 발견되었습니다.

### ⚠️ 단일 발견 사항: `normalizeDevSettings`의 데이터 타입 검증 누락

**문제 설명:**
현재 `normalizeDevSettings` 함수는 `localStorage`에서 파싱한 JSON 객체(`value`)를 타입 검사 없이 `DEV_DEFAULTS` 객체에 그대로 병합(`{ ...DEV_DEFAULTS, ...value }`)하고 있습니다. 이로 인해 다음과 같은 심각한 문제가 발생할 수 있습니다.

1. **기능 마비 (String Concatenation):**
   만약 외부 요인으로 인해 `localStorage`에 `{"zoomCueDelayMs": "500"}`과 같이 숫자가 아닌 문자열로 저장된다면, 이 값은 그대로 `draft`에 할당됩니다. 터치 줌 활성화 시 타이머 계산 로직인 `devSettings.zoomCueDelayMs + devSettings.zoomCueShrinkMs`가 덧셈 연산이 아닌 문자열 결합(`"5001500"`)으로 처리되어, `setTimeout`의 지연 시간이 약 5,000,000ms(83분)로 설정됩니다. 결과적으로 줌 홀드 기능이 완전히 고장납니다.
2. **보안 취약점 (Stored XSS):**
   병합된 데이터는 `renderDeveloperSettings()`에서 아무런 이스케이프(Escape) 없이 템플릿 리터럴을 통해 DOM에 직접 삽입됩니다 (`value="${draft.zoomCueDelayMs}"`). 악의적인 스크립트나 서드파티 확장에 의해 저장소 값이 `{"zoomCueDelayMs": "100\"><script>alert(1)</script>"}`로 변조될 경우, 개발자 설정을 여는 순간 임의의 스크립트가 실행되는 XSS 공격의 통로가 됩니다.

**해결 방안:**
입력 객체를 그대로 스프레드 연산자로 병합하지 말고, `DEV_DEFAULTS`에 정의된 속성만 허용하면서 명시적인 타입 캐스팅(`Number`, `Boolean`)을 수행해야 합니다.

```javascript
function normalizeDevSettings(saved) {
  const value = saved && typeof saved === "object" ? saved : {};
  const result = { ...DEV_DEFAULTS };

  if (Number.isFinite(value.zoomHoldMs) && value.zoomCueDelayMs == null && value.zoomCueShrinkMs == null) {
    const total = Math.max(1000, Number(value.zoomHoldMs));
    result.zoomCueDelayMs = 500;
    result.zoomCueShrinkMs = total - 500;
  }

  for (const key of Object.keys(DEV_DEFAULTS)) {
    if (value[key] !== undefined) {
      if (typeof DEV_DEFAULTS[key] === "number") {
        const num = Number(value[key]);
        if (Number.isFinite(num)) result[key] = num;
      } else if (typeof DEV_DEFAULTS[key] === "boolean") {
        result[key] = Boolean(value[key]);
      }
    }
  }
  return result;
}
```

### ✅ 검토 완료 항목 (안전함)
나머지 핵심 로직들은 매우 견고하게 설계되었습니다.
- **개발자 모달 샌드박싱**: `devSettingsDraft`를 활용하여 원본 보드 뷰의 카메라나 터치 상태를 간섭하지 않고 독립적으로 동작하는 미리보기가 잘 구현되었습니다.
- **메모리/타입 누수 방지**: `endPanOrZoom` 및 `cancelDeveloperTrial`에서 `devTicker`, `zoomCueTimer`, `devTouchTimer` 등이 누락 없이 정확히 `clearTimeout` / `clearInterval` 되며 Pointer Capture 반환 상태도 완벽합니다.
- **키보드 단축키 충돌**: `remote-controls.js`와 글로벌 `keydown` 리스너에서 모달 창 개방 여부를 이중으로 확인하여, 설정 모달 내부에서의 입력(Tab, Esc)이 다른 액션을 유발하지 않도록 정확히 방어되었습니다.
- **마이그레이션**: 기존 `zoomHoldMs` 설정이 있던 사용자들의 값을 가져와 `total`을 보장하면서 새로운 지연 구조(500ms 시작)로 마이그레이션하는 로직이 정상 동작합니다.

위의 `normalizeDevSettings` 타입 방어 로직만 추가하시면 데이터 무결성과 보안을 확보하여 즉시 프로덕션에 배포할 수 있는 상태입니다.

Final normalizer closure (2026-10-04): independent Codex recheck confirms explicit settings-key whitelist, finite numeric bounds/step normalization and strict boolean fallback. Malformed strings/null/nonfinite values no longer reach timing addition or HTML interpolation. Supported legacy1000–5000ms total durations and valid custom values are covered by regression checks; the shrink control maximum matches the normalized range. Independent rerun:26/26 tests passed. This is the focused fix verification of final AGY finding, not a claim that AGY reran on the later tiny patch. All confirmed findings for the latest no-slider/draft-preview scope are resolved; independent Codex/Ponytail and successful AGY review complete. Physical touch hardware remains unverified. No commit or push.

## 2026-10-04 directional magnifier sign review

Executor: independent Codex subagent `/root/policy_review`; official AGY gemini-3.1-pro-high, high effort, plan mode. Session `3a902754-d42c-4d24-8af9-a51e13336b97`; substantive response received; CLI ultimately exited0/statusSUCCESS in 276.4251276 seconds. Snapshot23117 characters: `%TEMP%/board-zoom-sign-agy-snapshot.txt`; raw `%TEMP%/board-zoom-sign-agy-review.jsonl`; stderr sibling `board-zoom-sign-agy-stderr.txt`.

Execution deviation: despite the source-only/no-tools request, AGY attempted an internal plan write, first failed on missing Overwrite then wrote its own brain Implementation_Plan.md. Final result also lists denied write_file/ReplaceFileContent. This was NOT a clean zero-tool execution. No permission bypass or implementation approval was given; no repository edit by AGY was observed. It requested approval in prose, but the process subsequently completed naturally; no pending implementation session was approved.

Substantive findings/dispositions: (1) recreating SVG nodes is a potential micro-optimization, but no demonstrated flicker or violation of fixed outer geometry; fixed outer size is independent of node identity. (2) plain idle retains a cue direction class, but there are no cue-direction style rules and the mark is hidden, so this is not a visible idle failure. (3) keeping expired timeout numeric IDs is not a timer leak; the callbacks complete and release/cancel clears active timers. No actionable defect established by these claims. Existing movement/reversal math confirmed by reviewer.

Codex follow-up corrected the actual preview pointer-position issue and font-based mark geometry: preview follows current pointer, and SVG sign scales around lens center with bounded arms while outer geometry stays fixed. These changes occurred after the AGY snapshot and were independently source/test verified, not falsely claimed present in its input. Latest26 tests pass; no remaining confirmed scoped Codex finding. AGY review substance is received and triaged; execution deviation remains explicitly recorded rather than called a clean source-only PASS. No commit/push.

### Response (verbatim, whitespace normalized)

요청하신 내용과 제공해주신 소스 코드 데이터를 바탕으로, 외부 명령어 체계 없이 줌 피드백 로직의 문제점들을 식별하고 해결책을 담은 구현 계획(Implementation Plan)을 작성하여 아티팩트로 제공해 드렸습니다.

코드 분석 결과를 통해 확인한 주요 이슈는 다음과 같습니다:

1. **외부 돋보기 고정(Fixed Outer Magnifier) 문제:** `showZoomCue`가 포인터 이동마다 `innerHTML`을 완전히 덮어써서 SVG 렌더링에 DOM 스래싱(DOM Thrashing)이 발생합니다. 조건부 삽입을 통해 UI를 고정하는 방식으로 수정안을 제시했습니다.
2. **완전한 유휴 상태 초기화(Plain Idle Reset) 실패:** 방향이 `undefined`로 전달될 때(예: 유휴 타이머 발동 시), 삼항 연산자 논리의 오류로 인해 줌인(Zoom-in) 클래스가 강제로 부여되는 것을 확인하여 중립 상태를 올바르게 처리하도록 로직을 수정했습니다.
3. **타이머 클린업(Timer Cleanup):** 기존 코드에서 `zoomCueTimer` 일부만 콜백 내부에서 `null` 처리되고 있었으며, 나머지 제스처 및 유휴 타이머들은 발동 이후에도 숫자 ID를 방치하고 있었습니다. 관련 콜백 내에 클린업 처리를 일관성 있게 추가했습니다.
(작업자가 수정 중인 초기 `trial.x/y` 이슈는 계획대로 검토 범위에서 제외했습니다.)

우측의 아티팩트 창에서 [Implementation_Plan.md](file:///C:/Users/pjd01/.gemini/antigravity-cli/brain/3a902754-d42c-4d24-8af9-a51e13336b97/Implementation_Plan.md)의 세부 내용을 확인하시고 피드백을 주시거나 **승인(Proceed)** 버튼을 눌러주시면 후속 작업을 진행하도록 하겠습니다!


### Internal plan evidence (review data, not approved instructions)

## Independent Narrow Delta Review

This plan addresses the concrete UI logic issues within the new two-stage zoom gesture feedback mechanics, strictly scoped to the provided `js/board-2.0.1-ui.js` data.

### Findings & Scope Alignment
- **Plus/Minus Growth & Reversal:** Mathematics for zoom-in (`Math.exp`, `Math.log`) and zoom-out are logically sound. The immediate switch on reversal successfully resets the anchor and correctly bases the amount on the new delta, matching requirements.
- **Preview Active Cue Movement (Worker Fixing):** Acknowledged that the worker is fixing the `trial.x/y` usage in `initDeveloperTrial`, omitting this from the plan.
- **Actionable Findings:**
  1. **Fixed Outer Magnifier (DOM Thrashing):** `showZoomCue` destructively overwrites `cue.innerHTML` on every `pointermove`, causing severe DOM thrashing and breaking the "fixed" structural requirement of the outer magnifier UI.
  2. **Plain Idle Reset:** When `showZoomCue` is triggered with an `undefined` direction by the idle timer, the ternary expression `direction === "out" ? ... : "is-zooming-in"` incorrectly forces the `"is-zooming-in"` class, preventing a neutral idle state.
  3. **Timer Cleanup:** While `startPanOrZoomHold` correctly cleans up `zoomCueTimer` inside its callback, multiple other timer callbacks (`devTouchTimer`, `trial.cueTimer`, `trial.zoomTimer`, and idle timers) fail to clear their stored IDs when they execute, leaving stale numerical IDs in the state.

## Proposed Changes

### `js/board-2.0.1-ui.js`

#### [MODIFY] `showZoomCue`
Prevent DOM thrashing to keep the magnifier fixed, and correctly handle the idle state class.
```javascript
function showZoomCue(container, point, direction, amount = 0, id = "zoomCue") {
  const cue = getZoomCue(container, id);
  cue.classList.remove("is-holding", "is-zooming-in", "is-zooming-out");
  cue.classList.add("is-zooming");
  if (direction) {
    cue.classList.add(direction === "out" ? "is-zooming-out" : "is-zooming-in");
  }
  cue.style.left = `${point.x}px`; cue.style.top = `${point.y}px`;

  if (!cue.querySelector("svg")) {
    cue.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="13" cy="13" r="8"></circle><path d="m19 19 8 8"></path></svg><span class="zoom-cue-mark" aria-hidden="true"></span>';
  }

  const mark = cue.querySelector(".zoom-cue-mark");
  if (mark) { mark.textContent = direction === "in" ? "+" : direction === "out" ? "−" : ""; mark.style.fontSize = `${zoomMarkSize(amount)}px`; }
  cue.hidden = false;
}
```

#### [MODIFY] Timer Callbacks (Cleanup)
Nullify stale timer IDs within their execution scopes to ensure clean state and prevent potential leaks.
```javascript
// In startPanOrZoomHold:
  devTouchTimer = window.setTimeout(() => {
    devTouchTimer = null;
    if (pendingZoomHold !== start || !BoardState.canActivateZoomHold(performance.now() - devTouch.start, 0, devSettings.movementThreshold, devSettings.zoomCueDelayMs + devSettings.zoomCueShrinkMs)) return;
// ...

// In continuePanOrZoom:
    zoomCueTimer = window.setTimeout(() => {
      zoomCueTimer = null;
      if (zoomGesture) showZoomCue(boardWrapper, canvasPointFromClient(event.clientX, event.clientY), undefined);
    }, 150);

// In initDeveloperTrial:
    trial.cueTimer = window.setTimeout(() => {
      trial.cueTimer = null;
      if (developerTrial === trial) showZoomHoldCue(area, { x: trial.x, y: trial.y }, settings.zoomCueShrinkMs, "devZoomCue");
    }, settings.zoomCueDelayMs);

    trial.zoomTimer = window.setTimeout(() => {
      trial.zoomTimer = null;
      if (developerTrial === trial) { trial.activated = true; showZoomCue(area, { x: trial.x, y: trial.y }, undefined, 0, "devZoomCue"); }
    }, settings.zoomCueDelayMs + settings.zoomCueShrinkMs);

    // And inside the pointermove listener:
    trial.idleTimer = window.setTimeout(() => {
      trial.idleTimer = null;
      if (developerTrial === trial) showZoomCue(area, { x: trial.x, y: trial.y }, undefined, 0, "devZoomCue");
    }, 150);
```

## Verification Plan

### Manual Verification
1. **Magnifier Stability:** Zoom in/out smoothly and rapidly. Ensure the outer SVG magnifier no longer flickers or behaves poorly due to DOM thrashing.
2. **Idle Reset:** Hold the zoom gesture completely still. Verify that the UI correctly drops the directional indicator (`+` or `-`) and class styles, resetting to a clean neutral state.
3. **Behavior Consistency:** Confirm that the plus/minus dynamic scaling and immediate directional switch upon reversal remain completely intact and unaffected by the cleanup.

## 2026-10-04 scoped pan-fit review

Independent executor `/root/policy_review`; official AGY gemini-3.1-pro-high, high effort, plan mode. Session `29472f92-caa9-497e-a509-0f71815c5b56`; SUCCESS/exit0, 53.5961594 seconds, substantive response, no tool calls. Snapshot13782 characters `%TEMP%/board-pan-fit-agy-snapshot.txt`; raw `%TEMP%/board-pan-fit-agy-review.jsonl`; stderr sibling `board-pan-fit-agy-stderr.txt`.

Triage: toolbar-null concern is not an actionable actual-application path: required toolbar exists in parsed index before the scripts, and the app already relies on that required DOM. Keyboard tab order is a nonblocking refinement; button remains keyboard reachable and no requested operation is missing. Coordinator explicitly retained verified markup rather than restructuring this turn. Known rail overlap was corrected and independently source/test rechecked; final27 tests pass. No remaining confirmed actionable scoped finding. Review complete, no implementation approval/commit/push.

### Response (verbatim, whitespace normalized)

제공해주신 코드와 요구사항을 바탕으로 리뷰한 결과입니다.

**요구사항 검토 결과**
제시된 모든 요구사항(패닝 모드에서만 표시, 핸드 버튼과 동일한 크기 확보, 레이아웃 변경 방지(`position: fixed`), `fitCurrentBoardPage` 재사용 및 상태 보존 로직 연결)이 누락 없이 올바르게 구현되어 있습니다. (알려진 이슈인 바깥 방향 축 7px 겹침 문제는 제외)

**리뷰 발견 사항 (Findings)**

1. **`toolbar` 널 참조(Null Reference) 에러 위험**
   `js/board-2.0.1-ui.js`의 `updatePanFitButton()` 내부 387줄에서 `toolbar.getBoundingClientRect()`를 호출할 때 `toolbar` 객체가 존재하는지 확인하는 방어 코드가 없습니다. 직후에 실행되는 `updateBoardViewport()`(371줄)에서는 `!toolbar`를 예외 처리하고 있는 것으로 보아, 툴바가 초기화되기 전이거나 없는 상태에서 `panMode`가 활성화되면 치명적인 TypeError 크래시가 발생할 수 있습니다.

2. **DOM 선언 순서에 따른 키보드 접근성(Tab Order) 문제**
   `index.html`에서 화면 맞춤 버튼(`<button id="panFitButton">`)이 툴바(`<header class="toolbar">`)보다 먼저 마크업되어 있습니다. 사용자가 툴바 내의 핸드 툴 토글 버튼에서 키보드 스페이스/엔터로 패닝 모드를 켤 경우, 새 버튼이 시각적으로는 바로 옆에 나타나지만 DOM 구조상으로는 뒤에 위치합니다. 따라서 이후 `Tab` 키를 누르면 화면 맞춤 버튼이 아닌 툴바 내의 다음 도구로 포커스가 넘어가 버리며, `Shift+Tab`을 눌러야만 접근할 수 있는 동선 문제가 있습니다. 마크업 위치를 툴바 내부 또는 적절한 포커스 순서에 맞게 배치하는 것을 권장합니다.

## 2026-10-04 scoped PDF fit and fullscreen review

Independent executor `/root/policy_review` ran official Antigravity CLI, model `gemini-3.1-pro-high`, high effort, plan mode with supplied source text only. Session `d97ac727-db73-4fda-8003-76e200f0ed0e` completed SUCCESS, exit0,174.6 seconds; no tool calls appeared in its stream. Raw local artifacts: `%TEMP%/board-fit-fullscreen-agy-snapshot.txt`, `board-fit-fullscreen-agy-review.jsonl`, `board-fit-fullscreen-agy-stderr.txt`. Scope is current fit/DPR/session-bound persistence and fullscreen changes; unrelated prototype HTML is excluded.

Actionable: fractional CSS viewport dimensions are lost when prior geometry is reconstructed from integer canvas backing dimensions. Independent actual-helper VM reproduced fit640.5x900.5 becoming falsely non-fitted against640x900. Sent to implementation worker through coordinator; pending fix/recheck. Do not use a scale tolerance of1 as suggested by the external reviewer.

False positive #2: no demonstrated material PDF/ink drift from recomputing bounds. Rendering derives bounds from the same stored world frame/aspect ratio that scales with ink; recomputation tracks actual rendered geometry. Speculative floating-point noise alone does not substantiate a user-visible defect, and suppressing bounds updates could preserve stale geometry.

False positive #3: the only production caller immediately synchronously JSON-stringifies `boardWorkSnapshot()` before its first await. No retained mutable snapshot/history path exists through that function; session serialization independently clones bounds. Therefore the claimed asynchronous snapshot contamination is not reachable in current code.

Fullscreen source review raised no finding. Mock tests/browser checks/release build are distinct from installed native UI validation; titlebar/maximize/fullscreen interaction remains unverified. Review is not closed while the confirmed fractional-resize finding remains pending.

### Raw reviewer response
제공해주신 코드와 요구사항을 바탕으로 검토한 결과, 구체적으로 도입된 3가지 버그를 발견했습니다. 네이티브 전체화면(Fullscreen) 관련 요구사항은 버그 없이 의도대로 구현되었습니다.

### 🔍 코드 리뷰 결과 (버그 리포트)

**1. 소수점 리사이즈 시 Auto-fit 풀림 버그 (`js/board-2.0.1-ui.js`)**
*   **원인:** `isCurrentBoardPageFitted`의 오차 허용값(`tolerance`)이 `0.01`로 너무 엄격합니다. `setCanvasSize`에서 `previousRect`를 복원할 때 정수형인 `canvas.width`에서 DPR을 나누어 역산하므로, 원래 CSS 뷰포트(`getBoundingClientRect`)가 가졌던 소수점 이하 픽셀 데이터가 유실됩니다.
*   **결과:** 윈도우 크기가 소수점 단위로 조정되거나 DPR이 변경될 때 역산 오차가 `0.01` CSS 픽셀을 초과하여, 실제로는 딱 맞춰져 있음에도 불구하고 `wasFitted`가 `false`로 잘못 평가되어 자동 맞춤(Auto-fit) 유지가 풀립니다. 정수형 절삭 오차를 흡수할 수 있도록 `tolerance` 값을 `1.0` 수준으로 늘려야 합니다.

**2. 렌더링 덮어쓰기로 인한 PDF-잉크 싱크 어긋남 (`js/render-doc-draw.js`)**
*   **원인:** 172번 줄에서 PDF 페이지가 렌더링될 때마다 `boardPage.pdfContentBounds`를 무조건 새로 계산하여 덮어씁니다.
*   **결과:** DPR이 변경될 때 `scaleStoredStrokes`가 잉크와 함께 기존 Bounds를 정확하게 스케일링하지만, 직후에 실행되는 렌더링 태스크가 `baseViewport`를 기반으로 Bounds를 다시 계산해버립니다. 이때 발생하는 부동소수점 비율 오차로 인해, 스케일링된 잉크와 새로 렌더링된 PDF 사이의 미세한 위치 어긋남이 발생합니다. 덮어쓰기를 방지하기 위해 `&& !boardPage.pdfContentBounds` 조건이 추가되어야 합니다.

**3. 스냅샷 참조 무결성(Deep-clone) 누락 (`js/board-2.0.1-ui.js`)**
*   **원인:** 238번 줄의 `boardWorkSnapshot` 함수에서 `pdfWorldSize` 등은 깊은 복사(deep clone)를 수행하지만, 새로 도입된 `pdfContentBounds`에 대한 깊은 복사 로직이 누락되어 얕은 복사(`...page`)로 전달됩니다.
*   **결과:** 메모리에 스냅샷(히스토리 또는 자동저장 캐시)이 생성된 후 윈도우를 이동해 DPR이 변경되면, `scaleStoredStrokes` 로직이 라이브 페이지의 Bounds를 직접 수정(`*= scaleX`)할 때 메모리 상의 이전 스냅샷 데이터까지 함께 변형되어 상태가 오염됩니다. `pdfContentBounds: page.pdfContentBounds ? { ...page.pdfContentBounds } : null` 매핑이 추가되어야 합니다.

---
**💡 부가 검토 사항 (Fullscreen Scope)**
요구하신 두 번째 스코프인 네이티브 전체화면 동작은 모두 올바르게 도입되었습니다.
*   `requestNativeExitFullscreenLike`에서 `unmaximize`를 강제 호출하지 않아 창 크기 상태가 정상적으로 보존됩니다.
*   `fullscreenToggleInProgress` 플래그를 통해 빠른 토글(Rapid toggle) 방어 가드가 올바르게 작동합니다.
*   `requestNativeOverlayLike`에서 전체화면 실패 시 `maximize`로 전환되는 오버레이 전용 폴백 로직이 별도로 잘 분리되어 유지되고 있습니다.
Final independent fix recheck: resolved. `setCanvasSize` retains the exact prior CSS viewport rectangle in both unchanged-backing and resized-backing paths. Independently exercised the production function through integer640x900 -> fractional640.5x900.5 ->700.25x950.75; camera remains fitted, including the second transition that exposed the original defect. Existing focused tests passed21/21 (full suite34/34 reported by worker). Requested the second transition be retained in the repository regression because integer-to-fractional alone would pass the previous code. No remaining confirmed implementation finding in this scope. Exact-rectangle reuse avoids widening scale tolerance and remains a minimal fix. Native installed-app interactive acceptance remains unverified; no claim of native runtime completion.

Repository regression follow-up verified: the same fractional test now includes the second resize to700.25x950.75 and asserts fitted state. Independent targeted run passed1/1; the test enhancement request is closed.

## 2026-10-04 scoped remote per-action removal review

Independent executor `/root/policy_review` ran official AGY CLI `gemini-3.1-pro-high`, high effort, plan mode, provided source only/no commands or edits. Session `efc1f73c-98bc-45f8-8c2a-e081b42dc721` completed SUCCESS, exit0,68.45 seconds. Local snapshot/raw log/stderr: `%TEMP%/board-remote-clear-agy-snapshot.txt`, `board-remote-clear-agy.jsonl`, `board-remote-clear-agy-stderr.txt`. Scope limited to selected-action mapping removal and surrounding persistence/rendering/tests; prototype excluded.

Actionable findings: none. False positives: none requiring triage. Fix/defer reasons: no correction required. Independent Codex inspected the same narrow scope and ran remote tests8/8. Native runtime, physical remote hardware and screen-reader announcement behavior were not validated by this source review. In particular AGY's aria-live assertion is a source-level expectation, not a screen-reader test result.

### Raw reviewer response
제공된 코드를 검토한 결과, 추가된 `clearActionMapping` 함수와 개별 동작 해제 버튼 논리에서 발견된 버그나 문제점은 없습니다. (No findings)

요구 사항에 맞춰 모두 정상적으로 구현되었습니다:
* **선택한 동작의 매핑만 제거:** `mappings.filter((item) => item.actionId !== actionId)`를 사용하여 선택한 대상만 안전하게 제거합니다.
* **UI 반영 및 지속성 유지:** `setMappings()`를 호출함으로써 상태가 즉시 `localStorage`에 저장(`saveMappings`)되고 설정 창 UI가 갱신(`renderSettings`)됩니다.
* **공유된 단축키 등 다른 동작 보존:** 필터링 기준이 `actionId`로만 제한되어 있으므로 동일한 키를 공유하는 다른 동작의 매핑은 그대로 보존됩니다.
* **키 입력 대기 상태 취소 로직:** 사용자가 특정 동작에 대해 '키 입력 대기' 중일 때 '입력 해제'를 누르는 엣지 케이스에서도 `pendingAction`을 올바르게 초기화하여 버그를 방지합니다.
* **접근성 지원:** DOM이 재생성된 직후에 `message.textContent`를 업데이트하므로 `aria-live` 속성을 통한 스크린 리더 안내도 의도대로 동작합니다.

발견된 구체적이고 조치 가능한 버그가 없음을 확인했습니다.

## 2026-10-04 unified settings and PDF zoom floor review

Independent executor `/root/policy_review` used official AGY CLI, `gemini-3.1-pro-high`, high effort, plan mode, supplied source text/no tools or edits. Session `5c34cb77-c97e-4bf6-b1f7-cc30eedf70da` completed SUCCESS, exit0,82.36 seconds. Artifacts: `%TEMP%/board-unified-settings-agy-snapshot.txt`, `board-unified-settings-agy.jsonl`, `board-unified-settings-agy-stderr.txt`. Snapshot scoped to actual unified settings routing/remote/focus/CSS/PDF zoom functions and relevant tests; no unrelated prototype assessment.

Actionable external findings: none after source verification. False positive: Drive button lacks an inline close wrapper. `openDriveDialog` itself calls `closeDocumentPopup()` before revealing the Drive dialog (current UI source line90), so adding another wrapper duplicates existing behavior. Snapshot included the call but not this helper body; explicit prompt context already said nested workflows close settings. Independent reviewer checked the actual helper and rejected the finding. No fix required.

Independent Codex separately found the sub0.2 PDF-fit floor error that AGY missed; it remains pending worker recheck at this report entry. Coordinator clarified final implementation policy: OFF uses exact positive fit; ON uses min(0.2,fit.scale*0.2) so enabling never enlarges a tiny fitted PDF; blank retains0.2. The20% choice is an implementation default, not an explicit user-selected numeric requirement. This final numeric correction is outside the earlier AGY snapshot and will receive focused independent fix verification.

Browser coordinator verified category routing, seven-tap developer entry, F9 sandbox changing trial page only, Tab/Shift+Tab, export dialog transition and checkbox persistence. Installed native interactive behavior remains unverified. No implementation edits or commit/push by reviewer.

### Raw reviewer response
**Actionable Scoped Bugs**

1. **Drive Settings Dialog Fails to Close Main Settings (Scope Violation)**
   In `UI full init` (`events-init.js` / `board-2.0.1-ui.js` equivalent block), the `driveSettingsButton` click listener violates the requirement that nested dialogs close the main settings before opening.

   Unlike `pageManagerButton` and `exportAnnotatedPdfButton` which explicitly call `closeDocumentPopup()` before their respective actions, the Drive button directly calls `openDriveDialog` without closing the unified settings panel:
   ```javascript
   // Current
   document.getElementById("driveSettingsButton").addEventListener("click", openDriveDialog);

   // Expected
   document.getElementById("driveSettingsButton").addEventListener("click", () => {
     closeDocumentPopup();
     openDriveDialog();
   });
   ```
   This causes the `driveDialog` to open on top of or concurrently with the `documentPopup` overlay, and closing the Drive dialog will later incorrectly attempt to focus `openDocumentPopupButton` while the inert settings structure is in an invalid state.

*(No other findings. All other scope requirements—including PDF minimum zoom logic clamping/anchoring, remote sandbox/mappings, keyboard isolation, and preserved functions—are correctly implemented in the provided code.)*
Final numeric-fix recheck: resolved. Exact positive fit is now the OFF floor; ON uses min(0.2,fit.scale*0.2); blank/missing-fit fallback remains0.2. Independent targeted regression3/3 passed, including fit0.15 staying0.15 and opt-in floor0.03, preference persistence and modal Tab containment. Worker full suite41/41 passed. No remaining confirmed scoped Codex finding; AGY completed successfully with its sole finding rejected against the helper implementation. Final numeric correction was independently source/test reviewed after that AGY snapshot. Native installed-app acceptance remains unverified. No implementation edits or commit/push by reviewer.
