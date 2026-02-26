# TODO: Overlay 버그 수정 계획

📍 **문서 위치**: [README](README.md) > [NAVIGATION](NAVIGATION.md) > TODO  
🎯 **다음 문서**: 수정 추적 → [BUGFIX_TRACKER.md](BUGFIX_TRACKER.md) | 빠른 테스트 → [QUICKREF.md](QUICKREF.md)  
📚 **문서 구조**: [NAVIGATION.md 참조](NAVIGATION.md)

---

> **자동 생성됨**: 2026-02-25  
> **목적**: 중복 작업 방지 및 진행 상황 추적

---

## ✅ 완료됨 (2026-02-25)

### Critical Bug Fix
- [x] `set_window_overlay_surface` LAYERED 제거 로직 수정
- [x] `SetWindowPos(SWP_FRAMECHANGED)` 추가
- [x] DWM margins를 먼저 설정하도록 순서 변경
- [x] 진단 도구 4개 추가 (verify_window_styles, verify_webview_background_alpha, get_window_rect, set_window_click_through)
- [x] 모듈 분리 (runtime.js, overlay.js, diagnostics.js)
- [x] 문서화 (BUGFIX_TRACKER.md, BUG_ANALYSIS.md, QUICKREF.md)

---

## 🔄 다음 작업 (우선순위별)

### P0: 즉시 (오늘 완료 필요)

- [ ] **빌드 및 테스트**
  ```bash
  cd src-tauri && cargo build --release
  ```
  - [ ] Overlay 진입/종료 10회 반복 테스트
  - [ ] `has_layered` 올바르게 제거되는지 확인
  - [ ] 결과를 BUGFIX_TRACKER.md에 기록

- [ ] **Overlay 투명도 문제 재확인**
  - [ ] 브라우저 콘솔: `await Diagnostics.verifyOverlayState()`
  - [ ] 여전히 불투명하면 → P1 작업 필요
  - [ ] 투명하면 → Issue #1 해결 완료!

### P1: 단기 (1-2일)

- [ ] **JavaScript 타이밍 개선** (투명도 문제가 남아있으면)
  - [ ] `applyOverlayModeUI`에 async/await 추가
  - [ ] CSS 렌더링 후 `requestAnimationFrame` 대기
  - [ ] 네이티브 설정 간 50ms 딜레이
  - [ ] 자동 검증 및 재시도 로직
  - 위치: `app.js:1497`

- [ ] **WebView Alpha 설정 강화**
  - [ ] 설정 실패 시 에러 반환
  - [ ] 재시도 로직 (최대 3회)
  - 위치: `src-tauri/src/main.rs:set_webview_background_alpha`

- [ ] **자동 복구 함수 추가**
  - [ ] `js/overlay.js`에 `autoRecoverOverlay()` 추가
  - [ ] 진단 결과에 따라 자동 재설정
  - [ ] 최대 3회 재시도

### P2: 중기 (1주)

- [ ] **Mouse Mode - WM_NCHITTEST 구현**
  - [ ] 커스텀 윈도우 프로시저 작성
  - [ ] 툴바 영역 업데이트 명령 (`update_toolbar_region`)
  - [ ] JavaScript ResizeObserver로 툴바 추적
  - [ ] 기존 폴링 코드 제거
  - [ ] 테스트 및 검증

- [ ] **성능 최적화**
  - [ ] 폴링 제거로 CPU 사용량 감소 확인
  - [ ] 메모리 프로파일링
  - [ ] 렌더링 성능 측정

### P3: 장기 (향후)

- [ ] **크로스 플랫폼 지원**
  - [ ] macOS Overlay 모드 구현 연구
  - [ ] Linux Wayland/X11 지원 연구

- [ ] **테스트 자동화**
  - [ ] CI에 Overlay 테스트 추가
  - [ ] 회귀 테스트 스크립트

---

## ⚠️ 중복 시도 금지 (이미 실패한 접근법)

다음은 **이미 시도했으나 효과가 없었던** 방법들입니다:

### 시도 금지: 로깅만 추가
- ❌ 로그를 더 상세하게 만드는 것만으로는 해결 안 됨
- ✅ 대신 진단 도구 사용 (이미 추가됨)

### 시도 금지: Tauri setIgnoreCursorEvents
- ❌ API가 없거나 미구현 (`overlay.mousemode.forward-unavailable`)
- ✅ 대신 WM_NCHITTEST 구현 필요 (P2로 계획됨)

### 시도 금지: WebView 설정만 반복
- ❌ `setWebviewBackgroundAlpha(0)`을 여러 번 호출해도 소용없음
- ✅ 근본 원인: 창 스타일(LAYERED) 문제였음 (이미 수정됨)

---

## 📋 테스트 시나리오 (복사해서 사용)

