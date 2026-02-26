# 문서 네비게이션 가이드

> **목적**: 프로젝트 문서들이 서로 어떻게 연결되어 있고, 상황별로 어떤 문서를 읽어야 하는지 안내

---

## 📊 문서 구조 다이어그램

```
                                  ┌─────────────┐
                                  │  README.md  │ ◄─── 시작점
                                  └──────┬──────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                    │
                    ▼                    ▼                    ▼
           ┌─────────────────┐  ┌──────────────┐   ┌──────────────────┐
           │   MODULES.md    │  │  TODO.md     │   │ DIAGNOSTICS_     │
           │  (아키텍처)      │  │  (작업계획)   │   │  GUIDE.md        │
           └─────────────────┘  └──────┬───────┘   │  (사용자 가이드)  │
                                       │           └──────────────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
                    ▼                  ▼                  ▼
         ┌────────────────────┐ ┌─────────────┐ ┌──────────────────┐
         │ BUGFIX_TRACKER.md  │ │ QUICKREF.md │ │ BUG_ANALYSIS.md  │
         │  (수정 추적)        │ │ (빠른참조)   │ │  (기술 분석)      │
         └────────────────────┘ └─────────────┘ └──────────────────┘
                    │
                    │ 참조
                    │
                    ▼
         ┌────────────────────┐
         │  런타임 로그 파일   │
         │  (실제 진단 데이터) │
         └────────────────────┘
```

---

## 🎯 상황별 문서 순회 경로

### 📍 시나리오 1: 처음 프로젝트를 접하는 경우

**경로**: README.md → MODULES.md → QUICKREF.md

```
1. README.md
   ├─ 프로젝트 개요 파악
   ├─ 주요 기능 이해
   ├─ 빌드 방법 확인
   └─ Known Issues 섹션에서 현재 상태 확인
        │
        ▼
2. MODULES.md
   ├─ 코드 구조 이해
   ├─ js/ 디렉토리 모듈 파악
   └─ 각 모듈의 역할 학습
        │
        ▼
3. QUICKREF.md (선택)
   └─ 빌드 및 테스트 명령어 익히기
```

**걸리는 시간**: ~15분

---

### 📍 시나리오 2: Overlay 버그를 발견한 경우

**경로**: README.md → DIAGNOSTICS_GUIDE.md → BUGFIX_TRACKER.md

```
1. README.md
   └─ Known Issues 섹션
        ├─ 문제 증상과 일치하는지 확인
        └─ Diagnostics 도구 존재 확인
             │
             ▼
2. DIAGNOSTICS_GUIDE.md
   ├─ 이슈별 진단 방법 찾기
   │   ├─ Issue #1: Overlay visual bug
   │   └─ Issue #2: Mouse mode bug
   ├─ 브라우저 콘솔 명령어 실행
   │   └─ await Diagnostics.verifyOverlayState()
   ├─ 로그 분석 방법 학습
   └─ 자동 복구 시도
        │
        ▼ (문제가 해결되지 않으면)
        │
3. BUGFIX_TRACKER.md
   ├─ "시도했으나 효과 없었던 접근법" 확인
   │   └─ 같은 방법을 재시도하지 않기 위해
   ├─ "적용된 수정사항" 확인
   │   └─ 어떤 수정이 이미 적용되었는지
   └─ "다음 시도 예정" 확인
        └─ 어떤 해결책이 계획되어 있는지
```

**걸리는 시간**: ~20분

---

### 📍 시나리오 3: 버그를 수정하려는 경우 (개발자)

**경로**: TODO.md → BUG_ANALYSIS.md → BUGFIX_TRACKER.md → QUICKREF.md

