# Overlay 버그 분석 및 해결 방안

📍 **문서 위치**: [README](README.md) > [NAVIGATION](NAVIGATION.md) > BUG_ANALYSIS  
🎯 **다음 문서**: 수정 추적 → [BUGFIX_TRACKER.md](BUGFIX_TRACKER.md) | 작업 계획 → [TODO.md](TODO.md)  
📚 **문서 구조**: [NAVIGATION.md 참조](NAVIGATION.md)

---

## 발견된 주요 버그

### 🔴 Critical Bug #1: `set_window_overlay_surface` 로직 오류

**위치**: `src-tauri/src/main.rs:225-228`

**현재 코드**:
```rust
let next_style = if enabled {
  ex_style | (WS_EX_LAYERED as usize)
} else {
  ex_style | (WS_EX_LAYERED as usize)  // ← 버그!
};
```

**문제**:
- `enabled`가 `true`든 `false`든 항상 `WS_EX_LAYERED`를 추가함
- Overlay 종료 시 `WS_EX_LAYERED`를 제거하지 않음
- 이로 인해 Overlay 종료 후에도 창이 layered 상태로 남아있음

**영향**:
- Overlay 모드 종료 후에도 창 스타일이 초기화되지 않음
- 반복적인 Overlay 진입/퇴출 시 스타일이 누적됨
- 창 렌더링 성능에 영향 가능

**해결책**:
```rust
let next_style = if enabled {
  ex_style | (WS_EX_LAYERED as usize)
} else {
  ex_style & !(WS_EX_LAYERED as usize)  // ← 수정: LAYERED 비트 제거
};
```

---

### 🟡 Issue #2: 창 스타일 변경 후 갱신 누락

**문제**:
- Windows API에서 `SetWindowLongPtrW`로 스타일을 변경한 후
- 창을 명시적으로 갱신하지 않으면 즉시 반영되지 않을 수 있음

**해결책**:
```rust
use windows_sys::Win32::UI::WindowsAndMessaging::{
  SetWindowPos, SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER
};

// 스타일 설정 후
let _ = unsafe { SetWindowLongPtrW(hwnd_sys, GWL_EXSTYLE, next_style as isize) };

// 창 갱신 강제 (프레임 재계산 트리거)
unsafe {
  SetWindowPos(
    hwnd_sys,
    0,  // HWND_TOP
    0, 0, 0, 0,
    SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER
  );
}
```

**효과**:
- DWM과 창 관리자가 스타일 변경을 즉시 인식
- 투명도 적용이 더 확실하게 동작

---

### 🟡 Issue #3: DWM 호출 순서 최적화

**현재 순서**:
1. WS_EX_LAYERED 설정
2. DwmExtendFrameIntoClientArea 호출

**권장 순서**:
1. DwmExtendFrameIntoClientArea로 마진 초기화
2. WS_EX_LAYERED 설정
3. SetWindowPos로 창 갱신
4. 다시 DwmExtendFrameIntoClientArea 호출

**이유**:
- DWM이 layered 창을 더 잘 인식
- 일부 시스템에서 순서가 중요할 수 있음

---

## Overlay Visual Bug 근본 원인 분석

### 1. WebView Alpha 설정 실패 가능성

**현재 상태**:
- 로그: `overlay.webview.background-alpha.applied requested=0 returned=0`
- 하지만 실제로는 불투명

**검증 필요**:
```javascript
// 설정 직후 실제 값 확인
await setDesktopWebviewBackgroundAlpha(0);
const actual = await verifyWebviewBackgroundAlpha();
if (actual !== 0) {
  console.error("WebView alpha mismatch!", { requested: 0, actual });
}
```

**가능한 원인**:
- WebView2가 초기화 중이라 설정이 무시됨
- WebView2 버전 호환성 문제
- 비동기 타이밍 문제 (설정과 검증 사이에 딜레이 필요)

**해결책**:
```rust
// WebView 준비 상태 확인 후 설정
unsafe {
  controller2
    .SetDefaultBackgroundColor(COREWEBVIEW2_COLOR {
      R: 0, G: 0, B: 0, A: alpha,
    })
    .map_err(|error| format!("SetDefaultBackgroundColor failed: {error}"))?;
  
  // 즉시 검증
  let mut applied = COREWEBVIEW2_COLOR { R: 0, G: 0, B: 0, A: 0 };
  controller2
    .DefaultBackgroundColor(&mut applied)
    .map_err(|error| format!("verification failed: {error}"))?;
  
  if applied.A != alpha {
    return Err(format!(
      "Alpha mismatch: requested {}, got {}",
      alpha, applied.A
    ));
  }
  
  Ok(applied.A)
}
```