### 시나리오 1: Basic Overlay
```javascript
// 1. 진입
// (F8 누름)
const enter = await Diagnostics.verifyOverlayState()
console.assert(enter.isTransparent, "Overlay should be transparent")
console.assert(enter.hasLayered, "Window should have LAYERED style")

// 2. 종료
// (F8 누름)
const exit = await Diagnostics.verifyWindowStyles()
console.assert(!exit.has_layered, "LAYERED should be removed") // ← 핵심!
console.log("✅ Basic Overlay test passed")
```

### 시나리오 2: Repeated Entry
```javascript
// 10회 반복
for (let i = 0; i < 10; i++) {
  // 진입
  console.log(`\nRound ${i + 1}: Enter`);
  // (F8 누름)
  await new Promise(r => setTimeout(r, 500));
  const enter = await Diagnostics.verifyOverlayState();
  console.assert(enter.hasLayered, `Round ${i + 1}: Enter failed`);
  
  // 종료
  console.log(`Round ${i + 1}: Exit`);
  // (F8 누름)
  await new Promise(r => setTimeout(r, 500));
  const exit = await Diagnostics.verifyWindowStyles();
  console.assert(!exit.has_layered, `Round ${i + 1}: Exit failed`);
}
console.log("✅ Repeated entry test passed");
```

### 시나리오 3: Mouse Mode
```javascript
// 1. Overlay 진입
// (F8)
await new Promise(r => setTimeout(r, 500));

// 2. Mouse Mode 활성화
// (F7)
await new Promise(r => setTimeout(r, 500));
const mouseOn = await Diagnostics.verifyMouseModeState(true);
console.assert(mouseOn.hasTransparent, "Should have TRANSPARENT style");

// 3. Mouse Mode 비활성화
// (F7)
await new Promise(r => setTimeout(r, 500));
const mouseOff = await Diagnostics.verifyMouseModeState(false);
console.assert(!mouseOff.hasTransparent, "Should NOT have TRANSPARENT style");

console.log("✅ Mouse Mode test passed");
```

---

## 🎯 이번 주 목표 (2026-02-25 ~ 2026-03-01)

| 날짜 | 목표 | 상태 |
|------|------|------|
| 2/25 (오늘) | P0 빌드 및 테스트, Issue #1 해결 확인 | ⏳ 진행 중 |
| 2/26 | P1 JS 타이밍 개선 (필요 시), 문서 업데이트 | 📋 계획 |
| 2/27 | P1 자동 복구 로직 추가, 테스트 | 📋 계획 |
| 2/28 | P2 WM_NCHITTEST 설계 및 프로토타입 | 📋 계획 |
| 3/1 | P2 WM_NCHITTEST 구현 및 테스트 | 📋 계획 |

---

## 📞 체크포인트

각 작업 완료 후 다음을 확인:

1. **코드 수정 후**
   - [ ] `cargo build` 성공
   - [ ] 컴파일 경고 없음
   - [ ] `get_errors` 확인

2. **테스트 후**
   - [ ] QUICKREF.md의 테스트 시나리오 통과
   - [ ] 콘솔에 에러 없음
   - [ ] 로그 파일 확인 (`get_runtime_log_path`)

3. **기록 후**
   - [ ] BUGFIX_TRACKER.md에 결과 기록
   - [ ] 성공/실패 여부 명확히 표시
   - [ ] 다음 작업 우선순위 조정

---

## 🚨 긴급 상황 대응

### Issue #1이 여전히 발생하면

1. **즉시 확인**:
   ```javascript
   const full = await Diagnostics.runFullDiagnostics()
   console.log(JSON.stringify(full, null, 2))
   ```

2. **BUGFIX_TRACKER.md에 기록**:
   - 진단 결과 붙여넣기
   - 환경 정보 (Windows 버전, WebView2 버전)
   - 시도한 복구 방법

3. **대체 방안**:
   - P1 작업 우선 진행 (타이밍 개선)
   - WebView2 버전 확인 및 업데이트
   - Tauri 버전 확인

### Mouse Mode 문제가 악화되면

1. **임시 비활성화**:
   - Mouse Mode 버튼 숨기기
   - 폴링 간격을 10ms로 단축 (임시)

2. **P2 작업 우선순위 상향**:
   - WM_NCHITTEST를 P1으로 변경
   - 다른 작업 보류

---

## 💡 팁

### 빠른 재빌드
```bash
# Rust만 재빌드
cd src-tauri && cargo build --release

# JS는 수정하면 자동 반영 (리로드만 하면 됨)
```

### 진단 단축키 (브라우저 콘솔에서)
```javascript
// 전역 함수로 등록
window.checkOverlay = async () => {
  console.clear();
  const result = await Diagnostics.runFullDiagnostics();
  console.table(result);
  return result;
};

// 사용: checkOverlay()
```

### 로그 실시간 확인 (Windows)
```powershell
# PowerShell에서
$logPath = "$env:TEMP\boardcanvas-runtime.log"
Get-Content $logPath -Wait -Tail 20
```

---

**마지막 업데이트**: 2026-02-25  
**다음 리뷰**: P0 테스트 완료 후
