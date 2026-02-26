# Overlay 버그 수정 추적 문서

📍 **문서 위치**: [README](README.md) > [NAVIGATION](NAVIGATION.md) > BUGFIX_TRACKER  
🎯 **다음 문서**: 빠른 테스트 → [QUICKREF.md](QUICKREF.md) | 기술 분석 → [BUG_ANALYSIS.md](BUG_ANALYSIS.md)  
📚 **문서 구조**: [NAVIGATION.md 참조](NAVIGATION.md)

---

> **목적**: 시도한 해결책을 기록하여 중복 시도를 방지하고 효과적인 접근법을 식별

---

## 🔍 현재 상태 (2026-02-25)

### Issue #1: Overlay Visual Bug (불투명 문제)
- **상태**: 🔴 미해결
- **우선순위**: P0 (Critical)
- **마지막 업데이트**: 2026-02-25

### Issue #2: Mouse Mode Interaction Bug
- **상태**: 🟡 부분 해결 (recovery zone 추가됨)
- **우선순위**: P1 (High)
- **마지막 업데이트**: 2026-02-25

---

## ✅ 적용된 수정사항

### [2026-02-25] Critical Bug Fix: WS_EX_LAYERED 제거 로직 수정

**문제 코드**:
```rust
// src-tauri/src/main.rs:225-228 (OLD)
let next_style = if enabled {
  ex_style | (WS_EX_LAYERED as usize)
} else {
  ex_style | (WS_EX_LAYERED as usize)  // ❌ 버그: 항상 추가만 함
};
```

**수정 코드**:
```rust
let next_style = if enabled {
  ex_style | (WS_EX_LAYERED as usize)
} else {
  ex_style & !(WS_EX_LAYERED as usize)  // ✅ 수정: enabled=false 시 비트 제거
};
```

**변경 사항**:
- ✅ Overlay 종료 시 WS_EX_LAYERED 비트 제거 추가
- ✅ SetWindowPos로 창 갱신 강제 추가 (SWP_FRAMECHANGED)
- ✅ DWM margins를 먼저 설정하도록 순서 변경

**예상 효과**:
- Overlay 종료 후 창 스타일이 올바르게 초기화됨
- 반복 진입/퇴출 시 스타일 누적 문제 해결
- DWM 변경사항이 즉시 반영됨

**테스트 필요**:
- [ ] Overlay 진입 후 `Diagnostics.verifyWindowStyles()` → `has_layered: true`
- [ ] Overlay 종료 후 `Diagnostics.verifyWindowStyles()` → `has_layered: false`
- [ ] 10회 반복 진입/퇴출 후 안정성 확인

**커밋**: `[예정]`

---

### [2026-02-25] 모듈 분리 및 진단 도구 추가

**추가된 파일**:
- `js/runtime.js` - Runtime/Logging 모듈
- `js/overlay.js` - Overlay 관리 + 자동 진단
- `js/diagnostics.js` - 개발자 진단 도구
- `js/init.js` - 모듈 통합 브릿지

**추가된 Rust 명령어**:
- `verify_window_styles()` - 창 스타일 실시간 검증
- `verify_webview_background_alpha()` - WebView 투명도 검증
- `get_window_rect()` - 창 위치/크기 조회
- `set_window_click_through()` - WS_EX_TRANSPARENT 설정 + 검증

**효과**:
- ✅ 실시간 상태 검증 가능
- ✅ 브라우저 콘솔에서 진단 가능 (`window.Diagnostics`)
- ✅ 설정 후 자동 검증으로 불일치 조기 발견

**커밋**: `5b7d772` (또는 최근 커밋)

---

## ❌ 시도했으나 효과 없었던 접근법

### [이전] 로깅만 추가
- **시도**: 로그 메시지를 더 상세하게 추가
- **결과**: ❌ 문제 식별에 도움은 되었으나 해결은 안 됨
- **이유**: 로깅만으로는 API 호출과 실제 결과의 불일치를 해결할 수 없음
- **교훈**: 진단 도구가 필요했음 (검증 명령어 추가로 해결)

