# Action Feedback and Eraser Preview Implementation Plan

> **For agentic workers:** Execute inline using superpowers:executing-plans; request independent code review after implementation.

**Goal:** 동작 완료 알림과 실제 크기에 맞는 지우개 커서로 조작 결과를 명확히 한다.

**Architecture:** `js/interaction-feedback.js`가 DOM 오버레이와 입력/타이머 수명을 담당한다. 기존 명령의 성공 지점에서 알림을 호출하며 지우개 크기는 기존 지우기 계산에서 주입한다.

**Tech Stack:** Vanilla JS/CSS, Node test runner, Playwright/CDP, Tauri.

## 작업 순서

- [x] `tests/interaction-feedback.test.js`에서 알림 대체/자동 숨김, 도구 변경만 알림, 지우개 지름/좌표/소유권/종료 동작을 먼저 검증하여 실패 확인.
- [x] `js/interaction-feedback.js`의 `create({ root, canvas, document, window, getState })`로 `notify`, `refresh`, `hideCursor` 구현. 이벤트는 canvas에 등록하고 오버레이는 pointer-events:none으로 유지.
- [x] `js/board-2.0.1-ui.js`에서 모듈 초기화와 camera/page/lock/fit 연결. `js/render-doc-draw.js`의 도구 UI/clear, `js/strokes-history.js`의 undo/redo, `js/presets-ui.js`의 굵기, `js/session-pdf-toolbar.js`의 문서 상태 연결.
- [x] `styles.css`, `app.js`, `index.html`에 스타일과 순차 로딩 반영. `package.json` 테스트 명령 추가.
- [x] `npm test`, `npm run web:build`, `git diff --check`와 브라우저 시각/입력 검증. 독립 리뷰 지적 수정.
- [ ] 사용자 승인된 자동 진행/베타 배포 범위에서 버전 메타데이터와 검증 기록 갱신, PR 및 베타 게시/업데이트 피드 확인.
