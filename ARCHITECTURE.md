# ARCHITECTURE.md — 계층형 브리지 아키텍처 (Layered Bridge Architecture)

> Tauri의 특성(이원화된 런타임, IPC 경계, 플랫폼 조건부 기능)에 맞춘 BoardCanvas의 설계 패턴.
> 새로 코드를 추가하거나 기존 코드를 옮길 때 **이 문서의 경계를 침범하지 않는다**는 것이 핵심이다.

---

## 0. 왜 이 패턴이 필요한가

현재 코드에는 다음과 같은 경계 붕괴가 일어나 있다:

- `js/runtime-overlay.js` 한 파일이 IPC 호출, 플랫폼 감지, 도메인 로직(풀스크린·오버레이·마우스 추적), 이벤트 발신까지 다 담당 → **1964줄**.
- `js/` 폴더 안에 **두 개의 모듈 시스템**(클래식 `<script>` 체인 + ES6 module)이 공존하며, `runtime.js`/`overlay.js`가 `runtime-overlay.js`의 일부를 중복 구현함.
- `src-tauri/src/main.rs`에 모든 커맨드가 집약되어 있고, `#[cfg(target_os = "windows")]`가 파일 전역에 흩어져 있음.
- `tauri.conf.json`의 `allowlist`가 `window: { all: true }` — 권한 범위가 넓음.

Tauri 프로젝트는 태생적으로 **JS 런타임과 네이티브(Rust) 런타임 두 개가 IPC로 얇게 연결된 구조**다. 이 경계를 코드 구조에 그대로 반영하지 않으면, 플랫폼 분기와 IPC 호출이 도메인 로직에 오염되어 테스트도 리팩토링도 불가능해진다.

---

## 1. 5개 레이어 정의

```
┌──────────────────────────────────────────────────────────────┐
│  L5. Controllers (js/controllers/*)                          │
│      DOM 이벤트 → 도메인 액션 디스패치. 상태 결합점.           │
├──────────────────────────────────────────────────────────────┤
│  L4. Domain (js/domain/*)                                    │
│      순수 로직: 스트로크, PDF 렌더, 세션, 툴바 레이아웃, 프리셋.│
│      Tauri·DOM·네이티브 API 호출 금지.                         │
├──────────────────────────────────────────────────────────────┤
│  L3. Platform Capability (js/platform/*)                     │
│      런타임/플랫폼 감지, 기능 플래그(overlay·mouse-passthrough).│
│      "여기서 가능한가?"만 판단하고 실행은 L2에 위임.            │
├──────────────────────────────────────────────────────────────┤
│  L2. IPC Gateway (js/ipc/*)                                  │
│      `window.__TAURI__.invoke`의 유일한 호출 지점.             │
│      커맨드 이름·인자·반환 타입을 한 곳에서 관리. JSDoc 타입.   │
├──────────────────────────────────────────────────────────────┤
│  L1. Native Commands (src-tauri/src/commands/*)              │
│      도메인별로 분리된 Rust 커맨드 모듈. 플랫폼 분기는 해당    │
│      모듈 내부에서만 사용.                                     │
└──────────────────────────────────────────────────────────────┘
```

**의존 방향은 위→아래만 허용**. 거꾸로 올라가는 의존성은 이벤트(`emit`/`listen`)로 표현한다.

---

## 2. 레이어별 규칙

### L1 — Native Commands (Rust)

- `src-tauri/src/commands/` 하위에 도메인별 모듈:
  - `commands/logging.rs` — `get_runtime_log_path`, `append_runtime_log`
  - `commands/cursor.rs` — `get_global_cursor_position`, `get_window_cursor_position`
  - `commands/overlay.rs` — `set_webview_background_alpha`, `set_window_overlay_surface`, `set_window_click_through`, `verify_*`
  - `commands/window.rs` — `get_window_rect`, `verify_window_styles`
- 각 모듈은 `pub fn register(builder)` 빌더 헬퍼 또는 `pub fn handlers()` 튜플을 노출.
- `main.rs`는 모듈 등록만 담당 (10줄 이하 목표).
- `#[cfg(target_os = "windows")]`는 **해당 모듈 내부에서만** 사용. 비Windows 분기는 해당 모듈이 자체 처리하여 `Err("... only supported on Windows")` 반환.
- `tauri.conf.json`의 `allowlist`는 실제 사용하는 항목으로 최소화 (추후 별도 작업).

### L2 — IPC Gateway (JS)

