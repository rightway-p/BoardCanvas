# 📚 전체 문서 인덱스

> **생성일**: 2026-02-25  
> **목적**: 프로젝트의 모든 문서를 한눈에 파악

---

## 🎯 시작점

| 문서 | 크기 | 역할 | 대상 |
|------|------|------|------|
| **[README.md](README.md)** | 5.2KB | 프로젝트 진입점 | 모든 사용자 |
| **[NAVIGATION_QUICK.md](NAVIGATION_QUICK.md)** | 1페이지 | 빠른 네비게이션 | 시간이 없는 사용자 |
| **[NAVIGATION.md](NAVIGATION.md)** | 14KB | 완전한 네비게이션 가이드 | 체계적 학습 원하는 사용자 |

---

## 📋 핵심 작업 문서 (우선순위 순)

### ⭐ P0: 가장 중요
| 문서 | 크기 | 핵심 내용 | 언제 읽나 |
|------|------|-----------|-----------|
| **[BUGFIX_TRACKER.md](BUGFIX_TRACKER.md)** | 13KB | ✅ 적용된 수정<br>❌ 실패한 접근<br>🔄 다음 작업 | 버그 작업 전 **반드시** |
| **[TODO.md](TODO.md)** | 7.6KB | 작업 체크리스트<br>우선순위<br>이번 주 목표 | 매일 아침 |
| **[QUICKREF.md](QUICKREF.md)** | 3.7KB | 빌드/테스트 명령어<br>성공 지표 | 작업 시작 전 |

### 🔧 P1: 기술 문서
| 문서 | 크기 | 핵심 내용 | 언제 읽나 |
|------|------|-----------|-----------|
| **[BUG_ANALYSIS.md](BUG_ANALYSIS.md)** | 15KB | 근본 원인 분석<br>기술적 해결책<br>코드 예시 | 버그 이해 필요 시 |
| **[DIAGNOSTICS_GUIDE.md](DIAGNOSTICS_GUIDE.md)** | 7.8KB | 진단 절차<br>복구 방법<br>콘솔 명령어 | 문제 발생 시 |
| **[MODULES.md](MODULES.md)** | 6.3KB | 모듈 구조<br>API 레퍼런스<br>사용 예시 | 코드 이해 필요 시 |

---

## 🔄 문서 순회 패턴

### 패턴 1: 일일 개발 워크플로우
```
아침: TODO.md (할 일 확인)
  ↓
작업 전: BUGFIX_TRACKER.md (이미 시도한 방법 확인)
  ↓
구현 중: BUG_ANALYSIS.md (필요 시)
  ↓
테스트: QUICKREF.md (테스트 명령어)
  ↓
완료 후: BUGFIX_TRACKER.md (결과 기록)
  ↓
저녁: TODO.md (체크박스 업데이트)
```

### 패턴 2: 버그 발견 시
```
DIAGNOSTICS_GUIDE.md (진단)
  ↓
BUGFIX_TRACKER.md (이미 알려진 문제인지 확인)
  ↓
새 버그면: BUGFIX_TRACKER.md에 템플릿 기록
  ↓
분석: BUG_ANALYSIS.md 참조
  ↓
수정: TODO.md에 작업 추가
```

### 패턴 3: 처음 프로젝트 접근
```
README.md (15분)
  ↓
NAVIGATION_QUICK.md (5분)
  ↓
MODULES.md (코드 구조, 15분)
  ↓
QUICKREF.md (빌드/테스트, 10분)
  ↓
실제 작업: TODO.md로 이동
```

---

## 📊 문서 관계도

### 중심 허브: BUGFIX_TRACKER.md
```
           ┌─────────────────────┐
           │ BUGFIX_TRACKER.md   │ ◄─── 모든 작업의 중심
           │  (수정 추적)         │
           └──────────┬──────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        ▼             ▼             ▼
   BUG_ANALYSIS   QUICKREF      TODO.md
   (왜 발생?)     (테스트)      (다음 할 일)
        │             │             │
        └─────────────┴─────────────┘
                      │
                      ▼
              결과를 다시 기록
```

### 보조 문서들
```
README.md ─────► 모든 주요 문서로 링크
NAVIGATION.md ─► 모든 문서 간 경로 설명
DIAGNOSTICS_GUIDE.md ─► 사용자용 문제 해결
MODULES.md ─────► 코드 아키텍처 설명
```

---

## 🎓 역할별 필수 문서