### 2. CSS Transparent 적용 타이밍

**현재 순서** (`applyOverlayModeUI`):
1. CSS에서 모든 요소를 `transparent`로 설정
2. Tauri 명령 호출 (비동기)

**문제**:
- CSS 적용과 네이티브 설정이 비동기로 실행됨
- 렌더링 타이밍 이슈 가능

**해결책**:
```javascript
async function applyOverlayModeUI(active) {
  if (active) {
    // 1. CSS 투명 설정
    document.documentElement.style.background = "transparent";
    // ... (모든 CSS 설정)
    
    // 2. 브라우저가 CSS를 적용할 시간 확보
    await new Promise(resolve => requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    }));
    
    // 3. 네이티브 설정
    await setDesktopOverlaySurface(true);
    await setDesktopWebviewBackgroundAlpha(0);
    
    // 4. 검증
    const diagnostic = await Overlay.diagnoseOverlayState();
    if (diagnostic.issues.length > 0) {
      console.warn("Overlay activation issues:", diagnostic.issues);
      // 자동 복구 시도
    }
  }
}
```

### 3. 창 Z-order 및 포커스 이슈

**가능성**:
- AlwaysOnTop 설정이 DWM과 충돌
- 포커스 전환 중에 투명도 설정이 무시됨

**검증**:
```javascript
const snapshot = await captureOverlayWindowSnapshot(appWindowRef);
console.log("Before overlay:", {
  decorations: snapshot.decorations,
  alwaysOnTop: snapshot.alwaysOnTop,
  fullscreen: snapshot.fullscreen
});

await callWindowMethod(appWindowRef, "setDecorations", false);
// 딜레이
await new Promise(r => setTimeout(r, 100));

await callWindowMethod(appWindowRef, "setAlwaysOnTop", true);
// 딜레이
await new Promise(r => setTimeout(r, 100));

await setDesktopOverlaySurface(true);
await setDesktopWebviewBackgroundAlpha(0);
```

---

## Mouse Mode Interaction Bug 분석

### 1. WS_EX_TRANSPARENT 동적 전환의 한계

**현재 방식**:
- 20ms마다 커서 위치 폴링
- 툴바 위에 있으면 `WS_EX_TRANSPARENT` 제거
- 툴바 밖에 있으면 `WS_EX_TRANSPARENT` 추가

**문제점**:
1. **타이밍 지연**: 20ms 간격으로 느림 → 클릭이 누락될 수 있음
2. **스타일 변경 비용**: 매번 `SetWindowLongPtrW` 호출
3. **경쟁 조건**: 클릭과 스타일 변경 타이밍이 어긋남

### 2. 더 나은 해결 방안

#### Option A: WM_NCHITTEST 메시지 처리 (권장)

**원리**:
- Windows가 마우스 이벤트를 보내기 전에 `WM_NCHITTEST` 메시지를 보냄
- 이 메시지를 처리해서 픽셀별로 클릭 가능 여부를 결정
- `WS_EX_TRANSPARENT` 없이도 부분 투과 가능

**장점**:
- 실시간 반응 (폴링 불필요)
- 픽셀 단위 정밀 제어
- 성능 우수

**구현**:
```rust
use windows_sys::Win32::UI::WindowsAndMessaging::{
  SetWindowLongPtrW, GWLP_WNDPROC, HTCLIENT, HTTRANSPARENT
};

// 커스텀 윈도우 프로시저
unsafe extern "system" fn custom_wnd_proc(
  hwnd: HWND,
  msg: u32,
  wparam: WPARAM,
  lparam: LPARAM,
) -> LRESULT {
  if msg == WM_NCHITTEST {
    // 원래 결과 얻기
    let result = DefWindowProcW(hwnd, msg, wparam, lparam);
    
    if result == HTCLIENT {
      // 클라이언트 영역에서 클릭 시
      // 툴바 영역인지 확인 (JavaScript에서 영역 정보 전달 필요)
      if is_toolbar_region(lparam) {
        return HTCLIENT;  // 클릭 허용
      } else {
        return HTTRANSPARENT;  // 클릭 투과
      }
    }
    
    return result;
  }
  
  // 원래 프로시저 호출
  CallWindowProcW(original_proc, hwnd, msg, wparam, lparam)
}
```

