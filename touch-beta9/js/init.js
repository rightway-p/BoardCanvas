/**
 * Module Integration Helper
 * 기존 app.js와 새 모듈을 연결하는 브릿지
 */

import * as Runtime from './runtime.js';
import * as Overlay from './overlay.js';
import { Diagnostics } from './diagnostics.js';

// 전역으로 노출 (기존 app.js와의 호환성)
window.Runtime = Runtime;
window.Overlay = Overlay;
window.Diagnostics = Diagnostics;

// 진단 함수들을 overlay 함수에 통합
window.setDesktopWebviewBackgroundAlpha = Overlay.setDesktopWebviewBackgroundAlpha;
window.setDesktopOverlaySurface = Overlay.setDesktopOverlaySurface;
window.setWindowClickThrough = Overlay.setWindowClickThrough;

console.log("[Modules] Runtime, Overlay, Diagnostics loaded");

// 초기화 시 자동 진단 (개발 모드)
if (window.location.hostname === 'localhost' || window.location.protocol.includes('tauri')) {
    window.addEventListener('DOMContentLoaded', () => {
        console.log("[Modules] Auto-diagnostics available via window.Diagnostics");
    });
}

export { Runtime, Overlay, Diagnostics };