### 신규 개발자
1. ✅ **README.md** - 프로젝트 이해
2. ✅ **NAVIGATION.md** - 문서 구조 파악
3. ✅ **MODULES.md** - 코드 구조 학습
4. ✅ **QUICKREF.md** - 빌드/테스트 방법
5. ⭐ **TODO.md** - 현재 작업 확인

**예상 시간**: ~1시간

### 버그 수정 담당자
1. ⭐ **TODO.md** - 우선순위 확인
2. ⭐ **BUGFIX_TRACKER.md** - 과거 시도 확인
3. ✅ **BUG_ANALYSIS.md** - 원인 분석
4. ✅ **QUICKREF.md** - 테스트

**예상 시간**: ~30분

### 사용자/테스터
1. ✅ **README.md** - 기본 이해
2. ✅ **DIAGNOSTICS_GUIDE.md** - 문제 해결
3. ✅ **QUICKREF.md** - 빠른 테스트

**예상 시간**: ~15분

---

## 🔍 상황별 빠른 찾기

### "지금 당장 빌드하고 싶어"
→ [QUICKREF.md](QUICKREF.md) (5분)

### "이 버그를 고치고 싶어"
→ [TODO.md](TODO.md) → [BUGFIX_TRACKER.md](BUGFIX_TRACKER.md) (15분)

### "왜 이런 버그가 생긴 거지?"
→ [BUG_ANALYSIS.md](BUG_ANALYSIS.md) (20분)

### "이미 누가 이거 시도했나?"
→ [BUGFIX_TRACKER.md](BUGFIX_TRACKER.md) > "시도했으나 효과 없었던 접근법" (3분)

### "프로젝트가 처음이야"
→ [README.md](README.md) → [NAVIGATION.md](NAVIGATION.md) (15분)

### "문제가 생겼어"
→ [DIAGNOSTICS_GUIDE.md](DIAGNOSTICS_GUIDE.md) (10분)

---

## 📝 문서 유지보수 체크리스트

### 버그 수정 완료 시
- [ ] **BUGFIX_TRACKER.md**: "적용된 수정사항"에 추가
- [ ] **TODO.md**: 체크박스 체크
- [ ] **README.md**: Known Issues 상태 업데이트

### 새 버그 발견 시
- [ ] **BUGFIX_TRACKER.md**: 템플릿 사용해 기록
- [ ] **TODO.md**: 새 작업 추가
- [ ] **README.md**: Known Issues에 추가 (필요시)

### 새 해결책 시도 시
- [ ] **먼저**: BUGFIX_TRACKER.md 확인 (중복 방지)
- [ ] **시도 후**: 결과를 BUGFIX_TRACKER.md에 기록
  - 성공 → "적용된 수정사항"
  - 실패 → "시도했으나 효과 없었던 접근법"

---

## 💡 문서 읽기 팁

### 시간이 없을 때
1. **NAVIGATION_QUICK.md** (1페이지) - 전체 흐름 파악
2. **TODO.md** - 현재 할 일만 확인
3. **QUICKREF.md** - 필요한 명령어만 복사

### 체계적으로 학습할 때
1. **README.md** - 전체 그림
2. **NAVIGATION.md** - 문서 구조 이해
3. 역할별 필수 문서 순서대로

### 문제 해결할 때
1. **DIAGNOSTICS_GUIDE.md** - 진단
2. **BUGFIX_TRACKER.md** - 과거 시도 확인
3. **BUG_ANALYSIS.md** - 깊은 이해

---

## 📏 문서 크기 요약

| 분류 | 문서 수 | 총 크기 |
|------|---------|---------|
| 네비게이션 | 2개 | ~15KB |
| 작업 관리 | 3개 | ~24KB |
| 기술 문서 | 3개 | ~29KB |
| **전체** | **8개** | **~68KB** |

평균 읽기 시간: 200 단어/분 기준
- 전체 정독: ~2시간
- 핵심만: ~45분
- 빠른 참조: ~10분

---

## 🎯 핵심 원칙

1. **중복 방지**: 작업 전 항상 BUGFIX_TRACKER.md 확인
2. **일관성**: 템플릿 사용
3. **추적성**: 모든 변경사항 기록
4. **접근성**: 모든 문서는 3클릭 이내 도달

---

**마지막 업데이트**: 2026-02-25  
**문서 관리자**: 프로젝트 팀  
**다음 리뷰**: 주요 버그 수정 완료 시
