# Board Canvas - 모듈 구조

📍 **문서 위치**: [README](README.md) > [NAVIGATION](NAVIGATION.md) > MODULES  
🎯 **다음 문서**: 진단 → [DIAGNOSTICS_GUIDE.md](DIAGNOSTICS_GUIDE.md) | 개발 → [BUG_ANALYSIS.md](BUG_ANALYSIS.md)  
📚 **문서 구조**: [NAVIGATION.md 참조](NAVIGATION.md)

---

## 개요

app.js (4771줄)가 너무 커서 유지보수가 어려운 문제를 해결하기 위해 핵심 기능을 모듈로 분리했습니다.

## 모듈 구조

```
Board/
├── index.html         # 메인 HTML (모듈 로더)
├── app.js            # 메인 애플리케이션 (점진적 리팩토링 예정)
├── styles.css        # 스타일시트
└── js/               # 모듈 디렉토리
    ├── runtime.js       # 런타임/플랫폼/로깅
    ├── overlay.js       # 오버레이 모드 + 진단
    └── diagnostics.js   # 개발자 진단 도구
```

## 모듈 설명

### 1. `js/runtime.js`
**역할**: 런타임 플랫폼 감지, Tauri 통신, 로깅

**주요 함수**:
- `detectRuntimePlatform()` - 플랫폼 감지 (Windows/macOS/Linux)
- `isLikelyTauriProtocol()` - Tauri 환경 확인
- `getTauriInvoke()` - Tauri invoke API 획득
- `invokeDesktopCommand(command, args, options)` - Tauri 명령 실행
- `queueRuntimeLog(message, details)` - 런타임 로그 기록
- `setupRuntimeErrorLogging()` - 에러 로깅 초기화

**사용 예시**:
```javascript
import { queueRuntimeLog, invokeDesktopCommand } from './js/runtime.js';

queueRuntimeLog("app.init", { version: "1.0.0" });
const result = await invokeDesktopCommand("some_command", { arg: "value" });
```

### 2. `js/overlay.js`
**역할**: 오버레이 모드 제어 및 실시간 진단

**주요 함수**:
- `setDesktopWebviewBackgroundAlpha(alpha)` - WebView 투명도 설정 + 검증
- `setDesktopOverlaySurface(enabled)` - DWM overlay surface 설정 + 검증
- `setWindowClickThrough(enabled)` - WS_EX_TRANSPARENT 설정 + 검증
- `verifyWindowStyles()` - 창 스타일 확인
- `verifyWebviewBackgroundAlpha()` - WebView 투명도 확인
- `getWindowRect()` - 창 위치/크기 조회
- `diagnoseOverlayState()` - 오버레이 상태 전체 진단
- `diagnoseMouseModeState(expectedClickThrough)` - 마우스 모드 상태 진단

**사용 예시**:
```javascript
import { setDesktopWebviewBackgroundAlpha, diagnoseOverlayState } from './js/overlay.js';

// 투명도 설정 (자동 검증 포함)
await setDesktopWebviewBackgroundAlpha(0);

// 전체 진단
const diagnostic = await diagnoseOverlayState();
console.log(diagnostic.issues);  // 문제점 배열
```

### 3. `js/diagnostics.js`
**역할**: 개발자용 진단 도구 (window.Diagnostics로 노출)

**주요 함수**:
- `Diagnostics.verifyWindowStyles()` - 창 스타일 조회
- `Diagnostics.verifyWebviewBackgroundAlpha()` - WebView 투명도 조회
- `Diagnostics.getWindowRect()` - 창 정보 조회
- `Diagnostics.setWindowClickThrough(enabled)` - 클릭 투과 설정
- `Diagnostics.runFullDiagnostics()` - 전체 진단 실행
- `Diagnostics.verifyOverlayState()` - Overlay 진입 후 검증
- `Diagnostics.verifyMouseModeState(expected)` - Mouse mode 검증

**사용 예시** (브라우저 콘솔):
```javascript
// 전체 진단
await Diagnostics.runFullDiagnostics();

// Overlay 진입 후 상태 확인
await Diagnostics.verifyOverlayState();

// Mouse mode ON 후 확인
await Diagnostics.verifyMouseModeState(true);
```

## Rust 백엔드 명령어

### 새로 추가된 Tauri 명령어:

1. **verify_window_styles** - 창 스타일 검증
   ```javascript
   await invoke("verify_window_styles");
   // 반환: { ex_style, has_layered, has_transparent, has_toolwindow, has_topmost }
   ```

2. **verify_webview_background_alpha** - WebView 투명도 검증
   ```javascript
   await invoke("verify_webview_background_alpha");
   // 반환: u8 (0-255)
   ```

3. **get_window_rect** - 창 위치/크기 조회
   ```javascript
   await invoke("get_window_rect");
   // 반환: { left, top, right, bottom, width, height }
   ```

4. **set_window_click_through** - 클릭 투과 설정
   ```javascript
   await invoke("set_window_click_through", { enabled: true });
   // 반환: WindowStyleInfo (설정 후 검증된 스타일)
   ```

## 이슈 진단 워크플로우

### Issue #1: Overlay visual bug

**증상**: Overlay ON 시 창이 불투명

**진단 절차**:
```javascript
// 1. Overlay 진입 시도
await enterOverlayMode();

// 2. 상태 진단
const diagnostic = await Diagnostics.verifyOverlayState();

// 3. 결과 확인
console.log("WebView Alpha:", diagnostic.webviewAlpha);  // 기대값: 0
console.log("Has Layered:", diagnostic.hasLayered);       // 기대값: true

// 4. 문제가 있으면 수동으로 재설정
if (!diagnostic.isTransparent) {
  await invokeDesktopCommand("set_webview_background_alpha", { alpha: 0 });
  await Diagnostics.verifyWebviewBackgroundAlpha();  // 재검증
}
```

### Issue #2: Overlay mouse mode interaction bug

**증상**: 마우스 모드 ON인데 클릭이 하부 앱으로 전달됨

**진단 절차**:
```javascript
// 1. Mouse mode ON
await setOverlayMousePassthrough(true);

// 2. 상태 진단
const diagnostic = await Diagnostics.verifyMouseModeState(true);

// 3. 결과 확인
console.log("Has Transparent:", diagnostic.hasTransparent);  // 기대값: true

// 4. 문제가 있으면 수동으로 재설정
if (!diagnostic.stylesMatch) {
  const result = await Diagnostics.setWindowClickThrough(true);
  console.log("Force set result:", result);
}
```

## 향후 계획

1. **app.js 점진적 리팩토링**
   - Drawing 엔진 → `js/drawing.js`
   - PDF 관리 → `js/pdf.js`
   - Session 관리 → `js/session.js`
   - UI 관리 → `js/ui.js`

2. **테스트 자동화**
   - Overlay 진입/퇴출 테스트
   - Mouse mode 전환 테스트
   - 투명도 설정 검증 테스트

3. **에러 복구 자동화**
   - 진단 결과에 따른 자동 수정
   - 일관성 검사기 추가

## 개발자 노트

- 모든 `overlay.js` 함수는 설정 후 자동으로 검증을 수행합니다
- 로그는 자동으로 `C:\Users\<USER>\AppData\Local\Temp\boardcanvas-runtime.log`에 기록됩니다
- 브라우저 콘솔에서 `window.Diagnostics`를 통해 실시간 진단이 가능합니다
- 모듈은 ES6 module 형식이므로 `type="module"` 필요

## 빌드

변경 사항 없음. 기존과 동일하게:

```bash
cd src-tauri
cargo build
```

또는:

```bash
npm run tauri dev
npm run tauri build
```
