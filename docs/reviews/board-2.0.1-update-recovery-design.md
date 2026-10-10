# Board 2.0.1 업데이트·복구 설계 독립 검토

- 검토일: 2026-10-05
- 대상: `docs/update-recovery-plan.md` 66줄 설계 제안
- 검토 대상 SHA-256: `4D94D8FBE2FC4148EB95E756E0851D20E8A8D3A79A9440F7757CAF0F463C7E07`
- 독립 리뷰어: collaboration subagent `/root/update_recovery_design_review`
- 설계 작성자: 별도 subagent `/root/update_recovery_spec`; 리뷰어는 대상 설계와 제품 코드를 수정하지 않았다.
- 실행 주체/환경: 부모 `/root`가 위임한 Codex subagent; `C:/Users/pjd01/.codex/worktrees/board-2-0-1/Board`에서 문서·설정을 읽고 공식 Tauri 1 문서를 대조했다.
- 모델: 부모 세션 모델 상속. 이 subagent 인터페이스는 실제 모델 ID 및 추론 설정을 노출하지 않아 정확한 ID/강도를 검증해 기재할 수 없다. subagent 시작과 실제 검토 실행은 확인됐다.
- 범위: 구현 전 설계 문서의 요구 충족·데이터 보존·설치 실패·복구 경로 검토. 구현 코드/PR/배포 검증은 수행하지 않았다.
- 상태: 아래 actionable finding은 모두 문서에 반영됐다. 구현·Windows 설치/다운그레이드 검증 및 PR 리뷰는 미완료다.

## Actionable finding 및 처리

| ID | 대상 | 문제 | 수정 및 재검토 결과 |
|---|---|---|---|
| D1 | `docs/update-recovery-plan.md:24` | 시작 메뉴 진입점만으로는 업데이트가 앱 설치 폴더를 부분 삭제했을 때 복구 실행 파일까지 사라질 수 있다. 기록·데이터 경로의 안전 경계도 불명확했다. | 설치 앱 폴더 밖의 안정 경로에 최소 복구 실행 파일과 journal/checkpoint/artifact를 두도록 명시했다. identity·경로·앱/WebView 잠금 검증 실패 시 중단한다. `:46`, `:51`의 수용 기준도 확인했다. 해결. |
| D2 | `docs/update-recovery-plan.md:23` | 버전만 고정하면 다른 앱, 아키텍처, 설치 종류 또는 동일 버전의 다른 artifact를 선택할 수 있다. | 앱 identity `com.rightway.boardcanvas`, OS/architecture, per-user NSIS 종류, 서명 package digest 및 실행 파일 fingerprint를 고정·대조하도록 구체화했다. 전역 최신 릴리스에서 이전 항목을 추측하지 않는다. 해결. |
| D3 | `docs/update-recovery-plan.md:29` | 설치 프로그램 시작 뒤 실패/강제 종료를 단순 실패로 처리하면 부분 설치를 기존 버전 사용 가능 상태로 오판할 수 있다. | 실제 실행 파일을 검증하고 재실행에 성공하기 전 `needs-verification`을 유지한다. 부분 설치는 외부 도구로 이전 검증 설치본과 보존 데이터를 회복한다. `:28`, `:48`도 일관되게 반영됐다. 해결. |
| D4 | `docs/update-recovery-plan.md:30` | '복구에 성공한 버전은 자동 업데이트에서 제외'가 정상 버전 또는 일반 업데이트 확인 전체를 끄는 동작으로 해석될 수 있었다. | 실패한 특정 version/artifact의 자동 재제안만 억제한다. 일반 최신 버전 및 메뉴 수동 확인은 유지하고 실패 대상 재설치에는 사용자 승인이 필요하다. 일반 feed의 comparator는 유지한다. 해결. |
| D5 | `docs/update-recovery-plan.md:31` | 기존 v1의 복구 기준이 없는데 안내만 하고 교체 업데이트를 진행하면 직전 설치본 복구 요구를 충족하지 못한다. | 복구 기준·기존 설치 형태·데이터 호환성을 검증하지 못하면 기존 설치본 교체 업데이트를 차단한다. 최초 신규 설치와 기존 v1 bootstrap을 구분하고 bootstrap은 사용자 결정 및 실제 형태 확인 전까지 미정으로 남겼다. `:50`도 확인했다. 해결. |
| D6 | `docs/update-recovery-plan.md:23` | 서명 NSIS ZIP/installer의 package digest를 설치된 EXE digest와 동일하게 대조할 수 없는 점이 보완 중 문구에 드러났다. | package digest와 installed binary fingerprint를 서로 다른 필드와 검증 단계로 구분했다. `:28-29`에 실제 EXE identity/version/fingerprint 확인과 재실행 조건을 명시했고 fingerprint의 신뢰 출처·검증 방식은 `:35`에 구현 전 확정 사항으로 남겼다. 해결. |

