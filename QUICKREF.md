# Quick Reference: Overlay Bug Fixes

📍 **문서 위치**: [README](README.md) > [NAVIGATION](NAVIGATION.md) > QUICKREF  
🎯 **다음 문서**: 결과 기록 → [BUGFIX_TRACKER.md](BUGFIX_TRACKER.md) | 문제 시 → [DIAGNOSTICS_GUIDE.md](DIAGNOSTICS_GUIDE.md)  
📚 **문서 구조**: [NAVIGATION.md 참조](NAVIGATION.md)

---

> **빠른 참조**: 버그 수정 및 테스트 절차

## 🚀 빌드 및 테스트 (지금 바로)

### 1. 빌드
```bash
cd src-tauri
cargo build --release
```

### 2. 실행
```bash
cargo run
# 또는
npm run tauri dev
```

### 3. 테스트 (브라우저 콘솔에서)

#### Step 1: 초기 상태 확인
```javascript
await Diagnostics.runFullDiagnostics()
```

#### Step 2: Overlay 진입 (F8 또는 버튼 클릭)
```javascript
// 진입 후 즉시 확인
const overlayState = await Diagnostics.verifyOverlayState()
console.log("Overlay State:", overlayState)

// 기대값:
// - isTransparent: true
// - hasLayered: true
// - webviewAlpha: 0
// - issues: []
```

#### Step 3: Overlay 종료 (F8)
```javascript
// 종료 후 확인 - 이게 핵심!
const styles = await Diagnostics.verifyWindowStyles()
console.log("Has LAYERED:", styles.has_layered)  // false여야 함!

// 🔴 만약 true면 버그 수정이 제대로 반영 안 된 것
// → 다시 빌드 필요
```

#### Step 4: 반복 테스트
```javascript
// 10회 반복
for (let i = 0; i < 10; i++) {
  console.log(`Test ${i + 1}/10`);
  // F8 눌러서 진입
  await new Promise(r => setTimeout(r, 1000));
  await Diagnostics.verifyOverlayState();
  
  // F8 눌러서 종료
  await new Promise(r => setTimeout(r, 1000));
  const result = await Diagnostics.verifyWindowStyles();
  
  console.log(`Round ${i + 1}: has_layered =`, result.has_layered);
  // 모든 라운드에서 false여야 함
}
```

---

## ✅ 성공 지표

### Critical Bug Fix 확인
- [x] Overlay 종료 후 `has_layered: false`
- [x] Overlay 진입 후 `has_layered: true`
- [x] 10회 반복 후에도 일관된 동작
- [x] 메모리 누수 없음

### Visual Bug 해결 확인
- [ ] Overlay 진입 시 창이 완전 투명
- [ ] 배경의 다른 앱이 보임
- [ ] 툴바만 보임
- [ ] `webviewAlpha: 0` 확인됨

### Mouse Mode 확인
- [ ] Mouse Mode ON 시 툴바 클릭 가능
- [ ] Mouse Mode ON 시 툴바 밖 클릭 투과
- [ ] `has_transparent: true` 확인됨

---

## 🔧 문제 발생 시

### Case 1: Overlay 종료 후 has_layered가 여전히 true

**원인**: 새 코드가 빌드에 반영 안 됨

**해결**:
```bash
# 클린 빌드
cd src-tauri
cargo clean
cargo build --release
```

### Case 2: Overlay가 여전히 불투명

**진단**:
```javascript
const diag = await Diagnostics.verifyOverlayState()
console.log(diag.issues)
```

**해결**:
- `webview-not-transparent` 이슈 → 다음 단계 필요 (JS 타이밍 개선)
- `missing-layered-style` 이슈 → Rust 버그 재확인

### Case 3: Mouse Mode가 작동 안 함

**진단**:
```javascript
await Diagnostics.verifyMouseModeState(true)
```

**해결**: WM_NCHITTEST 구현 필요 (향후 작업)

---

## 📝 결과 기록

테스트 결과를 [BUGFIX_TRACKER.md](BUGFIX_TRACKER.md)에 기록:

```markdown
### [2026-02-25] P0-1 테스트 결과

**빌드**: 성공/실패
**테스트 환경**: Windows 10/11, WebView2 버전

**Overlay 종료 후 has_layered**:
- Round 1: false ✅
- Round 2: false ✅
- ...
- Round 10: false ✅

**Visual 투명도**:
- Overlay ON: 투명함 ✅ / 불투명함 ❌
- webviewAlpha: 0 ✅

**Mouse Mode**:
- 툴바 클릭: 가능 ✅
- 툴바 밖 투과: 됨 ✅

**결론**: P0-1 수정 완료 / 추가 작업 필요
```

---

## 📚 관련 문서

- [BUGFIX_TRACKER.md](BUGFIX_TRACKER.md) - 전체 추적 문서
- [BUG_ANALYSIS.md](BUG_ANALYSIS.md) - 기술 분석
- [DIAGNOSTICS_GUIDE.md](DIAGNOSTICS_GUIDE.md) - 사용자 가이드
