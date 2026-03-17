/**
 * Diagnostics - Overlay 및 Window 상태 검증 도구
 */

export const Diagnostics = {
    /**
     * 현재 창 스타일 검증
     */
    async verifyWindowStyles() {
        const invoke = window.__TAURI__?.invoke;
        if (!invoke) {
            return { error: "Tauri not available" };
        }

        try {
            const result = await invoke("verify_window_styles");
            console.log("[Diagnostics] Window Styles:", result);
            return result;
        } catch (error) {
            console.error("[Diagnostics] verifyWindowStyles failed:", error);
            return { error: String(error) };
        }
    },

    /**
     * WebView 배경 투명도 검증
     */
    async verifyWebviewBackgroundAlpha() {
        const invoke = window.__TAURI__?.invoke;
        if (!invoke) {
            return { error: "Tauri not available" };
        }

        try {
            const result = await invoke("verify_webview_background_alpha");
            console.log("[Diagnostics] Webview Background Alpha:", result);
            return result;
        } catch (error) {
            console.error("[Diagnostics] verifyWebviewBackgroundAlpha failed:", error);
            return { error: String(error) };
        }
    },

    /**
     * 창 위치/크기 정보 조회
     */
    async getWindowRect() {
        const invoke = window.__TAURI__?.invoke;
        if (!invoke) {
            return { error: "Tauri not available" };
        }

        try {
            const result = await invoke("get_window_rect");
            console.log("[Diagnostics] Window Rect:", result);
            return result;
        } catch (error) {
            console.error("[Diagnostics] getWindowRect failed:", error);
            return { error: String(error) };
        }
    },

    /**
     * 클릭 투과 설정 및 검증
     */
    async setWindowClickThrough(enabled) {
        const invoke = window.__TAURI__?.invoke;
        if (!invoke) {
            return { error: "Tauri not available" };
        }

        try {
            const result = await invoke("set_window_click_through", { enabled });
            console.log(`[Diagnostics] Click-through ${enabled ? "enabled" : "disabled"}:`, result);
            return result;
        } catch (error) {
            console.error("[Diagnostics] setWindowClickThrough failed:", error);
            return { error: String(error) };
        }
    },

    /**
     * 전체 진단 실행
     */
    async runFullDiagnostics() {
        console.log("[Diagnostics] Running full diagnostics...");

        const results = {
            timestamp: new Date().toISOString(),
            windowStyles: await this.verifyWindowStyles(),
            webviewAlpha: await this.verifyWebviewBackgroundAlpha(),
            windowRect: await this.getWindowRect()
        };

        console.log("[Diagnostics] Full Report:", results);
        return results;
    },

    /**
     * Overlay 진입 후 검증
     */
    async verifyOverlayState() {
        console.log("[Diagnostics] Verifying overlay state...");

        const styles = await this.verifyWindowStyles();
        const alpha = await this.verifyWebviewBackgroundAlpha();

        const report = {
            timestamp: new Date().toISOString(),
            hasLayered: styles.has_layered,
            hasTransparent: styles.has_transparent,
            webviewAlpha: alpha,
            expectedAlpha: 0,
            isTransparent: alpha === 0 || alpha === "0",
            stylesMatch: styles.has_layered === true
        };

        console.log("[Diagnostics] Overlay State:", report);

        if (!report.isTransparent) {
            console.warn("[Diagnostics] ⚠️ Webview is not transparent! Expected 0, got", alpha);
        }
        if (!report.hasLayered) {
            console.warn("[Diagnostics] ⚠️ Window does not have WS_EX_LAYERED style!");
        }

        return report;
    },

    /**
     * Mouse mode 진입 후 검증
     */
    async verifyMouseModeState(expectedClickThrough) {
        console.log("[Diagnostics] Verifying mouse mode state...");

        const styles = await this.verifyWindowStyles();

        const report = {
            timestamp: new Date().toISOString(),
            hasTransparent: styles.has_transparent,
            expectedTransparent: expectedClickThrough,
            stylesMatch: styles.has_transparent === expectedClickThrough
        };

        console.log("[Diagnostics] Mouse Mode State:", report);

        if (report.hasTransparent !== expectedClickThrough) {
            console.warn(
                `[Diagnostics] ⚠️ Click-through mismatch! Expected ${expectedClickThrough}, got ${report.hasTransparent}`
            );
        }

        return report;
    }
};

// 전역으로 노출 (개발 편의)
if (typeof window !== 'undefined') {
    window.Diagnostics = Diagnostics;
}
