/**
 * Overlay - 오버레이 모드 관리 및 진단
 */

import { invokeDesktopCommand, queueRuntimeLog, sanitizeRuntimeLogDetails, toRuntimeLogError } from './runtime.js';

/**
 * WebView 배경 투명도 설정
 */
export async function setDesktopWebviewBackgroundAlpha(alpha) {
    const normalizedAlpha = Math.max(0, Math.min(255, Number(alpha) || 0));
    const result = await invokeDesktopCommand("set_webview_background_alpha", {
        alpha: normalizedAlpha
    }, {
        logError: true
    });

    if (!Number.isFinite(result)) {
        queueRuntimeLog("overlay.webview.background-alpha.unavailable", {
            requestedAlpha: normalizedAlpha,
            returnedAlpha: result ?? null
        });
        return false;
    }

    queueRuntimeLog("overlay.webview.background-alpha.applied", {
        requestedAlpha: normalizedAlpha,
        returnedAlpha: Number(result)
    });

    // 설정 후 즉시 검증
    const verified = await verifyWebviewBackgroundAlpha();
    if (verified !== normalizedAlpha) {
        queueRuntimeLog("overlay.webview.background-alpha.verification-failed", {
            requested: normalizedAlpha,
            applied: result,
            verified: verified
        });
    }

    return true;
}

/**
 * DWM overlay surface 설정
 */
export async function setDesktopOverlaySurface(enabled) {
    const result = await invokeDesktopCommand("set_window_overlay_surface", {
        enabled: Boolean(enabled)
    }, {
        logError: true
    });

    if (result !== true) {
        queueRuntimeLog("overlay.host-surface.unavailable", {
            enabled: Boolean(enabled),
            result: result ?? null
        });
        return false;
    }

    queueRuntimeLog("overlay.host-surface.applied", {
        enabled: Boolean(enabled)
    });

    // 설정 후 즉시 검증
    const verified = await verifyWindowStyles();
    if (verified && enabled !== verified.has_layered) {
        queueRuntimeLog("overlay.host-surface.verification-failed", {
            requested: enabled,
            verified: verified
        });
    }

    return true;
}

/**
 * 창 클릭 투과 설정
 */
export async function setWindowClickThrough(enabled) {
    const result = await invokeDesktopCommand("set_window_click_through", {
        enabled: Boolean(enabled)
    }, {
        logError: true
    });

    if (!result) {
        queueRuntimeLog("overlay.click-through.unavailable", {
            enabled: Boolean(enabled),
            result: result ?? null
        });
        return false;
    }

    queueRuntimeLog("overlay.click-through.applied", {
        enabled: Boolean(enabled),
        verified: result
    });

    // 반환된 스타일 정보로 검증
    if (result.has_transparent !== Boolean(enabled)) {
        queueRuntimeLog("overlay.click-through.verification-failed", {
            requested: enabled,
            verified: result.has_transparent
        });
    }

    return result.has_transparent === Boolean(enabled);
}

/**
 * 창 스타일 검증
 */
export async function verifyWindowStyles() {
    try {
        const result = await invokeDesktopCommand("verify_window_styles");
        queueRuntimeLog("overlay.verify.window-styles", {
            result: sanitizeRuntimeLogDetails(result)
        });
        return result;
    } catch (error) {
        queueRuntimeLog("overlay.verify.window-styles.error", {
            error: toRuntimeLogError(error)
        });
        return null;
    }
}

/**
 * WebView 배경 투명도 검증
 */
export async function verifyWebviewBackgroundAlpha() {
    try {
        const result = await invokeDesktopCommand("verify_webview_background_alpha");
        queueRuntimeLog("overlay.verify.webview-alpha", {
            result: sanitizeRuntimeLogDetails(result)
        });
        return result;
    } catch (error) {
        queueRuntimeLog("overlay.verify.webview-alpha.error", {
            error: toRuntimeLogError(error)
        });
        return null;
    }
}

/**
 * 창 위치/크기 조회
 */
export async function getWindowRect() {
    try {
        const result = await invokeDesktopCommand("get_window_rect");
        queueRuntimeLog("overlay.verify.window-rect", {
            result: sanitizeRuntimeLogDetails(result)
        });
        return result;
    } catch (error) {
        queueRuntimeLog("overlay.verify.window-rect.error", {
            error: toRuntimeLogError(error)
        });
        return null;
    }
}

/**
 * 전체 오버레이 상태 진단
 */
export async function diagnoseOverlayState() {
    queueRuntimeLog("overlay.diagnose.start", {});

    const windowStyles = await verifyWindowStyles();
    const webviewAlpha = await verifyWebviewBackgroundAlpha();
    const windowRect = await getWindowRect();

    const diagnostic = {
        timestamp: new Date().toISOString(),
        windowStyles,
        webviewAlpha,
        windowRect,
        issues: []
    };

    // 문제 탐지
    if (webviewAlpha !== null && webviewAlpha !== 0) {
        diagnostic.issues.push({
            type: "webview-not-transparent",
            expected: 0,
            actual: webviewAlpha
        });
    }

    if (windowStyles && !windowStyles.has_layered) {
        diagnostic.issues.push({
            type: "missing-layered-style",
            expected: true,
            actual: false
        });
    }

    queueRuntimeLog("overlay.diagnose.complete", {
        issueCount: diagnostic.issues.length,
        diagnostic: sanitizeRuntimeLogDetails(diagnostic)
    });

    return diagnostic;
}

/**
 * 마우스 모드 상태 진단
 */
export async function diagnoseMouseModeState(expectedClickThrough) {
    queueRuntimeLog("overlay.mouse-mode.diagnose.start", {
        expectedClickThrough
    });

    const windowStyles = await verifyWindowStyles();

    const diagnostic = {
        timestamp: new Date().toISOString(),
        expectedClickThrough,
        windowStyles,
        issues: []
    };

    if (windowStyles && windowStyles.has_transparent !== expectedClickThrough) {
        diagnostic.issues.push({
            type: "click-through-mismatch",
            expected: expectedClickThrough,
            actual: windowStyles.has_transparent
        });
    }

    queueRuntimeLog("overlay.mouse-mode.diagnose.complete", {
        issueCount: diagnostic.issues.length,
        diagnostic: sanitizeRuntimeLogDetails(diagnostic)
    });

    return diagnostic;
}
