# Overlay 이슈 진단 가이드

📍 **문서 위치**: [README](README.md) > [NAVIGATION](NAVIGATION.md) > DIAGNOSTICS_GUIDE  
🎯 **다음 문서**: 개발자용 → [BUGFIX_TRACKER.md](BUGFIX_TRACKER.md) | 기술 분석 → [BUG_ANALYSIS.md](BUG_ANALYSIS.md)  
📚 **문서 구조**: [NAVIGATION.md 참조](NAVIGATION.md)

---

## 빠른 시작

애플리케이션 실행 후, 브라우저 개발자 콘솔(F12)을 열어 진단 도구를 사용할 수 있습니다.

## 이슈 #1: Overlay visual bug (불투명 문제)

### 증상
- Overlay ON 시 창이 투명하지 않고 흰색/단색 배경이 보임
- `overlay.webview.background-alpha.applied`는 성공했는데 실제로는 불투명

### 진단 방법

```javascript
// 1. Overlay 모드 진입
// UI에서 Overlay 버튼 클릭 또는 F8

// 2. 콘솔에서 상태 확인
await Diagnostics.verifyOverlayState()

// 예상 출력:
// {
//   timestamp: "2026-02-25T...",
//   hasLayered: true,      // ← 이게 false면 문제
//   hasTransparent: false, // (마우스 모드 OFF면 false가 정상)
//   webviewAlpha: 0,       // ← 이게 0이 아니면 문제
//   expectedAlpha: 0,
//   isTransparent: true,   // ← 이게 false면 문제
//   stylesMatch: true
// }
```

### 문제 발견 시 대응

#### 문제 A: `webviewAlpha`가 0이 아님

```javascript
// 강제로 재설정
await window.__TAURI__.invoke("set_webview_background_alpha", { alpha: 0 });

// 검증
await Diagnostics.verifyWebviewBackgroundAlpha();
// 반환값이 0이어야 함
```

#### 문제 B: `hasLayered`가 false

```javascript
// DWM overlay surface 재설정
await window.__TAURI__.invoke("set_window_overlay_surface", { enabled: true });

// 검증
const styles = await Diagnostics.verifyWindowStyles();
console.log("Has Layered:", styles.has_layered);  // true여야 함
```

#### 문제 C: CSS/DOM 투명도 문제

```javascript
// HTML 배경 확인
console.log(document.documentElement.style.backgroundColor);  // "transparent"여야 함
console.log(document.body.style.backgroundColor);             // "transparent"여야 함

// 강제 적용
document.documentElement.style.background = "transparent";
document.documentElement.style.backgroundColor = "transparent";
document.body.style.background = "transparent";
document.body.style.backgroundColor = "transparent";
```

### 전체 진단 실행

```javascript
// 모든 상태 한 번에 확인
const report = await Diagnostics.runFullDiagnostics();
console.table(report);

// 문제점만 추출
const overlay = await Overlay.diagnoseOverlayState();
console.log("Issues:", overlay.issues);
// 예: [{ type: "webview-not-transparent", expected: 0, actual: 255 }]
```

---

## 이슈 #2: Overlay mouse mode interaction bug

### 증상
- 마우스 모드 ON 상태인데 툴바 뒤가 클릭됨
- 툴바는 보이지만 클릭/호버가 하부 앱으로 전달됨
- `overlay.mousemode.forward-unavailable` 로그 발생

### 진단 방법

```javascript
// 1. 마우스 모드 ON 후
// UI에서 마우스 모드 버튼 클릭 또는 F7

// 2. 상태 확인
await Diagnostics.verifyMouseModeState(true)

// 예상 출력:
// {
//   timestamp: "2026-02-25T...",
//   hasTransparent: true,        // ← 이게 false면 문제
//   expectedTransparent: true,
//   stylesMatch: true             // ← 이게 false면 문제
// }
```

### 문제 발견 시 대응

#### 문제: `hasTransparent`가 false (클릭 투과가 안 됨)

```javascript
// 강제로 클릭 투과 설정
const result = await Diagnostics.setWindowClickThrough(true);
console.log("Click-through enabled:", result.has_transparent);  // true여야 함

// 재검증
const styles = await Diagnostics.verifyWindowStyles();
console.log("Has WS_EX_TRANSPARENT:", styles.has_transparent);  // true여야 함
```

#### 문제: 툴바 영역에서도 클릭이 안 됨