### [이전] overlay.mousemode.forward 옵션 사용 시도
- **시도**: Tauri의 setIgnoreCursorEvents 사용
- **결과**: ❌ API가 존재하지 않거나 미구현
- **로그**: `overlay.mousemode.forward-unavailable` 발생
- **교훈**: 폴링 + WS_EX_TRANSPARENT 동적 전환 방식으로 우회 (현재 구현)
- **향후**: WM_NCHITTEST 방식이 더 나을 것으로 판단

---

## 🔄 다음 시도 예정 (우선순위별)

### Priority 0: 즉시 적용 (오늘)

#### ✅ P0-1: Rust Critical Bug 수정
- [x] `set_window_overlay_surface` LAYERED 제거 로직 수정
- [x] `SetWindowPos` 추가
- [ ] 빌드 및 테스트
- [ ] 커밋 및 푸시

**체크리스트**:
```bash
# 빌드
cd src-tauri
cargo build

# 실행 및 테스트
cargo run

# 브라우저 콘솔에서:
# 1. Overlay 진입 (F8)
# 2. await Diagnostics.verifyOverlayState()
# 3. Overlay 종료 (F8)
# 4. await Diagnostics.verifyWindowStyles()
# 5. has_layered가 false인지 확인
```

#### ⏳ P0-2: JavaScript 타이밍 개선
- [ ] `applyOverlayModeUI`에 딜레이 추가
- [ ] CSS 적용 후 `requestAnimationFrame` 대기
- [ ] 네이티브 설정을 순차적으로 실행 (await)
- [ ] 검증 및 자동 재시도 로직 추가

**변경 위치**: `app.js:1497` (applyOverlayModeUI 함수)

**예상 코드**:
```javascript
async function applyOverlayModeUI(active) {
  if (active) {
    // 1. CSS 투명 설정
    document.documentElement.style.background = "transparent";
    // ... (모든 CSS)
    
    // 2. CSS 렌더링 대기
    await new Promise(r => requestAnimationFrame(() => {
      requestAnimationFrame(r);
    }));
    
    // 3. 네이티브 설정 (순차)
    const appWindowRef = getTauriAppWindow();
    if (appWindowRef) {
      await setDesktopOverlaySurface(true);
      await new Promise(r => setTimeout(r, 50));
      
      await setDesktopWebviewBackgroundAlpha(0);
      await new Promise(r => setTimeout(r, 50));
      
      // 4. 검증 및 재시도
      if (window.Diagnostics) {
        const diag = await window.Diagnostics.verifyOverlayState();
        if (!diag.isTransparent) {
          console.warn("Overlay not transparent, retrying...");
          await setDesktopWebviewBackgroundAlpha(0);
          await new Promise(r => setTimeout(r, 100));
        }
      }
    }
  } else {
    // 종료 시 역순
    const appWindowRef = getTauriAppWindow();
    if (appWindowRef) {
      await setDesktopWebviewBackgroundAlpha(255);
      await new Promise(r => setTimeout(r, 50));
      await setDesktopOverlaySurface(false);
    }
    // CSS 복원...
  }
}
```

---

### Priority 1: 단기 개선 (1-2일)

#### P1-1: WebView Alpha 설정 강화
- [ ] WebView2 준비 상태 확인 로직 추가
- [ ] 설정 실패 시 에러 반환 (현재는 무시됨)
- [ ] 재시도 로직 추가 (최대 3회)

**변경 위치**: `src-tauri/src/main.rs:set_webview_background_alpha`

#### P1-2: DWM 호출 순서 최적화
- [ ] DwmExtendFrameIntoClientArea를 두 번 호출 (전/후)
- [ ] SetWindowPos 후 50ms 딜레이
- [ ] 검증 명령어로 각 단계 확인

#### P1-3: 자동 복구 로직
- [ ] `overlay.js`에 자동 복구 함수 추가
- [ ] 진단 결과에 따라 자동으로 재설정
- [ ] 최대 3회 재시도 후 사용자에게 알림

