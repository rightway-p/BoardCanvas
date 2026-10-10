function trimRuntimeLogValue(value, limit = MAX_RUNTIME_LOG_VALUE_LENGTH) {
  const text = String(value ?? "");
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function toRuntimeLogError(error) {
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

function sanitizeRuntimeLogDetails(value, depth = 0) {
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

function getTauriInvoke() {
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

async function invokeDesktopCommand(command, args = {}, options = {}) {
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

async function setDesktopWebviewBackgroundAlpha(alpha) {
  if (!isDesktopAppRuntime()) {
    return false;
  }
  if (runtimePlatform !== "windows") {
    // Linux/macOS runtime: no WebView alpha command needed in current path.
    return true;
  }

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
  return true;
}

async function setDesktopOverlaySurface(enabled) {
  if (!isDesktopAppRuntime()) {
    return false;
  }
  if (runtimePlatform !== "windows") {
    // Linux/macOS runtime: no host-surface command needed in current path.
    return true;
  }

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
  return true;
}

async function setDesktopWindowClickThrough(enabled) {
  if (!isDesktopAppRuntime() || runtimePlatform !== "windows") {
    queueRuntimeLog("overlay.clickthrough.unsupported-runtime", {
      enabled: Boolean(enabled),
      runtimePlatform
    });
    return false;
  }

  const result = await invokeDesktopCommand("set_window_click_through", {
    enabled: Boolean(enabled)
  }, {
    logError: true
  });

  if (!result || typeof result !== "object") {
    queueRuntimeLog("overlay.clickthrough.unavailable", {
      enabled: Boolean(enabled),
      result: result ?? null
    });
    return false;
  }

  const expected = Boolean(enabled);
  const applied = Boolean(result.has_transparent);
  queueRuntimeLog("overlay.clickthrough.applied", {
    enabled: expected,
    hasTransparent: applied
  });
  return applied === expected;
}

function queueRuntimeLog(message, details = null) {
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

async function primeRuntimeLogPath() {
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

function setupRuntimeErrorLogging() {
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

function detectRuntimePlatform() {
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

function isLikelyTauriProtocol() {
  const protocol = String((window.location && window.location.protocol) || "").toLowerCase();
  if (protocol === "tauri:" || protocol === "asset:" || protocol === "app:") {
    return true;
  }

  const hostname = String((window.location && window.location.hostname) || "").toLowerCase();
  if (protocol === "https:" && (hostname === "tauri.localhost" || hostname.endsWith(".tauri.localhost"))) {
    return true;
  }

  // Some desktop builds expose the app bridge under https origin.
  return isDesktopAppRuntime();
}

function getFullscreenElement() {
  return document.fullscreenElement
    || document.webkitFullscreenElement
    || document.msFullscreenElement
    || null;
}

function waitShortDelay(ms = 60) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isBrowserFullscreenSupported() {
  return Boolean(
    document.fullscreenEnabled
    || document.webkitFullscreenEnabled
    || document.msFullscreenEnabled
  );
}

function isFullscreenSupported() {
  return isBrowserFullscreenSupported() || Boolean(getTauriAppWindow());
}

function isFullscreenActive() {
  return Boolean(getFullscreenElement()) || nativeFullscreenActive || nativeWindowMaximized;
}

async function refreshNativeFullscreenState() {
  const appWindowRef = getTauriAppWindow();
  if (!appWindowRef) {
    nativeFullscreenActive = false;
    nativeWindowMaximized = false;
    return false;
  }

  const [nextFullscreenState, nextMaximizedState] = await Promise.all([
    callWindowMethod(appWindowRef, "isFullscreen"),
    callWindowMethod(appWindowRef, "isMaximized")
  ]);

  if (typeof nextFullscreenState === "boolean") {
    nativeFullscreenActive = nextFullscreenState;
  }

  if (typeof nextMaximizedState === "boolean") {
    nativeWindowMaximized = nextMaximizedState;
  }

  return nativeFullscreenActive || nativeWindowMaximized;
}

async function requestNativeFullscreenLike(appWindowRef) {
  if (!appWindowRef) {
    queueRuntimeLog("fullscreen.native.enter.skipped", { reason: "window-unavailable" });
    return false;
  }

  queueRuntimeLog("fullscreen.native.enter.start", {
    overlayMode,
    nativeFullscreenActive,
    nativeWindowMaximized
  });
  const setFullscreenResult = await callWindowMethod(appWindowRef, "setFullscreen", true);
  await refreshNativeFullscreenState();
  if (nativeFullscreenActive || nativeWindowMaximized) {
    queueRuntimeLog("fullscreen.native.enter.success", {
      step: "setFullscreen-state",
      nativeFullscreenActive,
      nativeWindowMaximized
    });
    return true;
  }
  if (setFullscreenResult !== null) {
    nativeFullscreenActive = true;
    nativeWindowMaximized = false;
    queueRuntimeLog("fullscreen.native.enter.success", {
      step: "setFullscreen-result",
      nativeFullscreenActive,
      nativeWindowMaximized
    });
    return true;
  }

  const maximizeResult = await callWindowMethod(appWindowRef, "maximize");
  await refreshNativeFullscreenState();
  if (nativeFullscreenActive || nativeWindowMaximized) {
    queueRuntimeLog("fullscreen.native.enter.success", {
      step: "maximize-state",
      nativeFullscreenActive,
      nativeWindowMaximized
    });
    return true;
  }
  if (maximizeResult !== null) {
    nativeFullscreenActive = false;
    nativeWindowMaximized = true;
    queueRuntimeLog("fullscreen.native.enter.success", {
      step: "maximize-result",
      nativeFullscreenActive,
      nativeWindowMaximized
    });
    return true;
  }

  queueRuntimeLog("fullscreen.native.enter.failed", {
    nativeFullscreenActive,
    nativeWindowMaximized
  });
  return false;
}

async function requestNativeExitFullscreenLike(appWindowRef) {
  if (!appWindowRef) {
    queueRuntimeLog("fullscreen.native.exit.skipped", { reason: "window-unavailable" });
    return false;
  }

  queueRuntimeLog("fullscreen.native.exit.start", {
    nativeFullscreenActive,
    nativeWindowMaximized
  });
  const exitFullscreenResult = await callWindowMethod(appWindowRef, "setFullscreen", false);
  const unmaximizeResult = await callWindowMethod(appWindowRef, "unmaximize");
  await refreshNativeFullscreenState();
  if (!nativeFullscreenActive && !nativeWindowMaximized) {
    queueRuntimeLog("fullscreen.native.exit.success", {
      step: "state-cleared",
      nativeFullscreenActive,
      nativeWindowMaximized
    });
    return true;
  }

  if (exitFullscreenResult !== null || unmaximizeResult !== null) {
    nativeFullscreenActive = false;
    nativeWindowMaximized = false;
    queueRuntimeLog("fullscreen.native.exit.success", {
      step: "method-result",
      nativeFullscreenActive,
      nativeWindowMaximized
    });
    return true;
  }

  queueRuntimeLog("fullscreen.native.exit.failed", {
    nativeFullscreenActive,
    nativeWindowMaximized
  });
  return false;
}

async function requestNativeOverlayLike(appWindowRef) {
  if (!appWindowRef) {
    queueRuntimeLog("overlay.native.enter.skipped", { reason: "window-unavailable" });
    return false;
  }

  queueRuntimeLog("overlay.native.enter.start", {
    nativeFullscreenActive,
    nativeWindowMaximized
  });
  const setFullscreenResult = await callWindowMethod(appWindowRef, "setFullscreen", true);
  await refreshNativeFullscreenState();
  if (nativeWindowMaximized || nativeFullscreenActive) {
    queueRuntimeLog("overlay.native.enter.success", {
      step: "setFullscreen-state",
      nativeFullscreenActive,
      nativeWindowMaximized
    });
    return true;
  }

  if (setFullscreenResult !== null) {
    nativeFullscreenActive = true;
    nativeWindowMaximized = false;
    queueRuntimeLog("overlay.native.enter.success", {
      step: "setFullscreen-result",
      nativeFullscreenActive,
      nativeWindowMaximized
    });
    return true;
  }

  await callWindowMethod(appWindowRef, "setFullscreen", false);
  await callWindowMethod(appWindowRef, "unmaximize");
  const maximizeResult = await callWindowMethod(appWindowRef, "maximize");
  await refreshNativeFullscreenState();
  if (nativeFullscreenActive || nativeWindowMaximized) {
    queueRuntimeLog("overlay.native.enter.success", {
      step: "maximize-state",
      nativeFullscreenActive,
      nativeWindowMaximized
    });
    return true;
  }

  if (maximizeResult !== null) {
    nativeFullscreenActive = false;
    nativeWindowMaximized = true;
    queueRuntimeLog("overlay.native.enter.success", {
      step: "maximize-result",
      nativeFullscreenActive,
      nativeWindowMaximized
    });
    return true;
  }

  queueRuntimeLog("overlay.native.enter.failed", {
    nativeFullscreenActive,
    nativeWindowMaximized
  });
  return false;
}

function syncFullscreenUiFromNativeWindow() {
  refreshNativeFullscreenState()
    .catch(() => null)
    .finally(() => {
      updateFullscreenButtons();
    });
}

function bootstrapRuntimeBridgeSync() {
  let attempts = 0;
  const maxAttempts = 24;
  const timerId = window.setInterval(() => {
    attempts += 1;
    updateFullscreenButtons();
    updateOverlayModeButton();

    if (isDesktopAppRuntime() || attempts >= maxAttempts) {
      window.clearInterval(timerId);
      syncFullscreenUiFromNativeWindow();
      updateOverlayModeButton();
    }
  }, 250);
}

function updateFullscreenButtons() {
  const supported = isFullscreenSupported();
  const active = isFullscreenActive() || overlayMode;
  const lockedByOverlay = overlayMode || overlayTransitionInProgress;

  fullscreenToggleButton.disabled = !supported || lockedByOverlay;
  fullscreenToggleButton.classList.toggle("is-fullscreen", supported && active);

  if (!supported) {
    fullscreenToggleButton.setAttribute("aria-label", "\uC804\uCCB4\uD654\uBA74 \uBBF8\uC9C0\uC6D0");
    fullscreenToggleButton.title = "\uC804\uCCB4\uD654\uBA74 \uBBF8\uC9C0\uC6D0";
    return;
  }

  const label = active
    ? "\uC804\uCCB4\uD654\uBA74 \uC885\uB8CC"
    : "\uC804\uCCB4\uD654\uBA74";
  fullscreenToggleButton.setAttribute("aria-label", label);
  fullscreenToggleButton.title = label;
}
async function enterFullscreen() {
  if (!isFullscreenSupported() || isFullscreenActive()) {
    queueRuntimeLog("fullscreen.enter.skipped", {
      supported: isFullscreenSupported(),
      active: isFullscreenActive()
    });
    return;
  }

  const appWindowRef = getTauriAppWindow();
  if (appWindowRef) {
    queueRuntimeLog("fullscreen.enter.desktop.start", { overlayMode });
    const entered = await requestNativeFullscreenLike(appWindowRef);
    updateFullscreenButtons();
    if (!entered) {
      setDocumentStatus("Unable to enable fullscreen in desktop runtime.", "warning");
      queueRuntimeLog("fullscreen.enter.desktop.failed", {
        nativeFullscreenActive,
        nativeWindowMaximized
      });
    } else {
      queueRuntimeLog("fullscreen.enter.desktop.success", {
        nativeFullscreenActive,
        nativeWindowMaximized
      });
    }
    return;
  }

  if (isBrowserFullscreenSupported()) {
    const target = document.documentElement;
    try {
      if (typeof target.requestFullscreen === "function") {
        await target.requestFullscreen();
        await waitShortDelay();
        if (getFullscreenElement()) {
          return;
        }
      }

      if (typeof target.webkitRequestFullscreen === "function") {
        target.webkitRequestFullscreen();
        await waitShortDelay();
        if (getFullscreenElement()) {
          return;
        }
      }

      if (typeof target.msRequestFullscreen === "function") {
        target.msRequestFullscreen();
        await waitShortDelay();
        if (getFullscreenElement()) {
          return;
        }
      }
    } catch (error) {
      // Browser fullscreen can fail in app webviews.
      queueRuntimeLog("fullscreen.enter.browser.error", {
        error: toRuntimeLogError(error)
      });
    }
  }
  updateFullscreenButtons();
  queueRuntimeLog("fullscreen.enter.browser.done", {
    active: Boolean(getFullscreenElement())
  });
}

async function exitFullscreen() {
  if (!isFullscreenActive()) {
    queueRuntimeLog("fullscreen.exit.skipped", { reason: "not-active" });
    return;
  }

  const appWindowRef = getTauriAppWindow();
  if (appWindowRef) {
    queueRuntimeLog("fullscreen.exit.desktop.start", {
      nativeFullscreenActive,
      nativeWindowMaximized
    });
    await requestNativeExitFullscreenLike(appWindowRef);
    updateFullscreenButtons();
    queueRuntimeLog("fullscreen.exit.desktop.done", {
      nativeFullscreenActive,
      nativeWindowMaximized
    });
    return;
  }

  if (getFullscreenElement()) {
    try {
      if (typeof document.exitFullscreen === "function") {
        await document.exitFullscreen();
        await waitShortDelay();
        if (!getFullscreenElement()) {
          return;
        }
      }

      if (typeof document.webkitExitFullscreen === "function") {
        document.webkitExitFullscreen();
        await waitShortDelay();
        if (!getFullscreenElement()) {
          return;
        }
      }

      if (typeof document.msExitFullscreen === "function") {
        document.msExitFullscreen();
        await waitShortDelay();
        if (!getFullscreenElement()) {
          return;
        }
      }
    } catch (error) {
      // Ignore exit errors and try native fallback.
      queueRuntimeLog("fullscreen.exit.browser.error", {
        error: toRuntimeLogError(error)
      });
    }
  }
  updateFullscreenButtons();
  queueRuntimeLog("fullscreen.exit.browser.done", {
    active: Boolean(getFullscreenElement())
  });
}

async function toggleFullscreen() {
  if (overlayMode || overlayTransitionInProgress) {
    queueRuntimeLog("fullscreen.toggle.skipped", {
      reason: "overlay-active",
      overlayMode,
      overlayTransitionInProgress
    });
    return;
  }

  if (isDesktopAppRuntime()) {
    await refreshNativeFullscreenState();
  }

  if (isFullscreenActive()) {
    await exitFullscreen();
    return;
  }

  await enterFullscreen();
}

function getTauriWindowApi() {
  if (!window.__TAURI__ || !window.__TAURI__.window) {
    return null;
  }

  return window.__TAURI__.window;
}

function getTauriAppWindow() {
  const tauriWindowApi = getTauriWindowApi();
  if (!tauriWindowApi || !tauriWindowApi.appWindow) {
    return null;
  }

  return tauriWindowApi.appWindow;
}

function isDesktopAppRuntime() {
  return Boolean(getTauriAppWindow());
}

function isWindowsDesktopRuntime() {
  return isDesktopAppRuntime() && runtimePlatform === "windows";
}

async function callWindowMethod(targetWindow, methodName, ...args) {
  if (!targetWindow || typeof targetWindow[methodName] !== "function") {
    if (!missingNativeWindowMethods.has(methodName)) {
      missingNativeWindowMethods.add(methodName);
      queueRuntimeLog("window.method.missing", { method: methodName });
    }
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

function getTauriEventApi() {
  if (!window.__TAURI__ || !window.__TAURI__.event) {
    return null;
  }

  return window.__TAURI__.event;
}

function isDedicatedOverlayWindow() {
  try {
    const params = new URLSearchParams(String((window.location && window.location.search) || ""));
    return params.get(OVERLAY_WINDOW_QUERY_KEY) === "1";
  } catch (error) {
    return false;
  }
}

async function emitTauriRuntimeEvent(eventName, payload = {}) {
  const eventApi = getTauriEventApi();
  if (!eventApi || typeof eventApi.emit !== "function") {
    return false;
  }

  try {
    await eventApi.emit(eventName, payload);
    return true;
  } catch (error) {
    queueRuntimeLog("event.emit.error", {
      eventName,
      error: toRuntimeLogError(error)
    });
    return false;
  }
}

async function installOverlayWindowClosedListener() {
  if (overlayWindowListenerUnsubscribe !== null) {
    return;
  }

  const eventApi = getTauriEventApi();
  if (!eventApi || typeof eventApi.listen !== "function") {
    return;
  }

  try {
    overlayWindowListenerUnsubscribe = await eventApi.listen(OVERLAY_WINDOW_CLOSED_EVENT, async () => {
      if (isDedicatedOverlayWindow()) {
        return;
      }

      const appWindowRef = getTauriAppWindow();
      if (!appWindowRef) {
        return;
      }

      await callWindowMethod(appWindowRef, "show");
      await callWindowMethod(appWindowRef, "setFocus");
      updateOverlayModeButton();
    });
  } catch (error) {
    queueRuntimeLog("event.listen.error", {
      eventName: OVERLAY_WINDOW_CLOSED_EVENT,
      error: toRuntimeLogError(error)
    });
  }
}

async function openDedicatedOverlayWindow() {
  if (isDedicatedOverlayWindow()) {
    return false;
  }

  const tauriWindowApi = getTauriWindowApi();
  const appWindowRef = getTauriAppWindow();
  if (!tauriWindowApi || !appWindowRef || typeof tauriWindowApi.WebviewWindow !== "function") {
    return false;
  }

  try {
    if (typeof tauriWindowApi.WebviewWindow.getByLabel === "function") {
      const existing = tauriWindowApi.WebviewWindow.getByLabel(OVERLAY_WINDOW_LABEL);
      if (existing) {
        await callWindowMethod(existing, "setFocus");
        await callWindowMethod(appWindowRef, "hide");
        return true;
      }
    }

    const [monitorInfo, outerPosition, outerSize] = await Promise.all([
      callWindowMethod(appWindowRef, "currentMonitor"),
      callWindowMethod(appWindowRef, "outerPosition"),
      callWindowMethod(appWindowRef, "outerSize")
    ]);

    const monitorX = Number(monitorInfo?.position?.x);
    const monitorY = Number(monitorInfo?.position?.y);
    const monitorWidth = Number(monitorInfo?.size?.width);
    const monitorHeight = Number(monitorInfo?.size?.height);

    const fallbackX = Number(outerPosition?.x);
    const fallbackY = Number(outerPosition?.y);
    const fallbackWidth = Number(outerSize?.width);
    const fallbackHeight = Number(outerSize?.height);

    const launchX = Number.isFinite(monitorX) ? Math.round(monitorX) : (Number.isFinite(fallbackX) ? Math.round(fallbackX) : 0);
    const launchY = Number.isFinite(monitorY) ? Math.round(monitorY) : (Number.isFinite(fallbackY) ? Math.round(fallbackY) : 0);
    const launchWidth = Number.isFinite(monitorWidth) && monitorWidth > 100
      ? Math.round(monitorWidth)
      : (Number.isFinite(fallbackWidth) && fallbackWidth > 100 ? Math.round(fallbackWidth) : 1280);
    const launchHeight = Number.isFinite(monitorHeight) && monitorHeight > 100
      ? Math.round(monitorHeight)
      : (Number.isFinite(fallbackHeight) && fallbackHeight > 100 ? Math.round(fallbackHeight) : 720);

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set(OVERLAY_WINDOW_QUERY_KEY, "1");
    const overlayWindow = new tauriWindowApi.WebviewWindow(OVERLAY_WINDOW_LABEL, {
      url: nextUrl.toString(),
      x: launchX,
      y: launchY,
      width: launchWidth,
      height: launchHeight,
      transparent: true,
      decorations: false,
      alwaysOnTop: true,
      fullscreen: false,
      resizable: false,
      focus: true,
      skipTaskbar: true
    });
    queueRuntimeLog("overlay.window.create.bounds", {
      x: launchX,
      y: launchY,
      width: launchWidth,
      height: launchHeight,
      monitorDetected: Boolean(Number.isFinite(monitorX) && Number.isFinite(monitorY))
    });

    if (overlayWindow && typeof overlayWindow.once === "function") {
      overlayWindow.once("tauri://created", async () => {
        const logicalSize = (typeof tauriWindowApi.LogicalSize === "function")
          ? new tauriWindowApi.LogicalSize(launchWidth, launchHeight)
          : null;
        const logicalPosition = (typeof tauriWindowApi.LogicalPosition === "function")
          ? new tauriWindowApi.LogicalPosition(launchX, launchY)
          : null;
        if (logicalSize) {
          await callWindowMethod(overlayWindow, "setSize", logicalSize);
        }
        if (logicalPosition) {
          await callWindowMethod(overlayWindow, "setPosition", logicalPosition);
        }
        await callWindowMethod(overlayWindow, "setAlwaysOnTop", true);
        await callWindowMethod(appWindowRef, "hide");
      });
      overlayWindow.once("tauri://error", (error) => {
        queueRuntimeLog("overlay.window.create.error", {
          error: toRuntimeLogError(error)
        });
      });
    } else {
      await callWindowMethod(appWindowRef, "hide");
    }
    return true;
  } catch (error) {
    queueRuntimeLog("overlay.window.create.exception", {
      error: toRuntimeLogError(error)
    });
    return false;
  }
}

async function captureOverlayWindowSnapshot(appWindowRef) {
  const [position, size, decorated, alwaysOnTop, fullscreen, maximized, resizable] = await Promise.all([
    callWindowMethod(appWindowRef, "outerPosition"),
    callWindowMethod(appWindowRef, "outerSize"),
    callWindowMethod(appWindowRef, "isDecorated"),
    callWindowMethod(appWindowRef, "isAlwaysOnTop"),
    callWindowMethod(appWindowRef, "isFullscreen"),
    callWindowMethod(appWindowRef, "isMaximized"),
    callWindowMethod(appWindowRef, "isResizable")
  ]);

  return {
    position: position && Number.isFinite(position.x) && Number.isFinite(position.y)
      ? { x: Math.round(position.x), y: Math.round(position.y) }
      : null,
    size: size && Number.isFinite(size.width) && Number.isFinite(size.height)
      ? { width: Math.max(200, Math.round(size.width)), height: Math.max(120, Math.round(size.height)) }
      : null,
    decorated: typeof decorated === "boolean" ? decorated : null,
    alwaysOnTop: typeof alwaysOnTop === "boolean" ? alwaysOnTop : null,
    fullscreen: typeof fullscreen === "boolean" ? fullscreen : null,
    maximized: typeof maximized === "boolean" ? maximized : null,
    resizable: typeof resizable === "boolean" ? resizable : null
  };
}

async function restoreOverlayWindowSnapshot(appWindowRef, snapshot) {
  const tauriWindowApi = getTauriWindowApi();
  if (!appWindowRef || !snapshot) {
    queueRuntimeLog("overlay.snapshot.restore.skipped", {
      hasWindow: Boolean(appWindowRef),
      hasSnapshot: Boolean(snapshot)
    });
    return;
  }

  queueRuntimeLog("overlay.snapshot.restore.start", {
    snapshot: sanitizeRuntimeLogDetails(snapshot)
  });
  await callWindowMethod(appWindowRef, "setFullscreen", false);

  if (typeof snapshot.decorated === "boolean") {
    await callWindowMethod(appWindowRef, "setDecorations", snapshot.decorated);
  } else {
    await callWindowMethod(appWindowRef, "setDecorations", true);
  }

  if (typeof snapshot.alwaysOnTop === "boolean") {
    await callWindowMethod(appWindowRef, "setAlwaysOnTop", snapshot.alwaysOnTop);
  } else {
    await callWindowMethod(appWindowRef, "setAlwaysOnTop", false);
  }
  if (typeof snapshot.resizable === "boolean") {
    await callWindowMethod(appWindowRef, "setResizable", snapshot.resizable);
  } else {
    await callWindowMethod(appWindowRef, "setResizable", true);
  }

  if (snapshot.maximized === true) {
    await callWindowMethod(appWindowRef, "maximize");
  } else {
    await callWindowMethod(appWindowRef, "unmaximize");

    if (snapshot.size && tauriWindowApi && typeof tauriWindowApi.LogicalSize === "function") {
      const nextSize = new tauriWindowApi.LogicalSize(snapshot.size.width, snapshot.size.height);
      await callWindowMethod(appWindowRef, "setSize", nextSize);
    }

    if (snapshot.position && tauriWindowApi && typeof tauriWindowApi.LogicalPosition === "function") {
      const nextPosition = new tauriWindowApi.LogicalPosition(snapshot.position.x, snapshot.position.y);
      await callWindowMethod(appWindowRef, "setPosition", nextPosition);
    }
  }

  if (snapshot.fullscreen === true) {
    await callWindowMethod(appWindowRef, "setFullscreen", true);
  }

  await refreshNativeFullscreenState();
  queueRuntimeLog("overlay.snapshot.restore.done", {
    nativeFullscreenActive,
    nativeWindowMaximized
  });
}

async function hideOverlayHostWindowBehindToolbar(appWindowRef) {
  if (!OVERLAY_HIDE_HOST_WITH_TOOLBAR_FALLBACK || !appWindowRef || !toolbar) {
    return false;
  }

  const tauriWindowApi = getTauriWindowApi();
  if (!tauriWindowApi
    || typeof tauriWindowApi.LogicalSize !== "function"
    || typeof tauriWindowApi.LogicalPosition !== "function") {
    return false;
  }

  const rect = toolbar.getBoundingClientRect();
  if (!Number.isFinite(rect.left)
    || !Number.isFinite(rect.top)
    || !Number.isFinite(rect.width)
    || !Number.isFinite(rect.height)) {
    return false;
  }

  const padding = 6;
  const nextWidth = Math.max(220, Math.round(rect.width + (padding * 2)));
  const nextHeight = Math.max(48, Math.round(rect.height + (padding * 2)));
  const nextX = Math.max(0, Math.round(rect.left - padding));
  const nextY = Math.max(0, Math.round(rect.top - padding));

  const nextSize = new tauriWindowApi.LogicalSize(nextWidth, nextHeight);
  const nextPosition = new tauriWindowApi.LogicalPosition(nextX, nextY);
  await callWindowMethod(appWindowRef, "setSize", nextSize);
  await callWindowMethod(appWindowRef, "setPosition", nextPosition);

  queueRuntimeLog("overlay.host-window.toolbar-shield.applied", {
    x: nextX,
    y: nextY,
    width: nextWidth,
    height: nextHeight
  });
  return true;
}

function isOverlayModeSupported() {
  return isDesktopAppRuntime() && (runtimePlatform === "windows" || runtimePlatform === "linux");
}

function isOverlayMouseModeSupported() {
  return isOverlayModeSupported() && overlayMode && isDesktopAppRuntime();
}

function updateOverlayMouseModeButton() {
  if (!overlayMouseModeToggleButton) {
    return;
  }

  const visible = overlayMode && isOverlayMouseModeSupported();
  overlayMouseModeToggleButton.hidden = !visible;
  if (!visible) {
    overlayMouseModeToggleButton.classList.remove("is-active");
    overlayMouseModeToggleButton.setAttribute("aria-pressed", "false");
    overlayMouseModeToggleButton.disabled = true;
    return;
  }

  const supported = isOverlayMouseModeSupported();
  overlayMouseModeToggleButton.classList.toggle("is-active", supported && overlayMousePassthrough);
  overlayMouseModeToggleButton.setAttribute("aria-pressed", String(supported && overlayMousePassthrough));
  overlayMouseModeToggleButton.disabled = !supported
    || overlayTransitionInProgress
    || overlayMouseTransitionInProgress
    || pdfExportInProgress
    || sessionRestoreInProgress;
  overlayMouseModeToggleButton.title = overlayMousePassthrough
    ? "마우스 모드 종료 (F7)"
    : "마우스 모드 (F7)";
}

function isToolbarHitByPoint(clientX, clientY) {
  if (!toolbar || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return false;
  }

  const rect = toolbar.getBoundingClientRect();
  return clientX >= (rect.left - OVERLAY_MOUSE_HIT_PADDING_PX)
    && clientX <= (rect.right + OVERLAY_MOUSE_HIT_PADDING_PX)
    && clientY >= (rect.top - OVERLAY_MOUSE_HIT_PADDING_PX)
    && clientY <= (rect.bottom + OVERLAY_MOUSE_HIT_PADDING_PX);
}

function isToolbarRecoveryZoneHit(clientX, clientY) {
  if (!toolbar || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return false;
  }

  const rect = toolbar.getBoundingClientRect();
  const placement = (toolbarLayout && typeof toolbarLayout.placement === "string")
    ? toolbarLayout.placement
    : "right";

  if (placement === "right") {
    const laneStart = Math.min(
      rect.left - OVERLAY_MOUSE_RECOVERY_ZONE_PX,
      window.innerWidth - OVERLAY_MOUSE_RECOVERY_ZONE_PX
    );
    return clientX >= laneStart;
  }

  if (placement === "left") {
    const laneEnd = Math.max(
      rect.right + OVERLAY_MOUSE_RECOVERY_ZONE_PX,
      OVERLAY_MOUSE_RECOVERY_ZONE_PX
    );
    return clientX <= laneEnd;
  }

  if (placement === "top") {
    return clientY <= (rect.bottom + OVERLAY_MOUSE_RECOVERY_ZONE_PX);
  }

  if (placement === "bottom") {
    return clientY >= (rect.top - OVERLAY_MOUSE_RECOVERY_ZONE_PX);
  }

  return clientX >= (rect.left - OVERLAY_MOUSE_RECOVERY_ZONE_PX)
    && clientX <= (rect.right + OVERLAY_MOUSE_RECOVERY_ZONE_PX)
    && clientY >= (rect.top - OVERLAY_MOUSE_RECOVERY_ZONE_PX)
    && clientY <= (rect.bottom + OVERLAY_MOUSE_RECOVERY_ZONE_PX);
}

function isOverlayUiEventTarget(target) {
  if (!toolbar || !target || !(target instanceof Element)) {
    return false;
  }

  return toolbar.contains(target);
}

async function setOverlayNativeIgnoreState(nextIgnore) {
  const desiredIgnore = Boolean(nextIgnore);
  const appWindowRef = getTauriAppWindow();
  if (!appWindowRef) {
    return false;
  }

  if (overlayMouseNativeIgnoreState === desiredIgnore) {
    return true;
  }

  if (runtimePlatform === "windows") {
    overlayMouseForwardOptionAvailable = false;
    const fallbackResult = await setDesktopWindowClickThrough(desiredIgnore);
    if (!fallbackResult) {
      return false;
    }

    overlayMouseNativeIgnoreState = desiredIgnore;
    return true;
  }

  const withForwardResult = await callWindowMethod(
    appWindowRef,
    "setIgnoreCursorEvents",
    desiredIgnore,
    { forward: true }
  );
  if (withForwardResult !== null) {
    overlayMouseForwardOptionAvailable = true;
    overlayMouseNativeIgnoreState = desiredIgnore;
    return true;
  }

  const withoutForwardResult = await callWindowMethod(
    appWindowRef,
    "setIgnoreCursorEvents",
    desiredIgnore
  );
  if (withoutForwardResult !== null) {
    overlayMouseForwardOptionAvailable = false;
    queueRuntimeLog("overlay.mousemode.forward-unavailable", null);
    overlayMouseNativeIgnoreState = desiredIgnore;
    return true;
  }

  return false;
}

function queueOverlayNativeIgnoreState(nextIgnore) {
  const desiredIgnore = Boolean(nextIgnore);
  overlayMouseNativeQueue = overlayMouseNativeQueue
    .catch(() => null)
    .then(() => setOverlayNativeIgnoreState(desiredIgnore));
  return overlayMouseNativeQueue;
}

async function readGlobalCursorPosition() {
  const point = await invokeDesktopCommand("get_global_cursor_position");
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return null;
  }

  return {
    x: Number(point.x),
    y: Number(point.y)
  };
}

async function readWindowCursorPositionCss() {
  const appWindowRef = getTauriAppWindow();
  if (appWindowRef) {
    const [cursorPosition, runtimeScale] = await Promise.all([
      callWindowMethod(appWindowRef, "cursorPosition"),
      callWindowMethod(appWindowRef, "scaleFactor")
    ]);

    if (cursorPosition && Number.isFinite(cursorPosition.x) && Number.isFinite(cursorPosition.y)) {
      const rawX = Number(cursorPosition.x);
      const rawY = Number(cursorPosition.y);
      const browserScaleFactor = Math.max(1, Number(window.devicePixelRatio) || 1);
      const scaleFactor = Number.isFinite(runtimeScale) && runtimeScale > 0
        ? Number(runtimeScale)
        : browserScaleFactor;

      return {
        x: rawX / scaleFactor,
        y: rawY / scaleFactor,
        rawX,
        rawY,
        scaleFactor
      };
    }
  }

  const point = await invokeDesktopCommand("get_window_cursor_position");
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return null;
  }

  const rawX = Number(point.x);
  const rawY = Number(point.y);
  const runtimeScaleFactor = Number(point.scaleFactor ?? point.scale_factor);
  const browserScaleFactor = Math.max(1, Number(window.devicePixelRatio) || 1);
  const scaleFactor = Number.isFinite(runtimeScaleFactor) && runtimeScaleFactor > 0
    ? runtimeScaleFactor
    : browserScaleFactor;
  const scaledX = rawX / scaleFactor;
  const scaledY = rawY / scaleFactor;
  const viewportWidth = Math.max(1, Number(window.innerWidth) || Number(document.documentElement.clientWidth) || 1);
  const viewportHeight = Math.max(1, Number(window.innerHeight) || Number(document.documentElement.clientHeight) || 1);
  const rawOutsideDistance = Math.max(0, -rawX)
    + Math.max(0, -rawY)
    + Math.max(0, rawX - viewportWidth)
    + Math.max(0, rawY - viewportHeight);
  const scaledOutsideDistance = Math.max(0, -scaledX)
    + Math.max(0, -scaledY)
    + Math.max(0, scaledX - viewportWidth)
    + Math.max(0, scaledY - viewportHeight);

  if (scaledOutsideDistance <= rawOutsideDistance) {
    return {
      x: scaledX,
      y: scaledY,
      rawX,
      rawY,
      scaleFactor
    };
  }

  return {
    x: rawX,
    y: rawY,
    rawX,
    rawY,
    scaleFactor
  };
}

async function readWindowCursorPositionWithFallback() {
  const directPoint = await readWindowCursorPositionCss();
  const viewportWidth = Math.max(1, Number(window.innerWidth) || Number(document.documentElement.clientWidth) || 1);
  const viewportHeight = Math.max(1, Number(window.innerHeight) || Number(document.documentElement.clientHeight) || 1);
  const tolerance = 240;

  if (directPoint
    && Number.isFinite(directPoint.x)
    && Number.isFinite(directPoint.y)
    && directPoint.x >= -tolerance
    && directPoint.y >= -tolerance
    && directPoint.x <= (viewportWidth + tolerance)
    && directPoint.y <= (viewportHeight + tolerance)) {
    return directPoint;
  }

  const [globalPoint, windowRect] = await Promise.all([
    readGlobalCursorPosition(),
    invokeDesktopCommand("get_window_rect")
  ]);
  if (!globalPoint
    || !windowRect
    || !Number.isFinite(windowRect.left)
    || !Number.isFinite(windowRect.top)) {
    return directPoint;
  }

  const fallbackPoint = {
    x: Number(globalPoint.x) - Number(windowRect.left),
    y: Number(globalPoint.y) - Number(windowRect.top),
    rawX: Number(globalPoint.x),
    rawY: Number(globalPoint.y),
    scaleFactor: Number(window.devicePixelRatio) || 1
  };

  queueRuntimeLog("overlay.mousemode.cursor-fallback", {
    x: Math.round(fallbackPoint.x),
    y: Math.round(fallbackPoint.y),
    rawX: Math.round(fallbackPoint.rawX),
    rawY: Math.round(fallbackPoint.rawY)
  });
  return fallbackPoint;
}

function isToolbarHitByCursorPosition(cursorPosition) {
  if (!cursorPosition) {
    return false;
  }

  const cssHit = isToolbarHitByPoint(cursorPosition.x, cursorPosition.y);
  if (cssHit) {
    return true;
  }

  const scaleFactor = Number(cursorPosition.scaleFactor);
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
    return false;
  }

  const rect = toolbar.getBoundingClientRect();
  const scaledPadding = OVERLAY_MOUSE_HIT_PADDING_PX * scaleFactor;
  const left = (rect.left * scaleFactor) - scaledPadding;
  const right = (rect.right * scaleFactor) + scaledPadding;
  const top = (rect.top * scaleFactor) - scaledPadding;
  const bottom = (rect.bottom * scaleFactor) + scaledPadding;
  const rawX = Number(cursorPosition.rawX);
  const rawY = Number(cursorPosition.rawY);
  if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) {
    return false;
  }

  return rawX >= left && rawX <= right && rawY >= top && rawY <= bottom;
}

function stopOverlayMouseTracker() {
  if (overlayMouseTrackerTimer !== null) {
    window.clearInterval(overlayMouseTrackerTimer);
    overlayMouseTrackerTimer = null;
  }
  overlayMousePollInFlight = false;
  overlayMousePollFailureCount = 0;
  overlayMouseToolbarRecoveryUntil = 0;
}

async function pollOverlayMouseTracker() {
  if (overlayMousePollInFlight) {
    return;
  }

  if (!overlayMode || !overlayMousePassthrough || overlayTransitionInProgress || overlayMouseTransitionInProgress) {
    return;
  }

  const appWindowRef = getTauriAppWindow();
  if (!appWindowRef || !toolbar) {
    return;
  }

  overlayMousePollInFlight = true;

  try {
    const cursorPosition = await readWindowCursorPositionWithFallback();

    if (!cursorPosition) {
      overlayMousePollFailureCount += 1;
      if (runtimePlatform === "windows" && overlayMousePollFailureCount >= OVERLAY_MOUSE_POLL_MAX_FAILURES) {
        await setOverlayMousePassthrough(false, {
          announce: true,
          restoreFocus: false
        });
      }
      return;
    }

    const baseToolbarHit = isToolbarHitByCursorPosition(cursorPosition);
    const needsRecoveryZone = overlayMouseForwardOptionAvailable === false;
    let wantsToolbarInteraction = baseToolbarHit
      || (needsRecoveryZone && isToolbarRecoveryZoneHit(cursorPosition.x, cursorPosition.y));
    const now = Date.now();
    if (wantsToolbarInteraction) {
      overlayMouseToolbarRecoveryUntil = now + OVERLAY_MOUSE_RECOVERY_HOLD_MS;
    } else if (overlayMouseToolbarRecoveryUntil > now) {
      wantsToolbarInteraction = true;
    }

    if (wantsToolbarInteraction !== overlayMouseUiBypassActive) {
      queueRuntimeLog("overlay.mousemode.hit-state", {
        x: Math.round(cursorPosition.x),
        y: Math.round(cursorPosition.y),
        rawX: Number.isFinite(cursorPosition.rawX) ? Math.round(cursorPosition.rawX) : null,
        rawY: Number.isFinite(cursorPosition.rawY) ? Math.round(cursorPosition.rawY) : null,
        scaleFactor: Number.isFinite(cursorPosition.scaleFactor) ? Number(cursorPosition.scaleFactor) : null,
        baseToolbarHit,
        recoveryZone: needsRecoveryZone,
        wantsToolbarInteraction
      });
      overlayMouseUiBypassActive = wantsToolbarInteraction;
      updateOverlayMouseModeButton();
    }

    const success = await queueOverlayNativeIgnoreState(!wantsToolbarInteraction);
    if (!success) {
      overlayMousePollFailureCount += 1;
      if (overlayMousePollFailureCount >= OVERLAY_MOUSE_POLL_MAX_FAILURES) {
        await setOverlayMousePassthrough(false, {
          announce: true,
          restoreFocus: false
        });
      }
      return;
    }

    overlayMousePollFailureCount = 0;
  } finally {
    overlayMousePollInFlight = false;
  }
}

function startOverlayMouseTracker() {
  if (overlayMouseTrackerTimer !== null) {
    return;
  }

  overlayMousePollFailureCount = 0;
  overlayMouseTrackerTimer = window.setInterval(() => {
    void pollOverlayMouseTracker();
  }, OVERLAY_MOUSE_POLL_INTERVAL_MS);
  void pollOverlayMouseTracker();
}

function syncOverlayMouseBypassWithPointerEvent(event) {
  if (!overlayMode || !overlayMousePassthrough || overlayTransitionInProgress || overlayMouseTransitionInProgress) {
    return;
  }
  if (overlayMouseForwardOptionAvailable === false) {
    return;
  }

  const clientX = Number(event && event.clientX);
  const clientY = Number(event && event.clientY);
  const wantsToolbarInteraction = isOverlayUiEventTarget(event && event.target)
    || isToolbarHitByPoint(clientX, clientY);
  if (wantsToolbarInteraction === overlayMouseUiBypassActive) {
    return;
  }

  overlayMouseUiBypassActive = wantsToolbarInteraction;
  updateOverlayMouseModeButton();
  void queueOverlayNativeIgnoreState(!wantsToolbarInteraction);
}

function applyOverlayMouseModeUI(active) {
  const nextActive = Boolean(active) && overlayMode;
  overlayMousePassthrough = nextActive;
  app.classList.toggle("overlay-mouse-mode", overlayMousePassthrough);
  document.body.classList.toggle("overlay-mouse-mode", overlayMousePassthrough);
  document.documentElement.classList.toggle("overlay-mouse-mode", overlayMousePassthrough);
  updateOverlayMouseModeButton();
  updateToolUI();
}

async function setOverlayMousePassthrough(active, options = {}) {
  const { announce = true, restoreFocus = false } = options;
  const nextActive = Boolean(active);

  if (nextActive === overlayMousePassthrough && !overlayMouseTransitionInProgress) {
    updateOverlayMouseModeButton();
    return true;
  }

  if (!overlayMode || !isOverlayModeSupported()) {
    overlayMouseUiBypassActive = false;
    overlayMouseForwardOptionAvailable = null;
    stopOverlayMouseTracker();
    void queueOverlayNativeIgnoreState(false);
    applyOverlayMouseModeUI(false);
    return false;
  }

  const appWindowRef = getTauriAppWindow();
  if (!appWindowRef) {
    overlayMouseUiBypassActive = false;
    overlayMouseForwardOptionAvailable = null;
    stopOverlayMouseTracker();
    void queueOverlayNativeIgnoreState(false);
    applyOverlayMouseModeUI(false);
    return false;
  }

  overlayMouseTransitionInProgress = true;
  updateOverlayMouseModeButton();
  queueRuntimeLog("overlay.mousemode.start", {
    active: nextActive
  });

  try {
    if (nextActive) {
      // Cursor tracking command is currently Windows-only.
      // Linux should still allow mouse mode when native forward is supported.
      if (runtimePlatform === "windows") {
        const cursorProbe = await readWindowCursorPositionCss();
        if (!cursorProbe) {
          stopOverlayMouseTracker();
          if (announce) {
            setDocumentStatus("Mouse mode requires desktop cursor tracking support.", "warning");
          }
          queueRuntimeLog("overlay.mousemode.unsupported", {
            active: nextActive,
            reason: "cursor-tracking-unavailable"
          });
          return false;
        }
      }
    }

    overlayMouseUiBypassActive = nextActive;
    const desiredIgnoreState = false;
    const result = await queueOverlayNativeIgnoreState(desiredIgnoreState);
    if (!result) {
      stopOverlayMouseTracker();
      if (announce) {
        setDocumentStatus("Mouse mode is unavailable in this desktop build.", "warning");
      }
      queueRuntimeLog("overlay.mousemode.unsupported", {
        active: nextActive
      });
      return false;
    }

    if (nextActive && runtimePlatform !== "windows" && overlayMouseForwardOptionAvailable === false) {
      stopOverlayMouseTracker();
      if (announce) {
        setDocumentStatus("Mouse mode requires pointer forwarding support on Linux.", "warning");
      }
      queueRuntimeLog("overlay.mousemode.unsupported", {
        active: nextActive,
        reason: "forwarding-unavailable-linux"
      });
      void queueOverlayNativeIgnoreState(false);
      return false;
    }

    applyOverlayMouseModeUI(nextActive);
    if (nextActive) {
      startOverlayMouseTracker();
    } else {
      stopOverlayMouseTracker();
    }
    if (!nextActive && restoreFocus) {
      await callWindowMethod(appWindowRef, "setFocus");
    }
    if (announce) {
      const message = nextActive
        ? "Mouse mode enabled. Move cursor off toolbar to click through."
        : "Mouse mode disabled.";
      setDocumentStatus(message, "success");
    }
    queueRuntimeLog("overlay.mousemode.success", {
      active: nextActive
    });
    return true;
  } catch (error) {
    stopOverlayMouseTracker();
    if (announce) {
      setDocumentStatus("Failed to toggle mouse mode.", "error");
    }
    queueRuntimeLog("overlay.mousemode.error", {
      active: nextActive,
      error: toRuntimeLogError(error)
    });
    return false;
  } finally {
    overlayMouseTransitionInProgress = false;
    updateOverlayMouseModeButton();
  }
}

function toggleOverlayMouseMode() {
  if (!isOverlayMouseModeSupported()) {
    return;
  }

  if (overlayTransitionInProgress || overlayMouseTransitionInProgress || pdfExportInProgress || sessionRestoreInProgress) {
    return;
  }

  void setOverlayMousePassthrough(!overlayMousePassthrough, {
    announce: true,
    restoreFocus: overlayMousePassthrough
  });
}

function updateOverlayModeButton() {
  const overlaySupported = isOverlayModeSupported();
  if (overlayModeToggleButton) {
    overlayModeToggleButton.hidden = !overlaySupported;
  }

  if (!overlaySupported) {
    overlayMode = false;
    overlayMousePassthrough = false;
    overlayMouseTransitionInProgress = false;
    overlayMouseUiBypassActive = false;
    overlayMouseNativeIgnoreState = false;
    overlayMouseForwardOptionAvailable = null;
    stopOverlayMouseTracker();
    app.classList.remove("overlay-mode");
    app.classList.remove("overlay-mouse-mode");
    document.body.classList.remove("overlay-mode");
    document.body.classList.remove("overlay-mouse-mode");
    document.documentElement.classList.remove("overlay-mode");
    document.documentElement.classList.remove("overlay-mouse-mode");
    if (overlayModeToggleButton) {
      overlayModeToggleButton.classList.remove("is-active");
      overlayModeToggleButton.setAttribute("aria-pressed", "false");
      overlayModeToggleButton.disabled = true;
    }
    void queueOverlayNativeIgnoreState(false);
    updateOverlayMouseModeButton();
    updateToolUI();
    return;
  }

  if (overlayModeToggleButton) {
    overlayModeToggleButton.classList.toggle("is-active", overlayMode);
    overlayModeToggleButton.setAttribute("aria-pressed", String(overlayMode));
    overlayModeToggleButton.disabled = overlayTransitionInProgress || pdfExportInProgress || sessionRestoreInProgress;
    overlayModeToggleButton.title = overlayMode
      ? "\uC624\uBC84\uB808\uC774 \uBAA8\uB4DC \uC885\uB8CC (F8)"
      : "\uC624\uBC84\uB808\uC774 \uBAA8\uB4DC (F8)";
  }
  updateOverlayMouseModeButton();
}

async function applyOverlayModeUI(active) {
  const nextActive = Boolean(active);
  if (nextActive) {
    boardColorBeforeOverlay = normalizeHexColor(boardColorInput.value) || boardColorBeforeOverlay || "#ffffff";
  }

  overlayMode = nextActive;
  if (!overlayMode && overlayMousePassthrough) {
    applyOverlayMouseModeUI(false);
  }
  if (!overlayMode) {
    stopOverlayMouseTracker();
    overlayMouseUiBypassActive = false;
    overlayMouseForwardOptionAvailable = null;
    void queueOverlayNativeIgnoreState(false);
  }
  if (overlayMode) {
    if (!overlaySurfaceStyleSnapshot) {
      overlaySurfaceStyleSnapshot = {
        htmlBackground: document.documentElement.style.background || "",
        htmlBackgroundColor: document.documentElement.style.backgroundColor || "",
        bodyBackground: document.body.style.background || "",
        bodyBackgroundColor: document.body.style.backgroundColor || "",
        appBackground: app && app.style ? app.style.background || "" : "",
        appBackgroundColor: app && app.style ? app.style.backgroundColor || "" : "",
        wrapperBackground: boardWrapper && boardWrapper.style ? boardWrapper.style.background || "" : "",
        wrapperBackgroundColor: boardWrapper && boardWrapper.style ? boardWrapper.style.backgroundColor || "" : "",
        boardBackground: backgroundCanvas.style.background || "",
        boardBackgroundColor: backgroundCanvas.style.backgroundColor || "",
        boardDisplay: backgroundCanvas.style.display || "",
        boardOpacity: backgroundCanvas.style.opacity || "",
        drawCanvasBackground: canvas.style.background || "",
        drawCanvasBackgroundColor: canvas.style.backgroundColor || ""
      };
    }

    app.style.setProperty("--overlay-surface-color", "transparent");
    document.documentElement.style.setProperty("--overlay-surface-color", "transparent");
    document.body.style.setProperty("--overlay-surface-color", "transparent");
    document.documentElement.style.background = "transparent";
    document.documentElement.style.backgroundColor = "transparent";
    document.documentElement.style.backgroundImage = "none";
    document.body.style.background = "transparent";
    document.body.style.backgroundColor = "transparent";
    document.body.style.backgroundImage = "none";
    if (app && app.style) {
      app.style.background = "transparent";
      app.style.backgroundColor = "transparent";
      app.style.backgroundImage = "none";
    }
    if (boardWrapper && boardWrapper.style) {
      boardWrapper.style.background = "transparent";
      boardWrapper.style.backgroundColor = "transparent";
      boardWrapper.style.backgroundImage = "none";
    }
    backgroundCanvas.style.background = "transparent";
    backgroundCanvas.style.backgroundColor = "transparent";
    backgroundCanvas.style.display = "none";
    backgroundCanvas.style.opacity = "0";
    backgroundCanvas.style.visibility = "hidden";
    canvas.style.background = "transparent";
    canvas.style.backgroundColor = "transparent";
    canvas.style.backdropFilter = "none";

    const appWindowRef = getTauriAppWindow();
    if (appWindowRef) {
      await waitShortDelay(16);
      const surfaceApplied = await setDesktopOverlaySurface(true);
      const alphaApplied = await setDesktopWebviewBackgroundAlpha(0);
      if (!surfaceApplied || !alphaApplied) {
        await waitShortDelay(80);
        await setDesktopOverlaySurface(true);
        await setDesktopWebviewBackgroundAlpha(0);
      }
    }
  } else if (overlaySurfaceStyleSnapshot) {
    document.documentElement.style.background = overlaySurfaceStyleSnapshot.htmlBackground;
    document.documentElement.style.backgroundColor = overlaySurfaceStyleSnapshot.htmlBackgroundColor;
    document.body.style.background = overlaySurfaceStyleSnapshot.bodyBackground;
    document.body.style.backgroundColor = overlaySurfaceStyleSnapshot.bodyBackgroundColor;
    if (app && app.style) {
      app.style.background = overlaySurfaceStyleSnapshot.appBackground;
      app.style.backgroundColor = overlaySurfaceStyleSnapshot.appBackgroundColor;
    }
    if (boardWrapper && boardWrapper.style) {
      boardWrapper.style.background = overlaySurfaceStyleSnapshot.wrapperBackground;
      boardWrapper.style.backgroundColor = overlaySurfaceStyleSnapshot.wrapperBackgroundColor;
    }
    backgroundCanvas.style.background = overlaySurfaceStyleSnapshot.boardBackground;
    backgroundCanvas.style.backgroundColor = overlaySurfaceStyleSnapshot.boardBackgroundColor;
    backgroundCanvas.style.display = overlaySurfaceStyleSnapshot.boardDisplay;
    backgroundCanvas.style.opacity = overlaySurfaceStyleSnapshot.boardOpacity;
    backgroundCanvas.style.visibility = "";
    canvas.style.background = overlaySurfaceStyleSnapshot.drawCanvasBackground;
    canvas.style.backgroundColor = overlaySurfaceStyleSnapshot.drawCanvasBackgroundColor;
    canvas.style.backdropFilter = "";
    overlaySurfaceStyleSnapshot = null;

    const appWindowRef = getTauriAppWindow();
    if (appWindowRef) {
      await waitShortDelay(16);
      await setDesktopWebviewBackgroundAlpha(255);
      await setDesktopOverlaySurface(false);
    }
  }
  app.classList.toggle("overlay-mode", overlayMode);
  document.body.classList.toggle("overlay-mode", overlayMode);
  document.documentElement.classList.toggle("overlay-mode", overlayMode);
  if (overlayMode) {
    setBoardColor("transparent");
  } else {
    const restoredColor = normalizeHexColor(boardColorInput.value)
      || boardColorBeforeOverlay
      || "#ffffff";
    setBoardColor(restoredColor);
    boardColorBeforeOverlay = null;
  }
  updateOverlayModeButton();
  renderBoardBackground();
}

async function enterOverlayMode() {
  if (overlayMode || overlayTransitionInProgress) {
    queueRuntimeLog("overlay.enter.skipped", {
      overlayMode,
      overlayTransitionInProgress
    });
    return;
  }

  overlayTransitionInProgress = true;
  updateOverlayModeButton();
  queueRuntimeLog("overlay.enter.start", {
    runtimePlatform,
    protocol: String((window.location && window.location.protocol) || ""),
    isLikelyTauri: isLikelyTauriProtocol(),
    desktopRuntime: isDesktopAppRuntime()
  });

  try {
    const appWindowRef = getTauriAppWindow();
    if (!isLikelyTauriProtocol()) {
      setDocumentStatus("Overlay mode is available in desktop app only.", "warning");
      queueRuntimeLog("overlay.enter.blocked", { reason: "not-tauri-protocol" });
      return;
    }

    if (!isOverlayModeSupported()) {
      setDocumentStatus("Overlay mode is available in desktop app only.", "warning");
      queueRuntimeLog("overlay.enter.blocked", {
        reason: "unsupported-runtime",
        runtimePlatform,
        desktopRuntime: isDesktopAppRuntime()
      });
      return;
    }

    if (!appWindowRef) {
      await enterFullscreen();
      await applyOverlayModeUI(true);
      updateFullscreenButtons();
      setDocumentStatus("Overlay mode enabled. Press F8 to return.", "success");
      queueRuntimeLog("overlay.enter.browser-fallback");
      return;
    }

    if (!isDedicatedOverlayWindow()) {
      const dedicatedOpened = await openDedicatedOverlayWindow();
      if (dedicatedOpened) {
        queueRuntimeLog("overlay.window.opened", {
          label: OVERLAY_WINDOW_LABEL
        });
        return;
      }
    }

    overlayWindowSnapshot = await captureOverlayWindowSnapshot(appWindowRef);
    queueRuntimeLog("overlay.snapshot.captured", {
      snapshot: sanitizeRuntimeLogDetails(overlayWindowSnapshot)
    });
    await callWindowMethod(appWindowRef, "setDecorations", false);
    await callWindowMethod(appWindowRef, "setAlwaysOnTop", true);
    await callWindowMethod(appWindowRef, "setResizable", false);
    const entered = await requestNativeOverlayLike(appWindowRef);
    await callWindowMethod(appWindowRef, "setFocus");
    if (!entered) {
      setDocumentStatus("Unable to switch window to overlay mode.", "error");
      queueRuntimeLog("overlay.enter.failed", {
        reason: "native-request-failed",
        nativeFullscreenActive,
        nativeWindowMaximized
      });
      await restoreOverlayWindowSnapshot(appWindowRef, overlayWindowSnapshot);
      overlayWindowSnapshot = null;
      await applyOverlayModeUI(false);
      return;
    }
    await applyOverlayModeUI(true);
    window.dispatchEvent(new Event("resize"));
    updateFullscreenButtons();
    setDocumentStatus("Overlay mode enabled. Press F8 to return.", "success");
    queueRuntimeLog("overlay.enter.success", {
      nativeFullscreenActive,
      nativeWindowMaximized
    });
  } catch (error) {
    setDocumentStatus("Failed to enable overlay mode.", "error");
    queueRuntimeLog("overlay.enter.error", {
      error: toRuntimeLogError(error)
    });
  } finally {
    overlayTransitionInProgress = false;
    updateOverlayModeButton();
    queueRuntimeLog("overlay.enter.final", {
      overlayMode,
      overlayTransitionInProgress
    });
  }
}

async function exitOverlayMode() {
  if (!overlayMode || overlayTransitionInProgress) {
    queueRuntimeLog("overlay.exit.skipped", {
      overlayMode,
      overlayTransitionInProgress
    });
    return;
  }

  overlayTransitionInProgress = true;
  updateOverlayModeButton();
  queueRuntimeLog("overlay.exit.start", {
    hasSnapshot: Boolean(overlayWindowSnapshot)
  });

  try {
    const appWindowRef = getTauriAppWindow();
    if (isDedicatedOverlayWindow() && appWindowRef) {
      if (overlayMousePassthrough) {
        await setOverlayMousePassthrough(false, {
          announce: false,
          restoreFocus: false
        });
      }
      await emitTauriRuntimeEvent(OVERLAY_WINDOW_CLOSED_EVENT, {
        source: OVERLAY_WINDOW_LABEL
      });
      await callWindowMethod(appWindowRef, "close");
      return;
    }

    if (appWindowRef) {
      if (overlayMousePassthrough) {
        await setOverlayMousePassthrough(false, {
          announce: false,
          restoreFocus: false
        });
      }
      await restoreOverlayWindowSnapshot(appWindowRef, overlayWindowSnapshot);
      await refreshNativeFullscreenState();
    } else {
      await exitFullscreen();
    }

    await applyOverlayModeUI(false);
    updateFullscreenButtons();
    setDocumentStatus("Board mode enabled.", "success");
    queueRuntimeLog("overlay.exit.success", {
      nativeFullscreenActive,
      nativeWindowMaximized
    });
  } catch (error) {
    setDocumentStatus("Failed to restore board mode.", "error");
    queueRuntimeLog("overlay.exit.error", {
      error: toRuntimeLogError(error)
    });
  } finally {
    overlayWindowSnapshot = null;
    overlayTransitionInProgress = false;
    updateOverlayModeButton();
    queueRuntimeLog("overlay.exit.final", {
      overlayMode,
      overlayTransitionInProgress
    });
  }
}

function toggleOverlayMode() {
  if (!isOverlayModeSupported() || pdfExportInProgress || sessionRestoreInProgress) {
    return;
  }

  if (overlayMode) {
    exitOverlayMode();
    return;
  }

  enterOverlayMode();
}