이것은 정상입니다. 현재 구현은 다음과 같이 동작합니다:
- **마우스 모드 OFF**: 전체 창이 클릭 가능
- **마우스 모드 ON**: 전체 창이 클릭 투과, 툴바 영역만 JavaScript로 감지

하지만 툴바 근처에서 클릭이 하부로 전달된다면:

```javascript
// 툴바 히트 영역 확인
const toolbar = document.querySelector('.toolbar');
const rect = toolbar.getBoundingClientRect();
console.log("Toolbar rect:", rect);

// 현재 마우스 위치가 툴바 안인지 테스트
// (창 위에서 마우스를 움직인 후)
const cursor = await window.__TAURI__.invoke("get_global_cursor_position");
console.log("Cursor:", cursor);
```

---

## 로그 분석

### 로그 파일 위치 확인

```javascript
const logPath = await window.__TAURI__.invoke("get_runtime_log_path");
console.log("Log file:", logPath);
// Windows: C:\Users\<USER>\AppData\Local\Temp\boardcanvas-runtime.log
```

### 주요 로그 패턴

#### Overlay 진입 성공
```
overlay.enter.start
overlay.snapshot.captured
overlay.host-surface.applied enabled=true
overlay.webview.background-alpha.applied requested=0 returned=0
overlay.enter.success
```

#### Overlay 진입 실패 (투명도 문제)
```
overlay.enter.start
overlay.host-surface.applied enabled=true
overlay.webview.background-alpha.unavailable requested=0 returned=255  ← 문제
```

#### Mouse mode 진입 성공
```
overlay.mousemode.start active=true
overlay.click-through.applied enabled=true verified={has_transparent:true}
```

#### Mouse mode 진입 실패 (클릭 투과 문제)
```
overlay.mousemode.start active=true
overlay.click-through.unavailable enabled=true  ← 문제
overlay.mousemode.forward-unavailable           ← 문제
```

---

## 자동 복구 시도

문제가 지속되면 다음 순서로 시도:

### 1단계: 기본 재설정

```javascript
// Overlay 퇴출 후 재진입
// UI에서 F8 두 번 (퇴출 → 진입)

// 또는 스크립트로:
// (app.js 함수 사용)
await exitOverlayMode();
await new Promise(r => setTimeout(r, 500));
await enterOverlayMode();
```

### 2단계: 강제 재설정

```javascript
// WebView 투명도 강제 설정
await window.__TAURI__.invoke("set_webview_background_alpha", { alpha: 0 });

// DWM overlay 강제 설정
await window.__TAURI__.invoke("set_window_overlay_surface", { enabled: true });

// 검증
await Diagnostics.verifyOverlayState();
```

### 3단계: 전체 재초기화

```javascript
// Overlay 완전 퇴출
await exitOverlayMode();

// 창 스타일 초기화
await window.__TAURI__.invoke("set_window_overlay_surface", { enabled: false });
await window.__TAURI__.invoke("set_webview_background_alpha", { alpha: 255 });

// 잠시 대기
await new Promise(r => setTimeout(r, 1000));

// 재진입
await enterOverlayMode();
```

---

## 개발자용: 지속적 모니터링

```javascript
// 5초마다 자동 진단
const monitor = setInterval(async () => {
  const overlay = await Diagnostics.verifyOverlayState();
  const mouseMode = await Diagnostics.verifyMouseModeState(
    overlayMousePassthrough  // app.js 변수
  );
  
  console.log("Overlay OK:", overlay.isTransparent);
  console.log("Mouse mode OK:", mouseMode.stylesMatch);
  
  if (!overlay.isTransparent || !mouseMode.stylesMatch) {
    console.warn("⚠️ Inconsistency detected!", { overlay, mouseMode });
  }
}, 5000);

// 모니터링 중지
clearInterval(monitor);
```

---

## 요약

| 문제 | 진단 명령 | 기대값 | 복구 명령 |
|------|-----------|--------|-----------|
| Overlay 불투명 | `Diagnostics.verifyWebviewBackgroundAlpha()` | `0` | `invoke("set_webview_background_alpha", {alpha:0})` |
| Overlay 배경 보임 | `Diagnostics.verifyWindowStyles()` | `has_layered: true` | `invoke("set_window_overlay_surface", {enabled:true})` |
| 마우스 모드 클릭 투과 안 됨 | `Diagnostics.verifyMouseModeState(true)` | `has_transparent: true` | `Diagnostics.setWindowClickThrough(true)` |

모든 진단은 자동으로 로그에 기록되므로, 문제 발생 시 로그 파일을 확인하면 원인 파악에 도움이 됩니다.