## False positive

- 최종 채택한 finding 중 false positive로 철회한 항목은 없다.
- 'Tauri 1은 다운그레이드 경로를 만들 수 없다'는 결론은 채택하지 않았다. 공식 문서는 version comparator override로 rollback 경로를 구성할 수 있다고 설명한다. 이 가능성은 일반 업데이트의 버전 검사를 전역으로 끄거나 실제 NSIS 다운그레이드가 성공한다는 증거가 아니다.

## 수정/보류 이유와 완료 경계

- 최신 데이터 보존은 설계 `:26-27`, `:47`에서 확인했다. 업데이트 이후 새 편집 데이터부터 별도로 보존하고, 이전 checkpoint를 덮어쓰지 않으며, 무손실 호환/변환을 확인할 수 없으면 전환을 차단한다. 원본 두 상태를 남기고 데이터 손실을 성공으로 처리하지 않는다.
- 기존 앱 identity 및 app-data/WebView 프로필 경로는 `:51`에서 유지 대상으로 명시됐다. 현재 설정의 identifier `com.rightway.boardcanvas`와 대조했다.
- 기존 v1 직접 실행 파일/portable/installer 형태, 기존 데이터 경로, 실제 직전 서명 설치본은 확인이 필요하다. GitHub Releases가 비었다는 설계 작성자의 확인 기록을 설계 제한으로 검토했으며, 본 리뷰어가 별도로 GitHub API를 재조회한 것은 아니다.
- endpoint·키 운영·서명 설치본·실행 파일 fingerprint 신뢰 출처와 검증 방식·구버전 데이터 호환 범위는 구현 전에 확정해야 한다. 이 미정 항목을 작동하는 복구 기능으로 보고하지 않는다.
- 실제 Windows per-user NSIS 업그레이드/다운그레이드, 앱 부팅 실패, 프로필 잠금, 설치 후 강제 종료/부분 설치, 전원 중단, 체크포인트 실패, 변환 실패와 신규 편집 보존 시험은 미실행이다. `allowDowngrades` 설정 기본값만으로 검증을 대신할 수 없다.
- 이번 검토는 제품 코드가 없는 순수 설계 문서 검토이므로 Antigravity CLI는 실행하지 않았다. 이후 구현 PR은 별도 독립 Codex 및 Antigravity 리뷰와 실제 설치 검증을 모두 충족하기 전 완료로 처리할 수 없다.
- 단순성 검토: 기존 Tauri updater 및 Windows 네이티브 설치 경로를 우선하는 제안이다. 직전 설치본 복구에 필요한 최소 외부 도구·journal·checkpoint 범위이며 새 서버/프레임워크나 모든 과거 버전 관리 요구를 추가하지 않았다. 보안·무결성·복구 조건은 단순화 대상으로 생략하지 않았다.

## 확인 자료

- `src-tauri/tauri.conf.json`: 번들 비활성 및 현재 앱 identifier 확인.
- [Tauri 1 updater 공식 문서](https://v1.tauri.app/v1/guides/distribution/updater/): 서명 update artifact, Windows NSIS updater bundle, comparator override 및 Windows 설치 실행/재시작 동작을 대조했다.
- 문서 보완 후 작성자가 `git diff --check` 통과를 보고했으며, 리뷰 기록 작성 후 리뷰어도 동일한 문서 범위에서 공백 오류를 확인한다. build/lint/typecheck/test 또는 installer 실행은 이 설계 검토의 검증 결과에 포함하지 않는다.