```
1. TODO.md
   ├─ 현재 진행 상황 파악
   │   ├─ ✅ 완료된 작업
   │   └─ 🔄 다음 작업
   ├─ 우선순위 확인 (P0/P1/P2)
   └─ "중복 시도 금지" 확인
        │
        ▼
2. BUG_ANALYSIS.md
   ├─ 버그의 근본 원인 이해
   ├─ 코드 예시 확인
   └─ 권장 해결책 학습
        │
        ▼
3. BUGFIX_TRACKER.md
   ├─ 정확한 수정 위치 확인
   ├─ 변경 전/후 코드 비교
   └─ 테스트 체크리스트 확인
        │
        ▼
4. QUICKREF.md
   ├─ 빌드 명령어 실행
   ├─ 테스트 시나리오 실행
   └─ 결과 확인
        │
        ▼ (테스트 완료 후)
        │
5. BUGFIX_TRACKER.md로 복귀
   └─ 테스트 결과 기록
```

**걸리는 시간**: ~45분

---

### 📍 시나리오 4: 빠른 테스트만 하고 싶은 경우

**경로**: QUICKREF.md

```
1. QUICKREF.md (직접 이동)
   ├─ 빌드 섹션
   │   └─ cargo build --release
   ├─ 테스트 섹션
   │   └─ 브라우저 콘솔 명령어 복사
   └─ 성공 지표 확인
        └─ 체크리스트 완료
```

**걸리는 시간**: ~5분

---

### 📍 시나리오 5: 새로운 버그를 발견한 경우

**경로**: DIAGNOSTICS_GUIDE.md → BUGFIX_TRACKER.md → BUG_ANALYSIS.md

```
1. DIAGNOSTICS_GUIDE.md
   ├─ 진단 명령어 실행
   └─ 로그 파일 확인
        │
        ▼
2. BUGFIX_TRACKER.md
   ├─ "실패 원인 분석 템플릿" 섹션으로 이동
   ├─ 템플릿 복사
   ├─ 진단 결과 기록
   │   ├─ 증상
   │   ├─ 재현 방법
   │   ├─ 로그 분석
   │   └─ 진단 결과
   └─ 파일에 새 섹션 추가
        │
        ▼ (분석 후)
        │
3. BUG_ANALYSIS.md (선택)
   └─ 유사한 문제 패턴 찾기
        └─ 해결 힌트 얻기
```

**걸리는 시간**: ~30분

---

## 📖 문서별 상세 가이드

### README.md
- **목적**: 프로젝트 진입점
- **주요 섹션**:
  - Features
  - Installation
  - Known Issues → 다른 문서로의 링크
  - Project Structure → MODULES.md로 연결
- **다음 문서**:
  - 아키텍처 이해 → MODULES.md
  - 버그 진단 → DIAGNOSTICS_GUIDE.md
  - 빠른 시작 → QUICKREF.md

---

### TODO.md
- **목적**: 작업 계획 및 추적
- **주요 섹션**:
  - ✅ 완료됨
  - 🔄 다음 작업 (P0/P1/P2)
  - ⚠️ 중복 시도 금지
  - 📋 테스트 시나리오
  - 🎯 이번 주 목표
- **다음 문서**:
  - 기술 상세 → BUG_ANALYSIS.md
  - 수정 추적 → BUGFIX_TRACKER.md
  - 빠른 테스트 → QUICKREF.md

---

### BUGFIX_TRACKER.md ⭐ (가장 중요)
- **목적**: 중복 작업 방지 및 진행 상황 추적
- **주요 섹션**:
  - 현재 상태
  - ✅ 적용된 수정사항 (커밋 링크 포함)
  - ❌ 시도했으나 효과 없었던 접근법
  - 🔄 다음 시도 예정 (우선순위별)
  - 📊 테스트 체크리스트
  - 📝 실패 원인 분석 템플릿
- **다음 문서**:
  - 기술 분석 → BUG_ANALYSIS.md
  - 빠른 참조 → QUICKREF.md
  - 사용자 가이드 → DIAGNOSTICS_GUIDE.md

---

