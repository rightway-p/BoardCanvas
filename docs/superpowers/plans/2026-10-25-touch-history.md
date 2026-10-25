# Touch History Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Independent code review follows implementation.

**Goal:** 승인된 더블/트리플 두 손가락 탭과 페이지별 기록 복구를 검증하고 베타 배포한다.

**Architecture:** 접촉/타이머를 독립 모듈로 관리하고 기존 자동 터치 이벤트에 연결한다. 기존 판서 기록과 페이지 객체를 사용하며 카메라와 기록을 분리한다.

**Tech Stack:** Vanilla JS, Node test runner/VM, browser pointer events, Tauri Windows signed release.

## 1. 탭 판정 모듈

- [x] `tests/history-taps.test.js`: 가상 시계로 더블 탭 300ms 대기, 트리플 탭 단독 redo, 접촉 해제 순서, 12px 이동/원점 복귀, 250ms 긴 누름, 세 손가락, 페이지 격리/취소를 검증하고 실패 확인.
- [x] `js/domain/history-taps.js`: `createTracker({ now, setTimeout, clearTimeout, onAction })`에서 `down(id, point, context, joinWindowMs)`, `move(id, point)`, `up(id, point, cancelled)`, `cancel()`, `reject()`, `isCandidate()` 제공. 이벤트마다 유효성 누적, 두 접촉 모두 해제 후 횟수 증가, 다음 접촉 시작 시 기존 타이머 중단, 긴 누름은 묶음 취소.
- [x] `node --test tests/history-taps.test.js` 통과 확인.

## 2. 앱 통합

- [x] `tests/automatic-touch.test.js`: 실제 기록과 가상 시계로 탭 undo/redo, 카메라 유지, 이동/펜/페이지 전환/취소를 검증하고 실패 확인.
- [x] `js/board-2.0.1-ui.js`: 판정기 지연 생성, 실제 페이지 객체 전달, 기존 자동 터치 이벤트에 연결. 탭 후보 중 카메라 갱신 보류. 임계값 초과는 기존 패닝/줌 즉시 적용. 입력 초기화/도구 조작에서 취소.
- [x] `index.html`, `app.js`: 새 모듈을 UI보다 먼저 로드. `package.json`의 테스트 명령에 단위 테스트 추가.
- [x] `node --test tests/history-taps.test.js tests/automatic-touch.test.js`와 `npm test`, `npm run web:build`, `git diff --check` 실행.

## 3. 리뷰와 베타 배포

- [x] 별도 검토자에게 요구사항과 변경 파일을 전달하고 코드 리뷰. 중요 지적 수정 후 재검증.
- [x] 현재 원격 dev/베타 버전을 조회하고 충돌 없는 다음 버전으로 package/Cargo/Tauri/릴리스 노트 갱신. 검증 기록 작성.
- [ ] 사용자 승인된 배포 범위에서 커밋, PR, Gemini 리뷰 확인/대응, dev 통합. 기존 서명 릴리스 workflow를 사용한다.
- [ ] Windows CI, 버전별 설치 파일/서명, rolling board-beta manifest 버전과 해시를 확인한다. 배포 상태와 하드웨어 미검증 범위를 보고한다.
