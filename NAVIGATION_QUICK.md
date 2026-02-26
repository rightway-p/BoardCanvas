# 문서 순회 빠른 가이드

```
                        시작: README.md
                              │
                  ┌───────────┼───────────┐
                  │           │           │
            첫 사용자    버그 발견     개발자
                  │           │           │
                  ▼           ▼           ▼
            MODULES.md  DIAGNOSTICS   TODO.md
                  │      _GUIDE.md       │
                  │           │           │
                  └──────►    │    ◄──────┘
                              │
                              ▼
                    BUGFIX_TRACKER.md ⭐
                    (핵심 허브 문서)
                              │
                  ┌───────────┼───────────┐
                  │           │           │
                  ▼           ▼           ▼
          BUG_ANALYSIS  QUICKREF    문제 해결
             (분석)      (테스트)      루프
                  │           │           │
                  └───────────┴───────────┘
                              │
                              ▼
                    결과를 BUGFIX_TRACKER에 기록
```

## 📋 상황별 최단 경로

### 새 사용자
```
README → MODULES → QUICKREF (25분)
```

### 버그 발견
```
DIAGNOSTICS_GUIDE → BUGFIX_TRACKER (20분)
```

### 버그 수정
```
TODO → BUG_ANALYSIS → BUGFIX_TRACKER → QUICKREF (45분)
```

### 빠른 테스트
```
QUICKREF (5분)
```

## 🔍 키워드 검색

| 질문 | 문서 | 섹션 |
|------|------|------|
| 빌드 방법? | QUICKREF.md | 빌드 섹션 |
| 이미 시도한 방법? | BUGFIX_TRACKER.md | ❌ 시도했으나 효과 없었던 접근법 |
| 지금 뭘 해야 하지? | TODO.md | 🔄 다음 작업 |
| 왜 이 버그가? | BUG_ANALYSIS.md | 근본 원인 |
| 어떻게 테스트? | QUICKREF.md | 테스트 섹션 |

상세 내용: [NAVIGATION.md](NAVIGATION.md)

---

**팁**: 모든 문서 상단에 📍 현재 위치와 🎯 다음 문서 표시됨