- `js/ipc/gateway.js` — `window.__TAURI__.invoke`를 감싼 유일한 저수준 함수 `invokeDesktop(command, args, options)`.
- `js/ipc/commands.js` — 도메인별 고수준 래퍼 함수:
  ```js
  export function setWebviewBackgroundAlpha(alpha) { ... }
  export function getWindowRect() { ... }
  ```
  한 커맨드당 한 함수. 인자 검증·로깅·에러 매핑을 여기서 수행.
- **다른 레이어(L3/L4/L5)는 `window.__TAURI__`를 직접 참조하지 않는다.** 반드시 `ipc/commands.js`의 export를 import.
- 웹 런타임(Tauri 아님)에서는 각 함수가 `null`/`false`를 반환하거나 명시적 예외. L3가 이걸 기능 플래그로 변환.

### L3 — Platform Capability

- `js/platform/runtime.js` — `detectRuntimePlatform()`, `isDesktopAppRuntime()`, `isWindowsDesktopRuntime()`, `isLikelyTauriProtocol()`.
- `js/platform/capabilities.js` — 기능 플래그:
  ```js
  export const canUseOverlayMode = () => isWindowsDesktopRuntime();
  export const canUseMousePassthrough = () => isWindowsDesktopRuntime();
  export const canUseNativeFullscreen = () => isDesktopAppRuntime();
  ```
- `js/platform/logging.js` — `queueRuntimeLog`, `setupRuntimeErrorLogging`. 내부적으로 L2의 `appendRuntimeLog` 사용.

### L4 — Domain

- `js/domain/strokes/` — `strokes-core.js`, `strokes-history.js`, `stroke-eraser.js` 이동.
- `js/domain/drawing/` — 브러시·포인터 스무딩·드로우 프레임 스케줄링 (`render-doc-draw.js`에서 추출).
- `js/domain/pdf/` — PDF 엔진 로드, 렌더, export (`session-pdf-toolbar.js` + `render-doc-draw.js`에서 추출).
- `js/domain/session/` — IndexedDB 저장·복원 (`session-pdf-toolbar.js`에서 추출).
- `js/domain/toolbar/` — 툴바 레이아웃·도킹·플로팅 (`session-pdf-toolbar.js`에서 추출).
- `js/domain/presets/` — `presets-utils.js`, `presets-ui.js` 중 순수 로직만.
- **Tauri·네이티브 API·DOM 이벤트 리스너를 직접 걸지 않는다.** `<canvas>` 조작은 필요하지만 버튼 클릭 리스너는 L5가 담당.

### L5 — Controllers

- `js/controllers/tool-controller.js` — 펜/지우개 토글, 프리셋 적용.
- `js/controllers/overlay-controller.js` — 오버레이 모드 진입/종료, 마우스 패스스루. L2+L3+L4를 조합.
- `js/controllers/fullscreen-controller.js` — 풀스크린 토글.
- `js/controllers/document-controller.js` — PDF 열기·네비게이션·export.
- `js/controllers/toolbar-controller.js` — 툴바 드래그·도킹.
- `js/controllers/bootstrap.js` — DOM ready 시 모든 컨트롤러 초기화. 기존 `events-init.js`를 여기로 흡수.

컨트롤러는 **상태 + DOM 바인딩 + 디스패치**를 담당하지만, *계산 로직은 L4에 위임*한다.

---

## 3. 모듈 로딩 전략

### 현재 (두 개 시스템 공존)

- 클래식 `<script>` 순차 로딩 체인 (10개)
- `type="module"` ES6 모듈 (`init.js`가 `runtime.js`/`overlay.js`/`diagnostics.js`를 `window`에 노출)

### 목표 (단일 ES 모듈 시스템)

- `index.html`은 **`<script type="module" src="./js/main.js"></script>` 하나만** 로드.
- `js/main.js`가 `controllers/bootstrap.js`를 import → 컨트롤러들이 필요한 도메인·L2·L3를 import.
- PDF 라이브러리 같은 외부 벤더 스크립트는 기존처럼 classic `<script>`로 먼저 로드 (pdf.js는 ESM 빌드로 옮기는 것도 가능하지만 이번 범위 외).
- `app.js`의 fallback 시퀀셜 로더는 제거.

### 전역 변수 정책

- `js/globals.js`의 DOM 엘리먼트 캐시는 **DOM API 직접 참조로 대체**하거나, `js/dom/refs.js`로 격리해 필요한 컨트롤러만 import.
- `window.Diagnostics` 같은 개발자 편의 전역은 유지하되, `js/dev/diagnostics.js`에서 명시적으로 `window`에 붙이는 단일 지점을 둔다.

---

## 4. 이벤트 방향 규약