### BUG_ANALYSIS.md
- **목적**: 버그의 기술적 분석
- **주요 섹션**:
  - 발견된 주요 버그 (코드 포함)
  - 근본 원인 분석
  - 해결 방안 (코드 예시)
  - 우선순위별 수정 계획
  - Quick Fix (즉시 적용 가능)
- **다음 문서**:
  - 수정 추적 → BUGFIX_TRACKER.md
  - 작업 계획 → TODO.md

---

### QUICKREF.md
- **목적**: 빠른 참조 및 테스트
- **주요 섹션**:
  - 🚀 빌드 및 테스트
  - ✅ 성공 지표
  - 🔧 문제 발생 시
  - 📝 결과 기록
- **다음 문서**:
  - 결과 기록 → BUGFIX_TRACKER.md
  - 문제 시 → DIAGNOSTICS_GUIDE.md

---

### DIAGNOSTICS_GUIDE.md
- **목적**: 사용자 대상 문제 해결 가이드
- **주요 섹션**:
  - 빠른 시작
  - 이슈별 진단 방법
  - 문제 발견 시 대응
  - 로그 분석
  - 자동 복구 시도
- **다음 문서**:
  - 개발자용 → BUGFIX_TRACKER.md
  - 기술 분석 → BUG_ANALYSIS.md

---

### MODULES.md
- **목적**: 코드 아키텍처 설명
- **주요 섹션**:
  - 모듈 구조
  - 각 모듈 설명
  - Rust 명령어
  - 사용 예시
- **다음 문서**:
  - 진단 → DIAGNOSTICS_GUIDE.md
  - 개발 → BUG_ANALYSIS.md

---

## 🔄 순환 참조 패턴

### 패턴 1: 문제 해결 루프

```
DIAGNOSTICS_GUIDE.md (진단)
         ↓
BUGFIX_TRACKER.md (이미 시도한 방법 확인)
         ↓
BUG_ANALYSIS.md (새로운 해결책 찾기)
         ↓
QUICKREF.md (테스트)
         ↓
BUGFIX_TRACKER.md (결과 기록)
         ↓
(해결될 때까지 반복)
```

### 패턴 2: 개발 워크플로우

```
TODO.md (할 일 확인)
    ↓
BUG_ANALYSIS.md (기술 이해)
    ↓
BUGFIX_TRACKER.md (수정 가이드)
    ↓
[코드 수정]
    ↓
QUICKREF.md (테스트)
    ↓
BUGFIX_TRACKER.md (결과 기록)
    ↓
TODO.md (체크박스 업데이트)
```

---

## 🎨 문서 간 링크 맵

각 문서가 어떤 다른 문서를 참조하는지:

```
README.md
├─→ MODULES.md (아키텍처)
├─→ DIAGNOSTICS_GUIDE.md (문제 해결)
└─→ BUGFIX_TRACKER.md (수정 추적)

TODO.md
├─→ BUGFIX_TRACKER.md (상세 정보)
├─→ BUG_ANALYSIS.md (기술 분석)
└─→ QUICKREF.md (테스트)

BUGFIX_TRACKER.md ⭐
├─→ BUG_ANALYSIS.md (원인 분석)
├─→ QUICKREF.md (테스트)
├─→ DIAGNOSTICS_GUIDE.md (사용자 가이드)
└─→ TODO.md (작업 계획)

BUG_ANALYSIS.md
├─→ BUGFIX_TRACKER.md (추적)
└─→ TODO.md (작업 계획)

QUICKREF.md
├─→ BUGFIX_TRACKER.md (결과 기록)
└─→ DIAGNOSTICS_GUIDE.md (문제 시)

DIAGNOSTICS_GUIDE.md
├─→ BUGFIX_TRACKER.md (개발자용)
└─→ BUG_ANALYSIS.md (기술 분석)

MODULES.md
├─→ DIAGNOSTICS_GUIDE.md (진단)
└─→ BUG_ANALYSIS.md (개발)
```

---

## 🔍 검색 전략

### 키워드로 문서 찾기