```javascript
async function autoRecoverOverlay() {
  const diag = await diagnoseOverlayState();
  
  if (diag.issues.length === 0) {
    return { success: true };
  }
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`Recovery attempt ${attempt}/3`);
    
    for (const issue of diag.issues) {
      if (issue.type === "webview-not-transparent") {
        await setDesktopWebviewBackgroundAlpha(0);
        await new Promise(r => setTimeout(r, 100));
      }
      if (issue.type === "missing-layered-style") {
        await setDesktopOverlaySurface(true);
        await new Promise(r => setTimeout(r, 100));
      }
    }
    
    const recheck = await diagnoseOverlayState();
    if (recheck.issues.length === 0) {
      return { success: true, attempts: attempt };
    }
  }
  
  return { success: false, lastDiag: diag };
}
```

---

### Priority 2: 중기 개선 (1주)

#### P2-1: Mouse Mode - WM_NCHITTEST 구현

**현재 방식의 문제점**:
- 20ms 폴링으로 느림 (클릭 누락 가능)
- SetWindowLongPtrW 반복 호출 비용
- 경쟁 조건 (클릭과 스타일 변경 타이밍)

**WM_NCHITTEST 방식**:
- [ ] Rust에서 커스텀 윈도우 프로시저 구현
- [ ] JavaScript에서 툴바 영역 정보 전달 (Tauri 명령)
- [ ] WM_NCHITTEST에서 픽셀별 hit-test
- [ ] HTCLIENT vs HTTRANSPARENT 반환

**장점**:
- 실시간 반응 (폴링 불필요)
- 픽셀 단위 정밀 제어
- CPU 사용량 감소

**참고 구현**:
```rust
// 1. 툴바 영역 저장 (Tauri 명령으로 받음)
static TOOLBAR_RECT: Mutex<Option<RECT>> = Mutex::new(None);

#[tauri::command]
fn update_toolbar_region(left: i32, top: i32, right: i32, bottom: i32) {
  let mut rect = TOOLBAR_RECT.lock().unwrap();
  *rect = Some(RECT { left, top, right, bottom });
}

// 2. 커스텀 윈도우 프로시저
unsafe extern "system" fn overlay_wnd_proc(
  hwnd: HWND,
  msg: u32,
  wparam: WPARAM,
  lparam: LPARAM,
) -> LRESULT {
  if msg == WM_NCHITTEST {
    let x = (lparam & 0xFFFF) as i32;
    let y = ((lparam >> 16) & 0xFFFF) as i32;
    
    if let Some(rect) = *TOOLBAR_RECT.lock().unwrap() {
      if x >= rect.left && x <= rect.right &&
         y >= rect.top && y <= rect.bottom {
        return HTCLIENT;  // 툴바: 클릭 가능
      }
    }
    
    return HTTRANSPARENT;  // 나머지: 투과
  }
  
  CallWindowProcW(ORIGINAL_PROC, hwnd, msg, wparam, lparam)
}
```

**작업 단계**:
1. [ ] 윈도우 프로시저 서브클래싱 구현
2. [ ] 툴바 영역 업데이트 명령 추가
3. [ ] JavaScript에서 ResizeObserver로 툴바 추적
4. [ ] 기존 폴링 코드 제거
5. [ ] 테스트 및 검증

---

## 📊 테스트 체크리스트

### 기본 동작 테스트

#### Overlay 진입/퇴출
- [ ] F8로 Overlay 모드 진입
- [ ] 창이 완전히 투명해짐
- [ ] 툴바만 보임
- [ ] 배경의 다른 앱이 보임
- [ ] F8로 Overlay 모드 종료
- [ ] 배경색이 복원됨
- [ ] 창이 정상 모드로 복원됨

#### 연속 테스트
- [ ] Overlay 진입/퇴출 10회 반복
- [ ] 메모리 누수 없음
- [ ] 성능 저하 없음
- [ ] 각 회차마다 동작 일관됨