#### Option B: 창 리전 사용

**원리**:
- `SetWindowRgn`으로 클릭 가능한 영역만 정의
- 나머지 영역은 자동으로 투과

**장점**:
- 폴링 불필요
- `WS_EX_TRANSPARENT` 불필요

**단점**:
- 리전 업데이트 비용
- 복잡한 모양 처리 어려움

#### Option C: 폴링 간격 단축 + 예측

**개선**:
```javascript
// 20ms → 5ms로 단축
const OVERLAY_MOUSE_POLL_INTERVAL_MS = 5;

// 마우스 이동 방향 예측
let lastCursorX = 0, lastCursorY = 0;

async function pollOverlayMouseTracker() {
  const cursor = await readWindowCursorPositionCss();
  const velocityX = cursor.x - lastCursorX;
  const velocityY = cursor.y - lastCursorY;
  
  // 툴바로 향하는 중이면 미리 활성화
  const predictedX = cursor.x + velocityX * 2;
  const predictedY = cursor.y + velocityY * 2;
  
  const willHitToolbar = isToolbarHitByPoint(predictedX, predictedY);
  
  if (willHitToolbar) {
    // 미리 WS_EX_TRANSPARENT 제거
    await queueOverlayNativeIgnoreState(false);
  }
  
  lastCursorX = cursor.x;
  lastCursorY = cursor.y;
}
```

---

## 우선순위별 수정 계획

### Phase 1: Critical Bug 수정 (즉시)

1. ✅ `set_window_overlay_surface`의 LAYERED 제거 로직 수정
2. ✅ `SetWindowPos`로 창 갱신 추가
3. ✅ WebView alpha 설정 후 검증 강화

### Phase 2: Overlay Visual Bug 해결 (1일)

1. DWM 호출 순서 최적화
2. CSS 적용 후 딜레이 추가
3. 자동 진단 및 복구 로직 추가

### Phase 3: Mouse Mode 개선 (2-3일)

**Option A 구현** (WM_NCHITTEST 방식):
1. Rust에서 커스텀 윈도우 프로시저 구현
2. JavaScript에서 툴바 영역 정보 전달
3. 실시간 hit-test 처리

**Fallback**: 폴링 간격 단축 + 예측 알고리즘

### Phase 4: 테스트 및 안정화 (1-2일)

1. 진단 도구로 모든 케이스 테스트
2. 자동 복구 시나리오 검증
3. 성능 프로파일링

---

## 즉시 적용 가능한 Quick Fix

### 1. Rust 코드 수정

```rust
// src-tauri/src/main.rs
#[tauri::command]
fn set_window_overlay_surface(window: tauri::Window, enabled: bool) -> Result<bool, String> {
  #[cfg(target_os = "windows")]
  {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::Graphics::Dwm::DwmExtendFrameIntoClientArea;
    use windows_sys::Win32::UI::Controls::MARGINS;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
      GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos,
      GWL_EXSTYLE, WS_EX_LAYERED,
      SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER
    };

    let hwnd = window
      .hwnd()
      .map_err(|error| format!("window handle unavailable: {error}"))?;
    let hwnd_sys: HWND = hwnd.0 as HWND;

    // 1. DWM 마진 설정
    let margins = if enabled {
      MARGINS {
        cxLeftWidth: -1,
        cxRightWidth: -1,
        cyTopHeight: -1,
        cyBottomHeight: -1,
      }
    } else {
      MARGINS {
        cxLeftWidth: 0,
        cxRightWidth: 0,
        cyTopHeight: 0,
        cyBottomHeight: 0,
      }
    };
    
    let frame_result = unsafe { DwmExtendFrameIntoClientArea(hwnd_sys, &margins) };
    if frame_result != 0 {
      return Err(format!("DwmExtendFrameIntoClientArea failed: {frame_result}"));
    }

    // 2. WS_EX_LAYERED 설정/제거
    let ex_style = unsafe { GetWindowLongPtrW(hwnd_sys, GWL_EXSTYLE) } as usize;
    let next_style = if enabled {
      ex_style | (WS_EX_LAYERED as usize)
    } else {
      ex_style & !(WS_EX_LAYERED as usize)  // 수정: 비트 제거
    };
    
    unsafe { SetWindowLongPtrW(hwnd_sys, GWL_EXSTYLE, next_style as isize) };

    // 3. 창 갱신 강제
    unsafe {
      SetWindowPos(
        hwnd_sys,
        0,
        0, 0, 0, 0,
        SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER
      );
    }

    return Ok(true);
  }

  #[cfg(not(target_os = "windows"))]
  {
    let _ = (window, enabled);
    Err("Window overlay surface command is only supported on Windows.".to_string())
  }
}
```