| 찾고 싶은 내용 | 문서 |
|---------------|------|
| "어떻게 빌드하지?" | QUICKREF.md |
| "이 버그 이미 알려진 거야?" | README.md → Known Issues |
| "이 방법 이미 시도했나?" | BUGFIX_TRACKER.md → 시도했으나 효과 없었던 접근법 |
| "지금 뭘 해야 하지?" | TODO.md → 다음 작업 |
| "왜 이 버그가 생긴거지?" | BUG_ANALYSIS.md → 근본 원인 |
| "어떻게 테스트하지?" | QUICKREF.md → 테스트 섹션 |
| "모듈 구조가 어떻게 돼?" | MODULES.md |
| "문제를 어떻게 진단하지?" | DIAGNOSTICS_GUIDE.md |
| "테스트 결과를 어디에 기록하지?" | BUGFIX_TRACKER.md → 실패 원인 분석 템플릿 |

---

## 📱 빠른 액세스 가이드

### 상황별 첫 번째 문서

```
┌─────────────────────────────────┬──────────────────────────┐
│ 상황                             │ 첫 번째 문서              │
├─────────────────────────────────┼──────────────────────────┤
│ 프로젝트 처음 접함               │ README.md                │
│ 버그 발견                        │ DIAGNOSTICS_GUIDE.md     │
│ 버그 수정하고 싶음               │ TODO.md                  │
│ 빠르게 테스트만                  │ QUICKREF.md              │
│ 코드 구조 이해                   │ MODULES.md               │
│ 이전에 뭘 시도했는지 확인        │ BUGFIX_TRACKER.md        │
│ 왜 이렇게 수정했는지 이해        │ BUG_ANALYSIS.md          │
│ 이번 주 할 일 확인               │ TODO.md                  │
└─────────────────────────────────┴──────────────────────────┘
```

---

## 🎓 학습 경로 (역할별)

### 신규 개발자
1. README.md (10분)
2. MODULES.md (15분)
3. QUICKREF.md (10분)
4. DIAGNOSTICS_GUIDE.md (20분)
**총 소요 시간**: ~55분

### 버그 수정 담당자
1. TODO.md (5분)
2. BUGFIX_TRACKER.md (15분)
3. BUG_ANALYSIS.md (20분)
4. QUICKREF.md (10분)
**총 소요 시간**: ~50분

### 사용자/테스터
1. README.md (5분)
2. DIAGNOSTICS_GUIDE.md (15분)
3. QUICKREF.md (5분)
**총 소요 시간**: ~25분

---

## 💡 문서 유지보수 가이드

### 새로운 버그 발견 시

1. **BUGFIX_TRACKER.md** 업데이트
   - "실패 원인 분석 템플릿" 사용
   - 새 섹션 추가

2. **TODO.md** 업데이트
   - 새 작업 추가
   - 우선순위 재조정

3. **README.md** 업데이트
   - Known Issues 섹션

### 버그 수정 완료 시

1. **BUGFIX_TRACKER.md** 업데이트
   - "적용된 수정사항"에 추가
   - 커밋 해시 기록

2. **TODO.md** 업데이트
   - 체크박스 체크
   - 다음 작업으로 이동

3. **README.md** 업데이트
   - Known Issues 상태 변경

### 새로운 해결책 시도 시

1. **BUGFIX_TRACKER.md** 먼저 확인
   - "시도했으나 효과 없었던 접근법" 검토
   
2. 시도 후 **BUGFIX_TRACKER.md** 업데이트
   - 성공: "적용된 수정사항"
   - 실패: "시도했으나 효과 없었던 접근법"

---

## 📌 핵심 원칙

1. **중복 방지**: BUGFIX_TRACKER.md를 먼저 확인
2. **일관성**: 템플릿 사용
3. **추적성**: 커밋 해시 기록
4. **접근성**: 어디서든 다음 문서로 연결

**모든 문서는 서로 연결되어 있으며, 어디서 시작하든 필요한 정보에 도달할 수 있습니다.**