#### Mouse Mode
- [ ] Overlay 모드에서 F7로 Mouse Mode 활성화
- [ ] 툴바가 클릭 가능
- [ ] 툴바 밖 클릭이 하부 앱으로 전달됨
- [ ] F7로 Mouse Mode 비활성화
- [ ] 전체 창이 클릭 가능해짐

### 진단 도구 테스트

```javascript
// 브라우저 콘솔에서 실행

// 1. 초기 상태
await Diagnostics.runFullDiagnostics();
// 예상: 모든 값이 정상 (Overlay OFF 상태)

// 2. Overlay 진입 후
// UI에서 F8 누름
await Diagnostics.verifyOverlayState();
// 예상:
// - isTransparent: true (또는 여기서 문제 발견)
// - hasLayered: true
// - webviewAlpha: 0
// - issues: []

// 3. Mouse Mode 진입 후
// UI에서 F7 누름
await Diagnostics.verifyMouseModeState(true);
// 예상:
// - hasTransparent: true
// - stylesMatch: true

// 4. Overlay 종료 후
// UI에서 F8 누름
await Diagnostics.verifyWindowStyles();
// 예상:
// - has_layered: false  ← 이게 핵심!
// - has_transparent: false
```

### 성능 테스트

```javascript
// Mouse Mode 폴링 체크
let pollCount = 0;
const origLog = console.log;
console.log = (...args) => {
  if (args[0]?.includes?.('overlay.mousemode.hit-state')) {
    pollCount++;
  }
  origLog(...args);
};

// 10초 동안 마우스를 움직임
setTimeout(() => {
  console.log(`Poll count in 10s: ${pollCount}`);
  // 예상: ~500회 (20ms 간격)
  console.log = origLog;
}, 10000);
```

---

## 📝 실패 원인 분석 템플릿

새로운 문제 발견 시 다음 형식으로 기록:

```markdown
### [날짜] 문제명

**증상**:
- 

**재현 방법**:
1. 
2. 
3. 

**로그 분석**:
- 

**진단 결과**:
```javascript
await Diagnostics.runFullDiagnostics();
// 결과 붙여넣기
```

**시도한 해결책**:
1. [ ] 해결책 1 - 결과: 
2. [ ] 해결책 2 - 결과: 

**근본 원인**:


**최종 해결책**:


**커밋**: 
```

---

## 🔖 참고 자료

### Windows API 문서
- [SetWindowLongPtrW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowlongptrw)
- [DwmExtendFrameIntoClientArea](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/nf-dwmapi-dwmextendframeintoclientarea)
- [SetWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos)
- [WM_NCHITTEST](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-nchittest)

### Tauri 문서
- [Window Plugin](https://tauri.app/v1/api/js/window/)
- [Custom Commands](https://tauri.app/v1/guides/features/command/)

### 프로젝트 문서
- [MODULES.md](MODULES.md) - 모듈 구조
- [DIAGNOSTICS_GUIDE.md](DIAGNOSTICS_GUIDE.md) - 진단 가이드
- [BUG_ANALYSIS.md](BUG_ANALYSIS.md) - 상세 분석

---

## 📈 진행 상황 요약

| 항목 | 상태 | 완료일 |
|------|------|--------|
| Critical Bug 수정 (LAYERED 제거) | ✅ 완료 | 2026-02-25 |
| SetWindowPos 추가 | ✅ 완료 | 2026-02-25 |
| 진단 도구 추가 | ✅ 완료 | 2026-02-25 |
| JS 타이밍 개선 | ⏳ 대기 | - |
| 자동 복구 로직 | ⏳ 대기 | - |
| WM_NCHITTEST 구현 | 📋 계획 | - |

**다음 액션**: 
1. 현재 수정사항 빌드 및 테스트
2. 테스트 결과에 따라 JS 타이밍 개선 적용 여부 결정
3. 진단 도구로 실제 문제 원인 식별

**예상 완료일**: 
- P0: 2026-02-25 (오늘)
- P1: 2026-02-27
- P2: 2026-03-03
