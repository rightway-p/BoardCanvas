/**
 * Runtime - 플랫폼 감지, Tauri 통신, 로깅
 */

const MAX_RUNTIME_LOG_VALUE_LENGTH = 220;

let runtimeLogPathCache = "";
let runtimeLogPathRequested = false;
let runtimeLogQueue = Promise.resolve();

export function trimRuntimeLogValue(value, limit = MAX_RUNTIME_LOG_VALUE_LENGTH) {
    const text = String(value ?? "");
    if (text.length <= limit) {
        return text;
    }
    return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

export function toRuntimeLogError(error) {
    if (!error) {
        return null;
    }

    if (typeof error === "string") {
        return trimRuntimeLogValue(error);
    }

    if (error instanceof Error) {
        const detail = {
            name: trimRuntimeLogValue(error.name || "Error", 64),
            message: trimRuntimeLogValue(error.message || "")
        };
        if (error.stack) {
            detail.stack = trimRuntimeLogValue(String(error.stack), 500);
        }
        return detail;
    }

    return sanitizeRuntimeLogDetails(error, 0);
}

export function sanitizeRuntimeLogDetails(value, depth = 0) {
    if (value === null || value === undefined) {
        return value;
    }

    if (depth > 2) {
        return trimRuntimeLogValue(value);
    }

    const valueType = typeof value;
    if (valueType === "string") {
        return trimRuntimeLogValue(value);
    }
    if (valueType === "number" || valueType === "boolean") {
        return value;
    }
    if (valueType === "bigint") {
        return trimRuntimeLogValue(`${value}n`);
    }

    if (valueType === "function") {
        return "[function]";
    }

    if (Array.isArray(value)) {
        return value.slice(0, 12).map((entry) => sanitizeRuntimeLogDetails(entry, depth + 1));
    }

    if (value instanceof Error) {
        return toRuntimeLogError(value);
    }

    if (valueType === "object") {
        const normalized = {};
        const keys = Object.keys(value).slice(0, 16);
        for (const key of keys) {
            normalized[key] = sanitizeRuntimeLogDetails(value[key], depth + 1);
        }
        return normalized;
    }

    return trimRuntimeLogValue(value);
}

export function getTauriInvoke() {
    const tauriApi = window.__TAURI__;
    if (!tauriApi) {
        return null;
    }

    if (typeof tauriApi.invoke === "function") {
        return tauriApi.invoke.bind(tauriApi);
    }

    if (tauriApi.tauri && typeof tauriApi.tauri.invoke === "function") {
        return tauriApi.tauri.invoke.bind(tauriApi.tauri);
    }

    return null;
}

export function getTauriWindowApi() {
    const tauriApi = window.__TAURI__;
    if (!tauriApi) {
        return null;
    }

    if (tauriApi.window) {
        return tauriApi.window;
    }

    return null;
}

export function getTauriAppWindow() {
    const windowApi = getTauriWindowApi();
    if (!windowApi) {
        return null;
    }

    return windowApi.appWindow || windowApi.getCurrent?.() || null;
}

export async function invokeDesktopCommand(command, args = {}, options = {}) {
    const { logError = false } = options;
    const invoke = getTauriInvoke();
    if (!invoke) {
        return null;
    }

    try {
        return await invoke(command, args);
    } catch (error) {
        if (logError) {
            queueRuntimeLog("desktop.command.error", {
                command,
                args: sanitizeRuntimeLogDetails(args),
                error: toRuntimeLogError(error)
            });
        }
        return null;
    }
}

export function queueRuntimeLog(message, details = null) {
    const invoke = getTauriInvoke();
    if (!invoke) {
        return;
    }

    const payload = {
        time: new Date().toISOString(),
        message: trimRuntimeLogValue(message || ""),
        details: details ? sanitizeRuntimeLogDetails(details) : null
    };
    const serialized = JSON.stringify(payload);

    runtimeLogQueue = runtimeLogQueue
        .catch(() => null)
        .then(() => invoke("append_runtime_log", { message: serialized }))
        .catch(() => null);
}

export async function primeRuntimeLogPath() {
    if (runtimeLogPathRequested) {
        return runtimeLogPathCache;
    }

    runtimeLogPathRequested = true;
    const invoke = getTauriInvoke();
    if (!invoke) {
        return runtimeLogPathCache;
    }

    try {
        const path = await invoke("get_runtime_log_path");
        runtimeLogPathCache = typeof path === "string" ? path : "";
        const runtimePlatform = detectRuntimePlatform();
        queueRuntimeLog("runtime.bootstrap", {
            platform: runtimePlatform,
            protocol: String((window.location && window.location.protocol) || ""),
            logPath: runtimeLogPathCache || null
        });
    } catch (error) {
        queueRuntimeLog("runtime.logpath.failed", {
            error: toRuntimeLogError(error)
        });
    }

    return runtimeLogPathCache;
}

export function setupRuntimeErrorLogging() {
    window.addEventListener("error", (event) => {
        queueRuntimeLog("window.error", {
            message: trimRuntimeLogValue(event.message || ""),
            filename: trimRuntimeLogValue(event.filename || "", 140),
            line: Number.isFinite(event.lineno) ? event.lineno : null,
            column: Number.isFinite(event.colno) ? event.colno : null,
            error: toRuntimeLogError(event.error)
        });
    });

    window.addEventListener("unhandledrejection", (event) => {
        queueRuntimeLog("window.unhandledrejection", {
            reason: toRuntimeLogError(event.reason)
        });
    });
}

export function detectRuntimePlatform() {
    const userAgent = String((window.navigator && window.navigator.userAgent) || "").toLowerCase();
    const platform = String((window.navigator && window.navigator.platform) || "").toLowerCase();
    const source = `${userAgent} ${platform}`;

    if (source.includes("win")) {
        return "windows";
    }

    if (source.includes("mac")) {
        return "macos";
    }

    if (source.includes("linux")) {
        return "linux";
    }

    return "unknown";
}

export function isLikelyTauriProtocol() {
    const protocol = String((window.location && window.location.protocol) || "").toLowerCase();
    if (protocol === "tauri:" || protocol === "asset:" || protocol === "app:") {
        return true;
    }

    const hostname = String((window.location && window.location.hostname) || "").toLowerCase();
    if (protocol === "https:" && (hostname === "tauri.localhost" || hostname.endsWith(".tauri.localhost"))) {
        return true;
    }

    return isDesktopAppRuntime();
}

export function isDesktopAppRuntime() {
    return Boolean(getTauriAppWindow());
}

export function isWindowsDesktopRuntime() {
    return isDesktopAppRuntime() && detectRuntimePlatform() === "windows";
}

export async function callWindowMethod(targetWindow, methodName, ...args) {
    if (!targetWindow || typeof targetWindow[methodName] !== "function") {
        return null;
    }

    try {
        return await targetWindow[methodName](...args);
    } catch (error) {
        queueRuntimeLog("window.method.error", {
            method: methodName,
            args: sanitizeRuntimeLogDetails(args),
            error: toRuntimeLogError(error)
        });
        return null;
    }
}