### 2. JavaScript 개선

```javascript
// app.js - applyOverlayModeUI 개선
async function applyOverlayModeUI(active) {
  const nextActive = Boolean(active);
  
  if (nextActive) {
    // CSS 투명 설정
    // ... (기존 코드)
    
    // CSS 적용 대기
    await new Promise(r => requestAnimationFrame(() => {
      requestAnimationFrame(r);
    }));
    
    // 네이티브 설정 (순차 실행)
    const surfaceOk = await setDesktopOverlaySurface(true);
    await new Promise(r => setTimeout(r, 50));  // 50ms 딜레이
    
    const alphaOk = await setDesktopWebviewBackgroundAlpha(0);
    await new Promise(r => setTimeout(r, 50));
    
    // 검증 및 재시도
    if (window.Diagnostics) {
      const diagnostic = await window.Diagnostics.verifyOverlayState();
      if (!diagnostic.isTransparent) {
        console.warn("Overlay not transparent, retrying...");
        await setDesktopWebviewBackgroundAlpha(0);
        await new Promise(r => setTimeout(r, 100));
        const retry = await window.Diagnostics.verifyOverlayState();
        console.log("Retry result:", retry);
      }
    }
  } else {
    // 종료 시도 순서 역순
    await setDesktopWebviewBackgroundAlpha(255);
    await new Promise(r => setTimeout(r, 50));
    await setDesktopOverlaySurface(false);
  }
  
  // ... (나머지 UI 업데이트)
}
```

---

## 검증 체크리스트

수정 후 다음 항목들을 확인:

- [ ] `Diagnostics.verifyWindowStyles()` → `has_layered: true` (Overlay ON)
- [ ] `Diagnostics.verifyWindowStyles()` → `has_layered: false` (Overlay OFF)
- [ ] `Diagnostics.verifyWebviewBackgroundAlpha()` → `0` (Overlay ON)
- [ ] `Diagnostics.verifyWebviewBackgroundAlpha()` → `255` (Overlay OFF)
- [ ] Overlay 진입 시 창이 완전히 투명
- [ ] Overlay 종료 시 배경색이 복원됨
- [ ] Mouse mode ON 시 툴바가 클릭 가능
- [ ] Mouse mode ON 시 툴바 밖이 클릭 투과
- [ ] 반복 진입/퇴출 시 안정적 동작

---

## 결론

**주요 발견**:
1. ✅ `set_window_overlay_surface`에 치명적 버그 발견 (enabled=false 시 LAYERED 제거 안 됨)
2. ⚠️ 창 갱신(`SetWindowPos`) 누락으로 스타일 변경이 즉시 반영 안 됨
3. ⚠️ CSS와 네이티브 설정 간 타이밍 동기화 필요
4. ⚠️ Mouse mode는 WM_NCHITTEST 방식으로 근본 개선 필요

**권장 우선순위**:
1. **즉시**: Rust 버그 수정 (LAYERED 제거 로직) ✅ **완료**
2. **1일 내**: SetWindowPos 추가 + 타이밍 개선 ✅ **완료 (SetWindowPos)**
3. **1주 내**: WM_NCHITTEST 기반 Mouse mode 재구현

---

## 📋 추적 및 체크리스트

상세한 시도 이력, 테스트 체크리스트, 다음 단계는 다음 문서를 참조:

👉 **[BUGFIX_TRACKER.md](BUGFIX_TRACKER.md)** - 수정 사항 추적 및 재발 방지 가이드

이 문서에는 다음이 포함됨:
- ✅ 적용된 수정사항 및 커밋 기록
- ❌ 시도했으나 효과 없었던 접근법 (중복 시도 방지)
- 🔄 다음 시도 예정인 우선순위별 작업
- 📊 테스트 체크리스트 및 진단 명령어
- 📝 새 문제 발견 시 템플릿