| 방향 | 메커니즘 | 예시 |
|------|----------|------|
| JS → Rust (요청-응답) | L2의 `invokeDesktop` | 오버레이 알파값 설정 |
| Rust → JS (비동기 통지) | `app.emit_all` + L2의 `listen` 헬퍼 | 창 닫힘 알림 |
| L5 → L4 (도메인 액션) | 함수 호출 | `strokes.undo()` |
| L4 → L5 (상태 변화 통지) | L4가 제공하는 구독 함수 또는 CustomEvent | `strokes.onChange(listener)` |

L4가 L5를 직접 호출하거나 DOM을 조작하면 규약 위반.

---

## 5. 디렉토리 타깃 구조

```
js/
├── main.js                    # 엔트리포인트 (ES module)
├── ipc/
│   ├── gateway.js             # invokeDesktop 래퍼
│   └── commands.js            # 도메인별 고수준 IPC 함수
├── platform/
│   ├── runtime.js             # 플랫폼 감지
│   ├── capabilities.js        # 기능 플래그
│   └── logging.js             # 런타임 로그 큐
├── domain/
│   ├── strokes/
│   ├── drawing/
│   ├── pdf/
│   ├── session/
│   ├── toolbar/
│   └── presets/
├── controllers/
│   ├── bootstrap.js
│   ├── tool-controller.js
│   ├── overlay-controller.js
│   ├── fullscreen-controller.js
│   ├── document-controller.js
│   └── toolbar-controller.js
├── dom/
│   └── refs.js                # (선택) DOM 엘리먼트 참조 집중
└── dev/
    └── diagnostics.js         # window.Diagnostics 노출

src-tauri/src/
├── main.rs                    # 모듈 등록만
└── commands/
    ├── mod.rs
    ├── logging.rs
    ├── cursor.rs
    ├── overlay.rs
    └── window.rs
```

---

## 6. 리팩토링 단계 (phased plan)

각 단계는 **독립적으로 빌드 가능하고 기능 회귀 없음**을 목표로 한다.

1. **Phase 1 — Rust 커맨드 모듈화**
   `src-tauri/src/commands/`로 분할. `main.rs`는 등록만. 외부 동작 동일.

2. **Phase 2 — L2 IPC Gateway 분리**
   `js/ipc/gateway.js` + `js/ipc/commands.js` 생성. `runtime-overlay.js`·`overlay.js`·`diagnostics.js`의 `invoke` 호출을 전부 여기로 이동. 기존 호출부는 새 함수 import로 교체.

3. **Phase 3 — L3 Platform 레이어 분리**
   `js/platform/runtime.js`·`capabilities.js`·`logging.js`로 분리. 중복되던 `runtime.js` + `runtime-overlay.js`의 플랫폼 감지를 단일화.

4. **Phase 4 — L4 Domain 추출**
   `session-pdf-toolbar.js`를 `session/`·`pdf/`·`toolbar/`·`popups/`로 분할. `render-doc-draw.js`를 `pdf/`·`drawing/`으로 분할. 각 도메인은 순수 함수/상태 컨테이너로.

5. **Phase 5 — L5 Controllers 구성 + 모듈 시스템 단일화**
   `events-init.js`의 리스너 설정을 컨트롤러별로 이전. `index.html`을 `main.js` 단일 엔트리로 전환. `app.js` fallback 제거.

6. **Phase 6 — 잔여 정리**
   `window.Diagnostics` 노출 지점 통합, `allowlist` 최소화, 죽은 코드 제거, `MODULES.md`·`README.md` 업데이트.

각 Phase 종료 시 체크리스트:
- [ ] `npm run desktop:build` 성공
- [ ] 데스크톱 실행 후 그리기·지우기·PDF 로드·오버레이 진입/종료 수동 확인
- [ ] `Diagnostics.runFullDiagnostics()` 통과
- [ ] Git commit

---

## 7. 새 코드 작성 시 체크리스트

- [ ] 이 코드가 어느 레이어에 속하는가? (L1~L5 중 하나)
- [ ] 한 레이어 위(또는 아래 한 단계)만 의존하는가?
- [ ] IPC 호출이 있다면 `js/ipc/commands.js`를 거치는가?
- [ ] 플랫폼 분기가 있다면 `js/platform/capabilities.js`의 플래그로 표현되는가?
- [ ] Rust 커맨드가 있다면 `src-tauri/src/commands/` 하위 적절한 모듈에 등록했는가?
- [ ] 테스트 불가능한 부분(DOM·Tauri)과 가능한 부분(도메인)이 섞이지 않았는가?

---

**마지막 업데이트**: 2026-04-17
