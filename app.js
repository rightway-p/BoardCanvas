const backgroundCanvas = document.getElementById("boardBackground");
const backgroundCtx = backgroundCanvas.getContext("2d");
const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const app = document.querySelector(".app");
const toolbar = document.querySelector(".toolbar");

const penToolButton = document.getElementById("penTool");
const eraserToolButton = document.getElementById("eraserTool");
const pixelEraserModeButton = document.getElementById("pixelEraserMode");
const strokeEraserModeButton = document.getElementById("strokeEraserMode");
const undoButton = document.getElementById("undoButton");
const redoButton = document.getElementById("redoButton");
const clearButton = document.getElementById("clearButton");
const fullscreenToggleButton = document.getElementById("fullscreenToggle");
const overlayModeToggleButton = document.getElementById("overlayModeToggle");

const penColorInput = document.getElementById("penColor");
const boardColorInput = document.getElementById("boardColor");
const lineWidthInput = document.getElementById("lineWidth");
const lineWidthDecButton = document.getElementById("lineWidthDec");
const lineWidthIncButton = document.getElementById("lineWidthInc");
const documentEditor = document.getElementById("documentEditor");
const openDocumentPopupButton = document.getElementById("openDocumentPopup");
const documentPopup = document.getElementById("documentPopup");
const documentLoadButton = document.getElementById("documentLoadButton");
const documentInput = document.getElementById("documentInput");
const pdfPrevPageButton = document.getElementById("pdfPrevPage");
const pdfNextPageButton = document.getElementById("pdfNextPage");
const pdfPageIndicator = document.getElementById("pdfPageIndicator");
const exportAnnotatedPdfButton = document.getElementById("exportAnnotatedPdfButton");
const toolbarPdfPageIndicator = document.getElementById("toolbarPdfPageIndicator");
const removeDocumentButton = document.getElementById("removeDocumentButton");
const documentStatus = document.getElementById("documentStatus");
const eraserToolEditor = document.getElementById("eraserToolEditor");
const eraserToolPopup = document.getElementById("eraserToolPopup");
const eraserWidthInput = document.getElementById("eraserWidth");
const eraserWidthDecButton = document.getElementById("eraserWidthDec");
const eraserWidthIncButton = document.getElementById("eraserWidthInc");
const boardColorEditor = document.getElementById("boardColorEditor");
const openBoardColorPopupButton = document.getElementById("openBoardColorPopup");
const boardColorPreviewInput = document.getElementById("boardColorPreview");
const boardColorPopup = document.getElementById("boardColorPopup");
const presetHelp = document.getElementById("presetHelp");
const presetHelpButton = document.getElementById("presetHelpButton");
const presetHelpPopup = document.getElementById("presetHelpPopup");
const toolbarDragHandle = document.getElementById("toolbarDragHandle");
const modeLabel = document.getElementById("modeLabel");
const penPresetsContainer = document.getElementById("penPresets");
const boardPresetsContainer = document.getElementById("boardPresets");

const DEFAULT_PEN_PRESETS = [
  { color: "#111111", width: 2, type: "basic" },
  { color: "#ffffff", width: 2, type: "basic" },
  { color: "#e53935", width: 2, type: "basic" },
  { color: "#1e88e5", width: 2, type: "basic" }
];

const DEFAULT_BOARD_PRESETS = [
  "#ffffff",
  "#f1f3f5",
  "#0b6623",
  "#1b1f3b",
  "#fff8e1",
  "#fce4ec",
  "#e3f2fd",
  "#ede7f6"
];

const PEN_PRESET_STORAGE_KEY = "board.pen.presets.v1";
const BOARD_PRESET_STORAGE_KEY = "board.background.presets.v1";
const LAST_PEN_COLOR_STORAGE_KEY = "board.pen.lastColor.v1";
const LAST_PEN_WIDTH_STORAGE_KEY = "board.pen.lastWidth.v1";
const LAST_ERASER_WIDTH_STORAGE_KEY = "board.eraser.lastWidth.v1";
const LAST_ERASER_MODE_STORAGE_KEY = "board.eraser.lastMode.v1";
const LAST_BOARD_COLOR_STORAGE_KEY = "board.background.lastColor.v1";
const LAST_TOOLBAR_LAYOUT_STORAGE_KEY = "board.toolbar.layout.v1";
const SESSION_STORAGE_KEY = "board.session.state.v1";
const SESSION_STORAGE_VERSION = 1;
const SESSION_AUTOSAVE_DELAY_MS = 500;
const SESSION_DB_NAME = "boardcanvas.session.db";
const SESSION_DB_STORE = "session-files";
const SESSION_DB_PDF_KEY = "last-pdf";
const PDF_WORKER_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const QUALITY_PRESETS = {
  normal: {
    dprCap: 2,
    minSegmentLength: 1.0,
    inputSmoothing: 0.22,
    maxPointsPerFrame: 48,
    frameBudgetMs: 6
  },
  low: {
    dprCap: 1,
    minSegmentLength: 1.4,
    inputSmoothing: 0.28,
    maxPointsPerFrame: 28,
    frameBudgetMs: 4
  }
};
const MAX_QUEUE_POINTS = 320;
const TOOLBAR_DOCK_THRESHOLD = 48;
const HISTORY_STACK_LIMIT = 120;

let qualityLevel = detectLowSpecDevice() ? "low" : "normal";
let quality = QUALITY_PRESETS[qualityLevel];

let drawing = false;
let hasStrokeMoved = false;
let lastPoint = null;
let lastMidPoint = null;
let filteredPoint = null;
let pixelRatio = 1;
let frameCostAverage = 0;
let pendingQualityResize = false;

let currentPenType = "basic";
let penPresets = [];
let boardPresetColors = [];

const pendingPoints = [];
let pendingHead = 0;
let frameRequested = false;
const strokes = [];
let boardStrokeSnapshot = [];
const pdfPageStrokeSnapshots = new Map();
let activeStroke = null;
let strokeEraserActive = false;
let strokeEraserPointerId = null;
let strokeEraserLastPoint = null;
let strokeEraserHistoryArmed = false;
let toolbarDragPointerId = null;
let toolbarDragOffsetX = 0;
let toolbarDragOffsetY = 0;
let toolbarDragNextX = 12;
let toolbarDragNextY = 12;
let toolbarDragPreviewPlacement = "top";

let tool = "pen";
let eraserMode = "eraser";
let toolbarLayout = {
  placement: "top",
  floatX: 120,
  floatY: 120
};
let pdfDocument = null;
let pdfPageNumber = 1;
let pdfPageRasterCanvas = null;
let pdfRenderTask = null;
let pdfRenderToken = 0;
let pdfRenderDebounceTimer = null;
let pdfLoadingToken = 0;
let pdfExportInProgress = false;
let loadedPdfBytes = null;
let sessionPdfBytesDirty = false;
let loadedDocumentName = "";
let isPdfWorkerConfigured = false;
let sessionAutosaveTimer = null;
let sessionRestoreInProgress = false;
const strokeHistoryByContext = new Map();
let overlayMode = false;
let overlayTransitionInProgress = false;
let overlayWindowSnapshot = null;
let nativeFullscreenActive = false;
let nativeWindowMaximized = false;
const runtimePlatform = detectRuntimePlatform();

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
  return protocol === "tauri:";
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
    return nativeFullscreenActive;
  }

  const [nextFullscreenState, nextMaximizedState] = await Promise.all([
    callWindowMethod(appWindowRef, "isFullscreen"),
    callWindowMethod(appWindowRef, "isMaximized")
  ]);

  nativeFullscreenActive = nextFullscreenState === true;
  nativeWindowMaximized = nextMaximizedState === true;

  return nativeFullscreenActive;
}

async function requestNativeFullscreenLike(appWindowRef) {
  if (!appWindowRef) {
    return false;
  }

  await callWindowMethod(appWindowRef, "setFullscreen", true);
  await refreshNativeFullscreenState();
  if (nativeFullscreenActive || nativeWindowMaximized) {
    return true;
  }

  await callWindowMethod(appWindowRef, "maximize");
  await refreshNativeFullscreenState();
  return nativeFullscreenActive || nativeWindowMaximized;
}

async function requestNativeExitFullscreenLike(appWindowRef) {
  if (!appWindowRef) {
    return false;
  }

  await callWindowMethod(appWindowRef, "setFullscreen", false);
  await callWindowMethod(appWindowRef, "unmaximize");
  await refreshNativeFullscreenState();
  return !nativeFullscreenActive && !nativeWindowMaximized;
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
  const active = isFullscreenActive();

  fullscreenToggleButton.disabled = !supported;
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
    return;
  }

  const appWindowRef = getTauriAppWindow();
  if (appWindowRef) {
    await requestNativeFullscreenLike(appWindowRef);
    await refreshNativeFullscreenState();
    updateFullscreenButtons();
    if (!isFullscreenActive()) {
      setDocumentStatus("Unable to enable fullscreen in desktop runtime.", "warning");
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
    }
  }
  updateFullscreenButtons();
}

async function exitFullscreen() {
  if (!isFullscreenActive()) {
    return;
  }

  const appWindowRef = getTauriAppWindow();
  if (appWindowRef) {
    await requestNativeExitFullscreenLike(appWindowRef);
    await refreshNativeFullscreenState();
    updateFullscreenButtons();
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
    }
  }
  updateFullscreenButtons();
}

async function toggleFullscreen() {
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
    return null;
  }

  try {
    return await targetWindow[methodName](...args);
  } catch (error) {
    return null;
  }
}

async function captureOverlayWindowSnapshot(appWindowRef) {
  const [position, size, decorated, alwaysOnTop, fullscreen, maximized] = await Promise.all([
    callWindowMethod(appWindowRef, "outerPosition"),
    callWindowMethod(appWindowRef, "outerSize"),
    callWindowMethod(appWindowRef, "isDecorated"),
    callWindowMethod(appWindowRef, "isAlwaysOnTop"),
    callWindowMethod(appWindowRef, "isFullscreen"),
    callWindowMethod(appWindowRef, "isMaximized")
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
    maximized: typeof maximized === "boolean" ? maximized : null
  };
}

async function restoreOverlayWindowSnapshot(appWindowRef, snapshot) {
  const tauriWindowApi = getTauriWindowApi();
  if (!appWindowRef || !snapshot) {
    return;
  }

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
}

function isOverlayModeSupported() {
  return isWindowsDesktopRuntime();
}

function updateOverlayModeButton() {
  if (!overlayModeToggleButton) {
    return;
  }

  const overlaySupported = isOverlayModeSupported();
  overlayModeToggleButton.hidden = !overlaySupported;

  if (!overlaySupported) {
    overlayMode = false;
    app.classList.remove("overlay-mode");
    document.body.classList.remove("overlay-mode");
    document.documentElement.classList.remove("overlay-mode");
    overlayModeToggleButton.classList.remove("is-active");
    overlayModeToggleButton.setAttribute("aria-pressed", "false");
    overlayModeToggleButton.disabled = true;
    return;
  }

  overlayModeToggleButton.classList.toggle("is-active", overlayMode);
  overlayModeToggleButton.setAttribute("aria-pressed", String(overlayMode));
  overlayModeToggleButton.disabled = overlayTransitionInProgress || pdfExportInProgress || sessionRestoreInProgress;
  overlayModeToggleButton.title = overlayMode
    ? "\uC624\uBC84\uB808\uC774 \uBAA8\uB4DC \uC885\uB8CC (F8)"
    : "\uC624\uBC84\uB808\uC774 \uBAA8\uB4DC (F8)";
}

function applyOverlayModeUI(active) {
  overlayMode = Boolean(active);
  app.classList.toggle("overlay-mode", overlayMode);
  document.body.classList.toggle("overlay-mode", overlayMode);
  document.documentElement.classList.toggle("overlay-mode", overlayMode);
  updateOverlayModeButton();
  renderBoardBackground();
}

async function enterOverlayMode() {
  if (overlayMode || overlayTransitionInProgress) {
    return;
  }

  overlayTransitionInProgress = true;
  updateOverlayModeButton();

  try {
    const appWindowRef = getTauriAppWindow();
    if (!appWindowRef) {
      setDocumentStatus("Overlay mode is available in desktop app only.", "warning");
      return;
    }

    if (!isOverlayModeSupported()) {
      setDocumentStatus("Overlay mode is currently supported on Windows desktop. Linux support is planned.", "warning");
      return;
    }

    overlayWindowSnapshot = await captureOverlayWindowSnapshot(appWindowRef);
    await callWindowMethod(appWindowRef, "setDecorations", false);
    await callWindowMethod(appWindowRef, "setAlwaysOnTop", true);
    await callWindowMethod(appWindowRef, "unmaximize");
    await requestNativeFullscreenLike(appWindowRef);
    await callWindowMethod(appWindowRef, "setFocus");
    await refreshNativeFullscreenState();
    if (!nativeFullscreenActive && !nativeWindowMaximized) {
      setDocumentStatus("Unable to switch window to fullscreen. Check Windows display permissions.", "error");
      await restoreOverlayWindowSnapshot(appWindowRef, overlayWindowSnapshot);
      overlayWindowSnapshot = null;
      applyOverlayModeUI(false);
      return;
    }
    applyOverlayModeUI(true);
    updateFullscreenButtons();
    setDocumentStatus("Overlay mode enabled. Press F8 to return.", "success");
  } catch (error) {
    setDocumentStatus("Failed to enable overlay mode.", "error");
  } finally {
    overlayTransitionInProgress = false;
    updateOverlayModeButton();
  }
}

async function exitOverlayMode() {
  if (!overlayMode || overlayTransitionInProgress) {
    return;
  }

  overlayTransitionInProgress = true;
  updateOverlayModeButton();

  try {
    const appWindowRef = getTauriAppWindow();
    if (appWindowRef) {
      await restoreOverlayWindowSnapshot(appWindowRef, overlayWindowSnapshot);
      await refreshNativeFullscreenState();
    }

    applyOverlayModeUI(false);
    updateFullscreenButtons();
    setDocumentStatus("Board mode enabled.", "success");
  } catch (error) {
    setDocumentStatus("Failed to restore board mode.", "error");
  } finally {
    overlayWindowSnapshot = null;
    overlayTransitionInProgress = false;
    updateOverlayModeButton();
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

function isBoardColorPopupOpen() {
  return !boardColorPopup.classList.contains("is-hidden");
}

function setBoardColorPopupOpen(open) {
  boardColorPopup.classList.toggle("is-hidden", !open);
  openBoardColorPopupButton.setAttribute("aria-expanded", String(open));
}

function updateBoardColorTriggerPreview(color) {
  boardColorPreviewInput.style.setProperty("--board-color-preview", color);
}

function closeBoardColorPopup() {
  setBoardColorPopupOpen(false);
}

function isPresetHelpOpen() {
  return !presetHelpPopup.classList.contains("is-hidden");
}

function setPresetHelpOpen(open) {
  presetHelpPopup.classList.toggle("is-hidden", !open);
  presetHelpButton.setAttribute("aria-expanded", String(open));
}

function closePresetHelp() {
  setPresetHelpOpen(false);
}

function isEraserToolPopupOpen() {
  return !eraserToolPopup.classList.contains("is-hidden");
}

function setEraserToolPopupOpen(open) {
  eraserToolPopup.classList.toggle("is-hidden", !open);
  eraserToolButton.setAttribute("aria-expanded", String(open));
}

function closeEraserToolPopup() {
  setEraserToolPopupOpen(false);
}

function isDocumentPopupOpen() {
  return !documentPopup.classList.contains("is-hidden");
}

function setDocumentPopupOpen(open) {
  documentPopup.classList.toggle("is-hidden", !open);
  openDocumentPopupButton.setAttribute("aria-expanded", String(open));
}

function closeDocumentPopup() {
  setDocumentPopupOpen(false);
}

function setDocumentStatus(message, tone = "normal") {
  documentStatus.textContent = message;
  documentStatus.classList.remove("is-success", "is-warning", "is-error");

  if (tone === "success") {
    documentStatus.classList.add("is-success");
  } else if (tone === "warning") {
    documentStatus.classList.add("is-warning");
  } else if (tone === "error") {
    documentStatus.classList.add("is-error");
  }
}

function hasLoadedPdfDocument() {
  return Boolean(pdfDocument && Number.isFinite(pdfDocument.numPages) && pdfDocument.numPages > 0);
}

function getStrokeHistoryContextKey() {
  if (hasLoadedPdfDocument()) {
    return `pdf:${Math.max(1, Math.round(Number(pdfPageNumber) || 1))}`;
  }

  return "board";
}

function getOrCreateStrokeHistoryEntry(contextKey = getStrokeHistoryContextKey()) {
  let entry = strokeHistoryByContext.get(contextKey);
  if (!entry) {
    entry = {
      undo: [],
      redo: []
    };
    strokeHistoryByContext.set(contextKey, entry);
  }

  return entry;
}

function pushStrokeSnapshot(stack, snapshot) {
  stack.push(snapshot);
  if (stack.length > HISTORY_STACK_LIMIT) {
    stack.shift();
  }
}

function clearAllStrokeHistory() {
  strokeHistoryByContext.clear();
  updateUndoRedoUI();
}

function updateUndoRedoUI() {
  const entry = strokeHistoryByContext.get(getStrokeHistoryContextKey());
  const canUndo = Boolean(entry && entry.undo.length > 0);
  const canRedo = Boolean(entry && entry.redo.length > 0);
  const controlsLocked = pdfExportInProgress || drawing || strokeEraserActive || sessionRestoreInProgress;

  if (undoButton) {
    undoButton.disabled = controlsLocked || !canUndo;
  }
  if (redoButton) {
    redoButton.disabled = controlsLocked || !canRedo;
  }
}

function updatePdfNavigationUI() {
  const hasPdf = hasLoadedPdfDocument();
  const controlsLocked = pdfExportInProgress || sessionRestoreInProgress;
  const currentPage = hasPdf ? pdfPageNumber : 0;
  const totalPages = hasPdf ? Number(pdfDocument.numPages) : 0;
  const indicatorText = hasPdf
    ? `${currentPage} / ${totalPages}`
    : "- / -";

  documentLoadButton.disabled = controlsLocked;
  pdfPrevPageButton.disabled = !hasPdf || controlsLocked || currentPage <= 1;
  pdfNextPageButton.disabled = !hasPdf || controlsLocked || currentPage >= totalPages;
  if (exportAnnotatedPdfButton) {
    exportAnnotatedPdfButton.disabled = !hasPdf || controlsLocked;
  }
  removeDocumentButton.disabled = !hasPdf || controlsLocked;
  pdfPageIndicator.textContent = indicatorText;

  if (toolbarPdfPageIndicator) {
    toolbarPdfPageIndicator.textContent = indicatorText;
    toolbarPdfPageIndicator.classList.toggle("is-empty", !hasPdf);
  }

  updateUndoRedoUI();
  updateOverlayModeButton();
}

function configurePdfWorker() {
  if (isPdfWorkerConfigured) {
    return true;
  }

  if (!window.pdfjsLib || !window.pdfjsLib.GlobalWorkerOptions) {
    setDocumentStatus("PDF engine is unavailable. Refresh and try again.", "error");
    return false;
  }

  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
  isPdfWorkerConfigured = true;
  return true;
}

function normalizeFileExtension(fileName) {
  if (typeof fileName !== "string") {
    return "";
  }

  const lastDot = fileName.lastIndexOf(".");
  if (lastDot < 0 || lastDot >= fileName.length - 1) {
    return "";
  }

  return fileName.slice(lastDot + 1).trim().toLowerCase();
}

function isPdfFile(file) {
  const extension = normalizeFileExtension(file.name);
  return extension === "pdf" || file.type === "application/pdf";
}

function isPptFile(file) {
  const extension = normalizeFileExtension(file.name);
  return extension === "ppt"
    || extension === "pptx"
    || file.type === "application/vnd.ms-powerpoint"
    || file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation";
}

function openSessionDatabase() {
  if (!window.indexedDB) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    let request;
    try {
      request = window.indexedDB.open(SESSION_DB_NAME, 1);
    } catch (error) {
      reject(error);
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SESSION_DB_STORE)) {
        database.createObjectStore(SESSION_DB_STORE);
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error || new Error("Failed to open session database."));
    };
  });
}

async function saveSessionPdfBytes(pdfBytes) {
  if (!(pdfBytes instanceof Uint8Array) || pdfBytes.length <= 0) {
    return;
  }

  let database;
  try {
    database = await openSessionDatabase();
    if (!database) {
      return;
    }

    await new Promise((resolve, reject) => {
      const transaction = database.transaction(SESSION_DB_STORE, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error("PDF save aborted."));
      transaction.onerror = () => reject(transaction.error || new Error("Failed to save PDF data."));

      const store = transaction.objectStore(SESSION_DB_STORE);
      store.put(pdfBytes, SESSION_DB_PDF_KEY);
    });
  } catch (error) {
    // Ignore persistence failures for optional PDF recovery.
  } finally {
    if (database) {
      database.close();
    }
  }
}

async function loadSessionPdfBytes() {
  let database;
  try {
    database = await openSessionDatabase();
    if (!database) {
      return null;
    }

    const value = await new Promise((resolve, reject) => {
      const transaction = database.transaction(SESSION_DB_STORE, "readonly");
      transaction.onabort = () => reject(transaction.error || new Error("PDF read aborted."));
      transaction.onerror = () => reject(transaction.error || new Error("Failed to read PDF data."));

      const store = transaction.objectStore(SESSION_DB_STORE);
      const request = store.get(SESSION_DB_PDF_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Failed to read PDF data."));
    });

    if (!value) {
      return null;
    }
    if (value instanceof Uint8Array) {
      return new Uint8Array(value);
    }
    if (value instanceof ArrayBuffer) {
      return new Uint8Array(value);
    }
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    }

    return null;
  } catch (error) {
    return null;
  } finally {
    if (database) {
      database.close();
    }
  }
}

async function clearSessionPdfBytes() {
  let database;
  try {
    database = await openSessionDatabase();
    if (!database) {
      return;
    }

    await new Promise((resolve, reject) => {
      const transaction = database.transaction(SESSION_DB_STORE, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error("PDF clear aborted."));
      transaction.onerror = () => reject(transaction.error || new Error("Failed to clear PDF data."));

      const store = transaction.objectStore(SESSION_DB_STORE);
      store.delete(SESSION_DB_PDF_KEY);
    });
  } catch (error) {
    // Ignore persistence failures for optional PDF recovery.
  } finally {
    if (database) {
      database.close();
    }
  }
}

function serializeSessionSnapshot() {
  saveCurrentStrokeState();

  const boardStrokes = cloneStrokeCollection(boardStrokeSnapshot);
  const pdfPages = Array.from(pdfPageStrokeSnapshots.entries())
    .map(([pageNumber, pageStrokes]) => {
      return [Math.max(1, Math.round(Number(pageNumber) || 1)), cloneStrokeCollection(pageStrokes)];
    })
    .filter(([, pageStrokes]) => pageStrokes.length > 0)
    .sort((a, b) => a[0] - b[0]);

  return {
    version: SESSION_STORAGE_VERSION,
    savedAt: Date.now(),
    hasPdf: hasLoadedPdfDocument(),
    loadedDocumentName,
    pdfPageNumber: Math.max(1, Math.round(Number(pdfPageNumber) || 1)),
    boardStrokes,
    pdfPages
  };
}

function scheduleSessionAutosave() {
  if (sessionRestoreInProgress) {
    return;
  }

  if (sessionAutosaveTimer !== null) {
    window.clearTimeout(sessionAutosaveTimer);
    sessionAutosaveTimer = null;
  }

  sessionAutosaveTimer = window.setTimeout(() => {
    sessionAutosaveTimer = null;
    persistSessionState();
  }, SESSION_AUTOSAVE_DELAY_MS);
}

function parseSessionSnapshot(rawValue) {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  if (Number(rawValue.version) !== SESSION_STORAGE_VERSION) {
    return null;
  }

  const boardStrokes = normalizeStrokeCollection(rawValue.boardStrokes);
  const pdfPageMap = new Map();

  if (Array.isArray(rawValue.pdfPages)) {
    for (const entry of rawValue.pdfPages) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        continue;
      }

      const pageNumber = Math.max(1, Math.round(Number(entry[0]) || 1));
      const pageStrokes = normalizeStrokeCollection(entry[1]);
      if (pageStrokes.length <= 0) {
        continue;
      }

      pdfPageMap.set(pageNumber, pageStrokes);
    }
  }

  return {
    hasPdf: Boolean(rawValue.hasPdf),
    loadedDocumentName: typeof rawValue.loadedDocumentName === "string"
      ? rawValue.loadedDocumentName
      : "",
    pdfPageNumber: Math.max(1, Math.round(Number(rawValue.pdfPageNumber) || 1)),
    boardStrokes,
    pdfPageMap
  };
}

async function persistSessionState() {
  if (sessionRestoreInProgress) {
    return;
  }

  try {
    const snapshot = serializeSessionSnapshot();
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(snapshot));

    if (snapshot.hasPdf && loadedPdfBytes instanceof Uint8Array && loadedPdfBytes.length > 0) {
      if (sessionPdfBytesDirty) {
        await saveSessionPdfBytes(loadedPdfBytes);
        sessionPdfBytesDirty = false;
      }
    } else {
      await clearSessionPdfBytes();
      sessionPdfBytesDirty = false;
    }
  } catch (error) {
    // localStorage/IndexedDB can be unavailable; skip recovery persistence.
  }
}

async function restoreSessionState() {
  if (sessionRestoreInProgress) {
    return;
  }

  sessionRestoreInProgress = true;
  updateUndoRedoUI();

  try {
    const rawSnapshot = window.localStorage.getItem(SESSION_STORAGE_KEY);
    const snapshot = parseSessionSnapshot(rawSnapshot ? JSON.parse(rawSnapshot) : null);
    if (!snapshot) {
      return;
    }

    boardStrokeSnapshot = cloneStrokeCollection(snapshot.boardStrokes);
    pdfPageStrokeSnapshots.clear();
    for (const [pageNumber, pageStrokes] of snapshot.pdfPageMap.entries()) {
      pdfPageStrokeSnapshots.set(pageNumber, cloneStrokeCollection(pageStrokes));
    }
    restoreCurrentStrokeState();

    if (!snapshot.hasPdf) {
      clearAllStrokeHistory();
      updateUndoRedoUI();
      return;
    }

    const recoveredPdfBytes = await loadSessionPdfBytes();
    if (!(recoveredPdfBytes instanceof Uint8Array) || recoveredPdfBytes.length <= 0) {
      loadedPdfBytes = null;
      sessionPdfBytesDirty = false;
      pdfPageStrokeSnapshots.clear();
      setDocumentStatus("Recovered board state. Reload PDF file to restore document pages.", "warning");
      clearAllStrokeHistory();
      updateUndoRedoUI();
      return;
    }

    const recoveredFileName = snapshot.loadedDocumentName || "recovered.pdf";
    const recoveredFile = new File([recoveredPdfBytes], recoveredFileName, { type: "application/pdf" });
    await loadPdfFromFile(recoveredFile);
    if (!hasLoadedPdfDocument()) {
      loadedPdfBytes = null;
      sessionPdfBytesDirty = false;
      pdfPageStrokeSnapshots.clear();
      setDocumentStatus("Recovered board state. Reload PDF file to restore document pages.", "warning");
      clearAllStrokeHistory();
      return;
    }

    // Reload saved page-level annotations after document load resets snapshots.
    pdfPageStrokeSnapshots.clear();
    for (const [pageNumber, pageStrokes] of snapshot.pdfPageMap.entries()) {
      pdfPageStrokeSnapshots.set(pageNumber, cloneStrokeCollection(pageStrokes));
    }

    const targetPage = Math.min(
      Math.max(1, Math.round(Number(pdfDocument && pdfDocument.numPages) || 1)),
      snapshot.pdfPageNumber
    );
    await renderPdfPage(targetPage);
    setDocumentStatus(`${loadedDocumentName || "PDF"} recovered.`, "success");
    clearAllStrokeHistory();
    updateUndoRedoUI();
  } catch (error) {
    // Ignore recovery failures and continue with a clean runtime state.
  } finally {
    sessionRestoreInProgress = false;
    updatePdfNavigationUI();
  }
}

function getAnnotatedPdfFileName() {
  const rawName = typeof loadedDocumentName === "string"
    ? loadedDocumentName.trim()
    : "";
  const baseName = rawName
    ? rawName.replace(/\.pdf$/i, "")
    : "board";
  const safeName = baseName
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim();
  return `${safeName || "board"}-annotated.pdf`;
}

function downloadBlobFile(blob, fileName) {
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    window.URL.revokeObjectURL(objectUrl);
  }, 1000);
}

function canvasToJpegBytes(targetCanvas, quality = 0.92) {
  return new Promise((resolve, reject) => {
    targetCanvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("Could not encode JPEG image."));
        return;
      }

      try {
        const buffer = await blob.arrayBuffer();
        resolve(new Uint8Array(buffer));
      } catch (error) {
        reject(error);
      }
    }, "image/jpeg", quality);
  });
}

async function drawPdfPageToContext(pageNumber, targetContext, targetWidth, targetHeight) {
  if (!hasLoadedPdfDocument()) {
    return;
  }

  const page = await pdfDocument.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const fitScale = Math.min(
    Math.max(1, targetWidth) / baseViewport.width,
    Math.max(1, targetHeight) / baseViewport.height
  );
  const viewport = page.getViewport({ scale: fitScale });

  const rasterCanvas = document.createElement("canvas");
  rasterCanvas.width = Math.max(1, Math.floor(viewport.width));
  rasterCanvas.height = Math.max(1, Math.floor(viewport.height));

  const rasterContext = rasterCanvas.getContext("2d", { alpha: false });
  if (!rasterContext) {
    throw new Error("Could not create export rendering context.");
  }

  rasterContext.imageSmoothingEnabled = true;
  rasterContext.imageSmoothingQuality = "high";

  const renderTask = page.render({
    canvasContext: rasterContext,
    viewport
  });
  await renderTask.promise;

  const drawWidth = Math.max(1, Math.floor(rasterCanvas.width));
  const drawHeight = Math.max(1, Math.floor(rasterCanvas.height));
  const drawX = Math.floor((targetWidth - drawWidth) / 2);
  const drawY = Math.floor((targetHeight - drawHeight) / 2);

  targetContext.imageSmoothingEnabled = true;
  targetContext.imageSmoothingQuality = "high";
  targetContext.drawImage(rasterCanvas, drawX, drawY, drawWidth, drawHeight);
}

function clearPdfRenderDebounce() {
  if (pdfRenderDebounceTimer === null) {
    return;
  }

  window.clearTimeout(pdfRenderDebounceTimer);
  pdfRenderDebounceTimer = null;
}

function stopPdfRenderTask() {
  if (!pdfRenderTask) {
    return;
  }

  try {
    pdfRenderTask.cancel();
  } catch (error) {
    // Ignore cancellation errors.
  }

  pdfRenderTask = null;
}

function getDefaultToolbarFloatPosition() {
  const x = Math.max(12, Math.round((window.innerWidth * 0.5) - 170));
  const y = Math.max(12, Math.round((window.innerHeight * 0.5) - 34));
  return { x, y };
}

function normalizeToolbarPlacement(value, fallback = "top") {
  const allowed = new Set(["top", "bottom", "left", "right", "floating"]);
  if (allowed.has(value)) {
    return value;
  }

  return fallback;
}

function getNearestDockPlacement(x, y, viewportWidth = window.innerWidth, viewportHeight = window.innerHeight) {
  const distances = [
    { placement: "top", distance: y },
    { placement: "bottom", distance: viewportHeight - y },
    { placement: "left", distance: x },
    { placement: "right", distance: viewportWidth - x }
  ];

  distances.sort((a, b) => a.distance - b.distance);
  return distances[0].placement;
}

function getDockPlacementFromPoint(x, y, viewportWidth = window.innerWidth, viewportHeight = window.innerHeight) {
  const nearest = getNearestDockPlacement(x, y, viewportWidth, viewportHeight);
  const distanceByPlacement = {
    top: y,
    bottom: viewportHeight - y,
    left: x,
    right: viewportWidth - x
  };

  return distanceByPlacement[nearest] <= TOOLBAR_DOCK_THRESHOLD
    ? nearest
    : null;
}

function normalizeToolbarFloatValue(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : fallback;
}

function loadToolbarLayout() {
  const defaultFloat = getDefaultToolbarFloatPosition();
  const fallback = {
    placement: "top",
    floatX: defaultFloat.x,
    floatY: defaultFloat.y
  };

  try {
    const raw = window.localStorage.getItem(LAST_TOOLBAR_LAYOUT_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }

    const normalizedRawPlacement = normalizeToolbarPlacement(raw, "");
    if (normalizedRawPlacement) {
      return {
        placement: normalizedRawPlacement,
        floatX: fallback.floatX,
        floatY: fallback.floatY
      };
    }

    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") {
      return {
        placement: normalizeToolbarPlacement(parsed, fallback.placement),
        floatX: fallback.floatX,
        floatY: fallback.floatY
      };
    }

    if (!parsed || typeof parsed !== "object") {
      return fallback;
    }

    return {
      placement: normalizeToolbarPlacement(parsed.placement, fallback.placement),
      floatX: normalizeToolbarFloatValue(parsed.floatX, fallback.floatX),
      floatY: normalizeToolbarFloatValue(parsed.floatY, fallback.floatY)
    };
  } catch (error) {
    return fallback;
  }
}

function saveToolbarLayout() {
  try {
    if (toolbarLayout.placement === "floating") {
      window.localStorage.setItem(
        LAST_TOOLBAR_LAYOUT_STORAGE_KEY,
        JSON.stringify({
          placement: "floating",
          floatX: toolbarLayout.floatX,
          floatY: toolbarLayout.floatY
        })
      );
      return;
    }

    window.localStorage.setItem(LAST_TOOLBAR_LAYOUT_STORAGE_KEY, toolbarLayout.placement);
  } catch (error) {
    // localStorage unavailable: skip persistence.
  }
}

function applyToolbarPlacementClass() {
  app.classList.remove(
    "toolbar-placement-top",
    "toolbar-placement-bottom",
    "toolbar-placement-left",
    "toolbar-placement-right",
    "toolbar-placement-floating"
  );
  app.classList.add(`toolbar-placement-${toolbarLayout.placement}`);
}

function clearToolbarDockPreviewClasses() {
  app.classList.remove(
    "toolbar-dock-preview-top",
    "toolbar-dock-preview-bottom",
    "toolbar-dock-preview-left",
    "toolbar-dock-preview-right"
  );
}

function applyToolbarDockPreview(placement) {
  clearToolbarDockPreviewClasses();
  app.classList.add(`toolbar-dock-preview-${placement}`);
}

function clampToolbarFloatingPosition(x, y) {
  const margin = 12;
  const rect = toolbar.getBoundingClientRect();
  const maxX = Math.max(margin, window.innerWidth - rect.width - margin);
  const maxY = Math.max(margin, window.innerHeight - rect.height - margin);

  return {
    x: Math.min(maxX, Math.max(margin, Math.round(x))),
    y: Math.min(maxY, Math.max(margin, Math.round(y)))
  };
}

function applyToolbarFloatingPositionVariables() {
  app.style.setProperty("--toolbar-float-x", `${toolbarLayout.floatX}px`);
  app.style.setProperty("--toolbar-float-y", `${toolbarLayout.floatY}px`);
}

function setToolbarFloatingPosition(x, y, persist = true) {
  const clamped = clampToolbarFloatingPosition(x, y);
  toolbarLayout.floatX = clamped.x;
  toolbarLayout.floatY = clamped.y;
  applyToolbarFloatingPositionVariables();

  if (persist) {
    saveToolbarLayout();
  }
}

function setToolbarPlacement(placement, persist = true) {
  toolbarLayout.placement = normalizeToolbarPlacement(placement, toolbarLayout.placement);
  applyToolbarPlacementClass();

  if (persist) {
    saveToolbarLayout();
  }
}

function initToolbarLayout() {
  toolbarLayout = loadToolbarLayout();
  applyToolbarPlacementClass();
  applyToolbarFloatingPositionVariables();

  if (toolbarLayout.placement === "floating") {
    setToolbarFloatingPosition(toolbarLayout.floatX, toolbarLayout.floatY, false);
  }
}

function startToolbarDrag(event) {
  if (event.button !== 0) {
    return;
  }

  event.preventDefault();
  toolbarDragPreviewPlacement = toolbarLayout.placement;
  app.classList.add("toolbar-is-dragging");

  if (toolbarDragPreviewPlacement === "floating") {
    clearToolbarDockPreviewClasses();
  } else {
    applyToolbarDockPreview(toolbarDragPreviewPlacement);
  }

  const rect = toolbar.getBoundingClientRect();
  toolbarDragOffsetX = event.clientX - rect.left;
  toolbarDragOffsetY = event.clientY - rect.top;
  toolbarDragNextX = rect.left;
  toolbarDragNextY = rect.top;
  toolbarDragPointerId = event.pointerId;
  toolbarDragHandle.setPointerCapture(event.pointerId);
}

function moveToolbarDrag(event) {
  if (toolbarDragPointerId !== event.pointerId) {
    return;
  }

  event.preventDefault();
  toolbarDragNextX = event.clientX - toolbarDragOffsetX;
  toolbarDragNextY = event.clientY - toolbarDragOffsetY;

  const dockPlacement = getDockPlacementFromPoint(event.clientX, event.clientY);
  if (dockPlacement) {
    toolbarDragPreviewPlacement = dockPlacement;
    applyToolbarDockPreview(toolbarDragPreviewPlacement);
    return;
  }

  toolbarDragPreviewPlacement = "floating";
  clearToolbarDockPreviewClasses();

  // When toolbar is already floating, follow cursor in real time.
  if (toolbarLayout.placement === "floating") {
    setToolbarFloatingPosition(toolbarDragNextX, toolbarDragNextY, false);
  }
}

function endToolbarDrag(event) {
  if (toolbarDragPointerId !== event.pointerId) {
    return;
  }

  if (event.type === "pointercancel") {
    toolbarDragPointerId = null;
    app.classList.remove("toolbar-is-dragging");
    clearToolbarDockPreviewClasses();
    if (toolbarDragHandle.hasPointerCapture(event.pointerId)) {
      toolbarDragHandle.releasePointerCapture(event.pointerId);
    }
    return;
  }

  const dockPlacement = getDockPlacementFromPoint(event.clientX, event.clientY);
  if (dockPlacement) {
    setToolbarPlacement(dockPlacement, true);
  } else {
    setToolbarPlacement("floating", false);
    setToolbarFloatingPosition(toolbarDragNextX, toolbarDragNextY, false);
    saveToolbarLayout();
  }

  app.classList.remove("toolbar-is-dragging");
  clearToolbarDockPreviewClasses();
  toolbarDragPointerId = null;
  if (toolbarDragHandle.hasPointerCapture(event.pointerId)) {
    toolbarDragHandle.releasePointerCapture(event.pointerId);
  }
}

function handleViewportResize() {
  setCanvasSize();
  if (toolbarLayout.placement === "floating") {
    setToolbarFloatingPosition(toolbarLayout.floatX, toolbarLayout.floatY, false);
  }
}

function detectLowSpecDevice() {
  const cores = Number(navigator.hardwareConcurrency || 4);
  const memory = Number(navigator.deviceMemory || 4);
  return cores <= 2 || memory <= 2;
}

function normalizeHexColor(color) {
  if (typeof color !== "string") {
    return "";
  }

  const normalized = color.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : "";
}

function normalizeWidth(width, inputElement) {
  const min = Number(inputElement.min || 1);
  const max = Number(inputElement.max || 40);
  const numeric = Number(width);
  if (!Number.isFinite(numeric)) {
    return min;
  }

  const rounded = Math.round(numeric);
  return Math.min(max, Math.max(min, rounded));
}

function normalizeLineWidth(width) {
  return normalizeWidth(width, lineWidthInput);
}

function normalizeEraserWidth(width) {
  return normalizeWidth(width, eraserWidthInput);
}

function normalizeEraserMode(mode, fallbackMode = "eraser") {
  if (mode === "eraser" || mode === "strokeEraser") {
    return mode;
  }

  return fallbackMode;
}

function getContrastColor(hex) {
  const value = normalizeHexColor(hex);
  if (!value) {
    return "#ffffff";
  }

  const red = Number.parseInt(value.slice(1, 3), 16);
  const green = Number.parseInt(value.slice(3, 5), 16);
  const blue = Number.parseInt(value.slice(5, 7), 16);
  const luminance = (0.299 * red) + (0.587 * green) + (0.114 * blue);
  return luminance >= 160 ? "#202020" : "#f5f5f5";
}

function clonePenPreset(preset) {
  return {
    color: preset.color,
    width: preset.width,
    type: preset.type
  };
}

function normalizePenPreset(value, fallbackPreset) {
  const fallback = fallbackPreset || DEFAULT_PEN_PRESETS[0];

  if (typeof value === "string") {
    const color = normalizeHexColor(value) || fallback.color;
    return {
      color,
      width: fallback.width,
      type: fallback.type
    };
  }

  if (!value || typeof value !== "object") {
    return clonePenPreset(fallback);
  }

  const color = normalizeHexColor(value.color) || fallback.color;
  const width = normalizeLineWidth(value.width ?? fallback.width);
  const type = (typeof value.type === "string" && value.type.trim())
    ? value.type.trim()
    : fallback.type;

  return { color, width, type };
}

function loadColorPresets(storageKey, defaults) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [...defaults];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== defaults.length) {
      return [...defaults];
    }

    const normalized = parsed.map(normalizeHexColor);
    if (normalized.some((color) => color === "")) {
      return [...defaults];
    }

    return normalized;
  } catch (error) {
    return [...defaults];
  }
}

function saveColorPresets(storageKey, colors) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(colors));
  } catch (error) {
    // localStorage unavailable: skip persistence.
  }
}

function loadPenPresets(storageKey, defaults) {
  const fallback = defaults.map(clonePenPreset);

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return fallback;
    }

    const normalized = defaults.map((defaultPreset, index) => {
      return normalizePenPreset(parsed[index], defaultPreset);
    });

    return normalized;
  } catch (error) {
    return fallback;
  }
}

function savePenPresets(storageKey, presets) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(presets));
  } catch (error) {
    // localStorage unavailable: skip persistence.
  }
}

function loadStoredColor(storageKey, fallbackColor) {
  const normalizedFallback = normalizeHexColor(fallbackColor);
  try {
    const raw = window.localStorage.getItem(storageKey);
    const normalized = normalizeHexColor(raw);
    return normalized || normalizedFallback;
  } catch (error) {
    return normalizedFallback;
  }
}

function saveStoredColor(storageKey, color) {
  const normalized = normalizeHexColor(color);
  if (!normalized) {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, normalized);
  } catch (error) {
    // localStorage unavailable: skip persistence.
  }
}

function loadStoredLineWidth(storageKey, fallbackWidth) {
  const normalizedFallback = normalizeLineWidth(fallbackWidth);
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return normalizedFallback;
    }
    return normalizeLineWidth(parsed);
  } catch (error) {
    return normalizedFallback;
  }
}

function saveStoredLineWidth(storageKey, width) {
  const normalized = normalizeLineWidth(width);
  try {
    window.localStorage.setItem(storageKey, String(normalized));
  } catch (error) {
    // localStorage unavailable: skip persistence.
  }
}

function loadStoredEraserWidth(storageKey, fallbackWidth) {
  const normalizedFallback = normalizeEraserWidth(fallbackWidth);
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return normalizedFallback;
    }
    return normalizeEraserWidth(parsed);
  } catch (error) {
    return normalizedFallback;
  }
}

function saveStoredEraserWidth(storageKey, width) {
  const normalized = normalizeEraserWidth(width);
  try {
    window.localStorage.setItem(storageKey, String(normalized));
  } catch (error) {
    // localStorage unavailable: skip persistence.
  }
}

function loadStoredEraserMode(storageKey, fallbackMode) {
  const normalizedFallback = normalizeEraserMode(fallbackMode);
  try {
    const raw = window.localStorage.getItem(storageKey);
    return normalizeEraserMode(raw, normalizedFallback);
  } catch (error) {
    return normalizedFallback;
  }
}

function saveStoredEraserMode(storageKey, mode) {
  const normalized = normalizeEraserMode(mode);
  try {
    window.localStorage.setItem(storageKey, normalized);
  } catch (error) {
    // localStorage unavailable: skip persistence.
  }
}

function getCurrentPenPresetSnapshot() {
  return {
    color: normalizeHexColor(penColorInput.value) || DEFAULT_PEN_PRESETS[0].color,
    width: normalizeLineWidth(lineWidthInput.value),
    type: currentPenType
  };
}

function isSamePenPreset(a, b) {
  if (!a || !b) {
    return false;
  }

  return a.color === b.color
    && Number(a.width) === Number(b.width)
    && String(a.type) === String(b.type);
}

function updatePenPresetSelection() {
  if (!penPresetsContainer) {
    return;
  }

  const current = getCurrentPenPresetSnapshot();
  const buttons = penPresetsContainer.querySelectorAll(".pen-preset");

  buttons.forEach((button, index) => {
    button.classList.toggle("is-active", isSamePenPreset(penPresets[index], current));
  });
}

function updateBoardPresetSelection() {
  if (!boardPresetsContainer) {
    return;
  }

  const currentColor = normalizeHexColor(boardColorInput.value);
  const buttons = boardPresetsContainer.querySelectorAll(".color-preset");

  buttons.forEach((button, index) => {
    button.classList.toggle("is-active", boardPresetColors[index] === currentColor);
  });
}

function applyPenColor(color, persist = true) {
  const normalized = normalizeHexColor(color);
  if (!normalized) {
    return;
  }

  penColorInput.value = normalized;
  if (persist) {
    saveStoredColor(LAST_PEN_COLOR_STORAGE_KEY, normalized);
  }
  updatePenPresetSelection();
}

function applyPenWidth(width, persist = true) {
  const normalized = normalizeLineWidth(width);
  lineWidthInput.value = String(normalized);
  if (persist) {
    saveStoredLineWidth(LAST_PEN_WIDTH_STORAGE_KEY, normalized);
  }
  updatePenPresetSelection();
}

function stepPenWidth(delta) {
  const current = normalizeLineWidth(lineWidthInput.value);
  applyPenWidth(current + delta, true);
}

function applyEraserWidth(width, persist = true) {
  const normalized = normalizeEraserWidth(width);
  eraserWidthInput.value = String(normalized);
  if (persist) {
    saveStoredEraserWidth(LAST_ERASER_WIDTH_STORAGE_KEY, normalized);
  }
}

function stepEraserWidth(delta) {
  const current = normalizeEraserWidth(eraserWidthInput.value);
  applyEraserWidth(current + delta, true);
}

function applyEraserMode(mode, persist = true) {
  eraserMode = normalizeEraserMode(mode, eraserMode);
  if (persist) {
    saveStoredEraserMode(LAST_ERASER_MODE_STORAGE_KEY, eraserMode);
  }
}

function applyBoardColor(color, persist = true) {
  const normalized = normalizeHexColor(color);
  if (!normalized) {
    return;
  }

  boardColorInput.value = normalized;
  setBoardColor(normalized);
  renderBoardBackground();
  updateBoardColorTriggerPreview(normalized);
  if (persist) {
    saveStoredColor(LAST_BOARD_COLOR_STORAGE_KEY, normalized);
  }
  updateBoardPresetSelection();
}

function applyPenPreset(preset, persist = true) {
  const normalized = normalizePenPreset(preset, DEFAULT_PEN_PRESETS[0]);
  currentPenType = normalized.type;
  applyPenColor(normalized.color, persist);
  applyPenWidth(normalized.width, persist);
  updatePenPresetSelection();
}

function saveCurrentPenPreset(index) {
  if (index < 0 || index >= penPresets.length) {
    return;
  }

  penPresets[index] = getCurrentPenPresetSnapshot();
  savePenPresets(PEN_PRESET_STORAGE_KEY, penPresets);
  renderPenPresets();
}

function saveCurrentBoardColorToPreset(index) {
  if (index < 0 || index >= boardPresetColors.length) {
    return;
  }

  const currentColor = normalizeHexColor(boardColorInput.value);
  if (!currentColor) {
    return;
  }

  boardPresetColors[index] = currentColor;
  saveColorPresets(BOARD_PRESET_STORAGE_KEY, boardPresetColors);
  renderBoardPresets();
}

function renderPenPresets() {
  if (!penPresetsContainer) {
    return;
  }

  penPresetsContainer.innerHTML = "";

  penPresets.forEach((preset, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "color-preset pen-preset";
    button.style.backgroundColor = preset.color;
    button.style.setProperty("--pen-line-size", `${Math.max(2, Math.min(12, preset.width))}px`);
    button.style.setProperty("--pen-line-color", getContrastColor(preset.color));
    button.setAttribute("aria-label", `pen preset ${index + 1}`);
    button.title = `Click: apply (${preset.color}, ${preset.width}px) | Right-click/Shift+Click: save current`;

    button.addEventListener("click", (event) => {
      if (event.shiftKey) {
        saveCurrentPenPreset(index);
        return;
      }
      applyPenPreset(preset, true);
    });

    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      saveCurrentPenPreset(index);
    });

    penPresetsContainer.appendChild(button);
  });

  updatePenPresetSelection();
}

function renderBoardPresets() {
  if (!boardPresetsContainer) {
    return;
  }

  boardPresetsContainer.innerHTML = "";

  boardPresetColors.forEach((color, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "color-preset";
    button.style.backgroundColor = color;
    button.setAttribute("aria-label", `board preset ${index + 1}`);
    button.title = "Click: apply | Right-click/Shift+Click: save current";

    button.addEventListener("click", (event) => {
      if (event.shiftKey) {
        saveCurrentBoardColorToPreset(index);
        return;
      }
      applyBoardColor(color, true);
    });

    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      saveCurrentBoardColorToPreset(index);
    });

    boardPresetsContainer.appendChild(button);
  });

  updateBoardPresetSelection();
}

function initPresets() {
  penPresets = loadPenPresets(PEN_PRESET_STORAGE_KEY, DEFAULT_PEN_PRESETS);
  boardPresetColors = loadColorPresets(BOARD_PRESET_STORAGE_KEY, DEFAULT_BOARD_PRESETS);

  // Persist normalized model to migrate old string-only pen presets.
  savePenPresets(PEN_PRESET_STORAGE_KEY, penPresets);

  renderPenPresets();
  renderBoardPresets();
}

function initLastUsedSettings() {
  const initialPenColor = loadStoredColor(LAST_PEN_COLOR_STORAGE_KEY, penColorInput.value);
  const initialPenWidth = loadStoredLineWidth(LAST_PEN_WIDTH_STORAGE_KEY, lineWidthInput.value);
  const initialEraserWidth = loadStoredEraserWidth(LAST_ERASER_WIDTH_STORAGE_KEY, eraserWidthInput.value);
  const initialEraserMode = loadStoredEraserMode(LAST_ERASER_MODE_STORAGE_KEY, eraserMode);
  const initialBoardColor = loadStoredColor(LAST_BOARD_COLOR_STORAGE_KEY, boardColorInput.value);

  applyPenColor(initialPenColor, false);
  applyPenWidth(initialPenWidth, false);
  applyEraserWidth(initialEraserWidth, false);
  applyEraserMode(initialEraserMode, false);
  applyBoardColor(initialBoardColor, false);
}

function clonePoint(point) {
  return { x: point.x, y: point.y };
}

function cloneStroke(stroke) {
  return {
    ...stroke,
    points: Array.isArray(stroke.points) ? stroke.points.map(clonePoint) : []
  };
}

function cloneStrokeCollection(collection) {
  if (!Array.isArray(collection) || collection.length === 0) {
    return [];
  }

  return collection
    .filter((stroke) => stroke && Array.isArray(stroke.points) && stroke.points.length > 0)
    .map(cloneStroke);
}

function normalizeStrokeCollection(collection) {
  if (!Array.isArray(collection) || collection.length <= 0) {
    return [];
  }

  const normalized = [];
  for (const sourceStroke of collection) {
    if (!sourceStroke || !Array.isArray(sourceStroke.points)) {
      continue;
    }

    const points = [];
    for (const sourcePoint of sourceStroke.points) {
      const x = Number(sourcePoint && sourcePoint.x);
      const y = Number(sourcePoint && sourcePoint.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        continue;
      }

      points.push({ x, y });
    }

    if (points.length <= 0) {
      continue;
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const point of points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }

    normalized.push({
      kind: sourceStroke.kind === "pixel-eraser" ? "pixel-eraser" : "pen",
      color: normalizeHexColor(sourceStroke.color) || "#111111",
      widthPx: Math.max(1, Number(sourceStroke.widthPx) || 1),
      points,
      minX,
      minY,
      maxX,
      maxY
    });
  }

  return normalized;
}

function saveUndoSnapshotForCurrentContext() {
  const entry = getOrCreateStrokeHistoryEntry();
  pushStrokeSnapshot(entry.undo, cloneStrokeCollection(strokes));
  entry.redo.length = 0;
  updateUndoRedoUI();
}

function captureUndoForStrokeMutation() {
  if (strokeEraserActive) {
    if (!strokeEraserHistoryArmed) {
      return;
    }
    strokeEraserHistoryArmed = false;
  }

  saveUndoSnapshotForCurrentContext();
}

function finalizeStrokeMutation() {
  saveCurrentStrokeState();
  scheduleSessionAutosave();
  updateUndoRedoUI();
}

function undoStrokeAction() {
  if (pdfExportInProgress || drawing || strokeEraserActive || sessionRestoreInProgress) {
    return false;
  }

  const entry = getOrCreateStrokeHistoryEntry();
  if (entry.undo.length <= 0) {
    updateUndoRedoUI();
    return false;
  }

  pushStrokeSnapshot(entry.redo, cloneStrokeCollection(strokes));
  const previousSnapshot = entry.undo.pop();
  replaceVisibleStrokes(previousSnapshot);
  saveCurrentStrokeState();
  scheduleSessionAutosave();
  updateUndoRedoUI();
  return true;
}

function redoStrokeAction() {
  if (pdfExportInProgress || drawing || strokeEraserActive || sessionRestoreInProgress) {
    return false;
  }

  const entry = getOrCreateStrokeHistoryEntry();
  if (entry.redo.length <= 0) {
    updateUndoRedoUI();
    return false;
  }

  pushStrokeSnapshot(entry.undo, cloneStrokeCollection(strokes));
  const nextSnapshot = entry.redo.pop();
  replaceVisibleStrokes(nextSnapshot);
  saveCurrentStrokeState();
  scheduleSessionAutosave();
  updateUndoRedoUI();
  return true;
}

function replaceVisibleStrokes(collection) {
  strokes.length = 0;
  const nextStrokes = cloneStrokeCollection(collection);
  if (nextStrokes.length > 0) {
    strokes.push(...nextStrokes);
  }
  redrawAllStrokes();
}

function savePdfPageStrokeSnapshot(pageNumber) {
  const numericPage = Math.round(Number(pageNumber));
  if (!Number.isFinite(numericPage) || numericPage < 1) {
    return;
  }

  const snapshot = cloneStrokeCollection(strokes);
  if (snapshot.length === 0) {
    pdfPageStrokeSnapshots.delete(numericPage);
    return;
  }

  pdfPageStrokeSnapshots.set(numericPage, snapshot);
}

function saveCurrentStrokeState() {
  if (hasLoadedPdfDocument()) {
    savePdfPageStrokeSnapshot(pdfPageNumber);
    return;
  }

  boardStrokeSnapshot = cloneStrokeCollection(strokes);
}

function restoreCurrentStrokeState() {
  if (hasLoadedPdfDocument()) {
    const numericPage = Math.round(Number(pdfPageNumber));
    const snapshot = Number.isFinite(numericPage) && numericPage >= 1
      ? (pdfPageStrokeSnapshots.get(numericPage) || [])
      : [];
    replaceVisibleStrokes(snapshot);
    return;
  }

  replaceVisibleStrokes(boardStrokeSnapshot);
}

function createStrokeRecord(kind, startPoint) {
  const point = clonePoint(startPoint);
  const sourceWidth = kind === "pixel-eraser"
    ? Number(eraserWidthInput.value)
    : Number(lineWidthInput.value);
  const widthPx = Math.max(1, sourceWidth * pixelRatio);

  return {
    kind,
    color: penColorInput.value,
    widthPx,
    points: [point],
    minX: point.x,
    minY: point.y,
    maxX: point.x,
    maxY: point.y
  };
}

function appendPointToStroke(stroke, point) {
  const next = clonePoint(point);
  stroke.points.push(next);
  stroke.minX = Math.min(stroke.minX, next.x);
  stroke.minY = Math.min(stroke.minY, next.y);
  stroke.maxX = Math.max(stroke.maxX, next.x);
  stroke.maxY = Math.max(stroke.maxY, next.y);
}

function drawStrokePath(stroke, targetContext = ctx) {
  if (!stroke || !Array.isArray(stroke.points) || stroke.points.length === 0) {
    return;
  }

  const isPixelEraser = stroke.kind === "pixel-eraser";
  targetContext.lineJoin = "round";
  targetContext.lineCap = "round";
  targetContext.globalCompositeOperation = isPixelEraser ? "destination-out" : "source-over";
  targetContext.strokeStyle = isPixelEraser ? "rgba(0, 0, 0, 1)" : stroke.color;
  targetContext.fillStyle = isPixelEraser ? "rgba(0, 0, 0, 1)" : stroke.color;
  targetContext.lineWidth = Math.max(1, Number(stroke.widthPx));

  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    targetContext.beginPath();
    targetContext.arc(point.x, point.y, targetContext.lineWidth / 2, 0, Math.PI * 2);
    targetContext.fill();
    return;
  }

  const points = stroke.points;
  let previous = points[0];
  let previousMidpoint = previous;

  targetContext.beginPath();
  targetContext.moveTo(previousMidpoint.x, previousMidpoint.y);

  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    const midpoint = getMidpoint(previous, current);
    targetContext.quadraticCurveTo(previous.x, previous.y, midpoint.x, midpoint.y);
    previous = current;
    previousMidpoint = midpoint;
  }

  targetContext.stroke();
}

function redrawAllStrokes() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (const stroke of strokes) {
    drawStrokePath(stroke);
  }
}

function scaleStrokeCollection(collection, scaleX, scaleY) {
  if (!Array.isArray(collection) || collection.length === 0) {
    return;
  }

  const widthScale = (scaleX + scaleY) / 2;

  for (const stroke of collection) {
    if (!stroke.points.length) {
      continue;
    }

    stroke.minX = Number.POSITIVE_INFINITY;
    stroke.minY = Number.POSITIVE_INFINITY;
    stroke.maxX = Number.NEGATIVE_INFINITY;
    stroke.maxY = Number.NEGATIVE_INFINITY;

    for (const point of stroke.points) {
      point.x *= scaleX;
      point.y *= scaleY;
      stroke.minX = Math.min(stroke.minX, point.x);
      stroke.minY = Math.min(stroke.minY, point.y);
      stroke.maxX = Math.max(stroke.maxX, point.x);
      stroke.maxY = Math.max(stroke.maxY, point.y);
    }

    stroke.widthPx = Math.max(1, stroke.widthPx * widthScale);
  }
}

function scaleStoredStrokes(scaleX, scaleY) {
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) {
    return;
  }

  scaleStrokeCollection(strokes, scaleX, scaleY);
  scaleStrokeCollection(boardStrokeSnapshot, scaleX, scaleY);

  for (const snapshot of pdfPageStrokeSnapshots.values()) {
    scaleStrokeCollection(snapshot, scaleX, scaleY);
  }
}

function distancePointToSegment(point, a, b) {
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const apX = point.x - a.x;
  const apY = point.y - a.y;
  const lengthSq = (abX * abX) + (abY * abY);

  if (lengthSq <= 0.0001) {
    return Math.hypot(apX, apY);
  }

  const t = Math.max(0, Math.min(1, ((apX * abX) + (apY * abY)) / lengthSq));
  const nearestX = a.x + (abX * t);
  const nearestY = a.y + (abY * t);
  return Math.hypot(point.x - nearestX, point.y - nearestY);
}

function isPointNearStroke(point, stroke, radius) {
  const points = stroke.points;
  if (!points.length) {
    return false;
  }

  if (points.length === 1) {
    return Math.hypot(point.x - points[0].x, point.y - points[0].y) <= radius;
  }

  for (let index = 1; index < points.length; index += 1) {
    if (distancePointToSegment(point, points[index - 1], points[index]) <= radius) {
      return true;
    }
  }

  return false;
}

function getStrokeEraserRadius() {
  return Math.max(4 * pixelRatio, (Number(eraserWidthInput.value) * pixelRatio) / 2);
}

function findTopPenStrokeIndexAtPoint(point, skipped = null) {
  const eraserRadius = getStrokeEraserRadius();

  for (let index = strokes.length - 1; index >= 0; index -= 1) {
    if (skipped && skipped.has(index)) {
      continue;
    }

    const stroke = strokes[index];
    if (stroke.kind !== "pen") {
      continue;
    }

    const radius = (stroke.widthPx / 2) + eraserRadius;
    if (
      point.x < (stroke.minX - radius)
      || point.x > (stroke.maxX + radius)
      || point.y < (stroke.minY - radius)
      || point.y > (stroke.maxY + radius)
    ) {
      continue;
    }

    if (isPointNearStroke(point, stroke, radius)) {
      return index;
    }
  }

  return -1;
}

function eraseTopStrokeAtPoint(point) {
  const index = findTopPenStrokeIndexAtPoint(point);
  if (index < 0) {
    return false;
  }

  captureUndoForStrokeMutation();
  strokes.splice(index, 1);
  redrawAllStrokes();
  finalizeStrokeMutation();
  return true;
}

function eraseStrokesAlongSegment(startPoint, endPoint) {
  const distance = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y);
  const stepSize = Math.max(getStrokeEraserRadius() * 0.7, 1);
  const steps = Math.max(1, Math.ceil(distance / stepSize));
  const removedIndexes = new Set();

  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const probe = {
      x: startPoint.x + ((endPoint.x - startPoint.x) * t),
      y: startPoint.y + ((endPoint.y - startPoint.y) * t)
    };
    const hitIndex = findTopPenStrokeIndexAtPoint(probe, removedIndexes);
    if (hitIndex >= 0) {
      removedIndexes.add(hitIndex);
    }
  }

  if (removedIndexes.size === 0) {
    return false;
  }

  captureUndoForStrokeMutation();
  const sortedIndexes = Array.from(removedIndexes).sort((a, b) => b - a);
  for (const index of sortedIndexes) {
    strokes.splice(index, 1);
  }

  redrawAllStrokes();
  finalizeStrokeMutation();
  return true;
}

function startStrokeErasing(event) {
  strokeEraserActive = true;
  strokeEraserHistoryArmed = true;
  strokeEraserPointerId = event.pointerId;
  strokeEraserLastPoint = getCanvasPoint(event);
  eraseTopStrokeAtPoint(strokeEraserLastPoint);
  canvas.setPointerCapture(event.pointerId);
  updateUndoRedoUI();
}

function continueStrokeErasing(event) {
  if (!strokeEraserActive || event.pointerId !== strokeEraserPointerId) {
    return;
  }

  const point = getCanvasPoint(event);
  eraseStrokesAlongSegment(strokeEraserLastPoint, point);
  strokeEraserLastPoint = point;
}

function stopStrokeErasing(event) {
  if (!strokeEraserActive || event.pointerId !== strokeEraserPointerId) {
    return;
  }

  strokeEraserActive = false;
  strokeEraserHistoryArmed = false;
  strokeEraserPointerId = null;
  strokeEraserLastPoint = null;

  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }

  updateUndoRedoUI();
}

function updateToolUI() {
  penToolButton.classList.toggle("is-active", tool === "pen");
  const eraserSelected = tool === "eraser" || tool === "strokeEraser";
  eraserToolButton.classList.toggle("is-active", eraserSelected);
  pixelEraserModeButton.classList.toggle("is-active", eraserMode === "eraser");
  strokeEraserModeButton.classList.toggle("is-active", eraserMode === "strokeEraser");
  const modeText = tool === "pen"
    ? "Pen"
    : (tool === "eraser" ? "Eraser" : "StrokeEraser");
  modeLabel.textContent = `Mode: ${modeText}${qualityLevel === "low" ? " | LowSpec" : ""}`;
  canvas.style.cursor = tool === "pen" ? "crosshair" : "cell";
}

function renderBoardBackground() {
  if (backgroundCanvas.width <= 0 || backgroundCanvas.height <= 0) {
    return;
  }

  backgroundCtx.setTransform(1, 0, 0, 1, 0, 0);
  backgroundCtx.clearRect(0, 0, backgroundCanvas.width, backgroundCanvas.height);
  if (overlayMode) {
    return;
  }

  backgroundCtx.fillStyle = normalizeHexColor(boardColorInput.value) || "#ffffff";
  backgroundCtx.fillRect(0, 0, backgroundCanvas.width, backgroundCanvas.height);

  if (!pdfPageRasterCanvas || pdfPageRasterCanvas.width <= 0 || pdfPageRasterCanvas.height <= 0) {
    return;
  }

  const fitScale = Math.min(
    backgroundCanvas.width / pdfPageRasterCanvas.width,
    backgroundCanvas.height / pdfPageRasterCanvas.height
  );
  const drawWidth = Math.max(1, Math.floor(pdfPageRasterCanvas.width * fitScale));
  const drawHeight = Math.max(1, Math.floor(pdfPageRasterCanvas.height * fitScale));
  const drawX = Math.floor((backgroundCanvas.width - drawWidth) / 2);
  const drawY = Math.floor((backgroundCanvas.height - drawHeight) / 2);

  backgroundCtx.imageSmoothingEnabled = true;
  backgroundCtx.imageSmoothingQuality = "high";
  backgroundCtx.drawImage(
    pdfPageRasterCanvas,
    0,
    0,
    pdfPageRasterCanvas.width,
    pdfPageRasterCanvas.height,
    drawX,
    drawY,
    drawWidth,
    drawHeight
  );
}

async function releasePdfDocument(documentRef) {
  if (!documentRef || typeof documentRef.destroy !== "function") {
    return;
  }

  try {
    await documentRef.destroy();
  } catch (error) {
    // Ignore destroy errors.
  }
}

async function unloadPdfDocument(updateStatus = true) {
  if (pdfExportInProgress) {
    return;
  }

  saveCurrentStrokeState();
  clearPdfRenderDebounce();
  stopPdfRenderTask();
  pdfRenderToken += 1;
  pdfLoadingToken += 1;

  const previousDocument = pdfDocument;
  pdfDocument = null;
  pdfPageNumber = 1;
  pdfPageRasterCanvas = null;
  loadedDocumentName = "";
  loadedPdfBytes = null;
  sessionPdfBytesDirty = false;
  pdfPageStrokeSnapshots.clear();

  restoreCurrentStrokeState();
  clearAllStrokeHistory();
  renderBoardBackground();
  updatePdfNavigationUI();
  scheduleSessionAutosave();

  if (updateStatus) {
    setDocumentStatus("No document");
  }

  await releasePdfDocument(previousDocument);
}

async function renderPdfPage(pageNumber) {
  if (!hasLoadedPdfDocument()) {
    pdfPageRasterCanvas = null;
    renderBoardBackground();
    updatePdfNavigationUI();
    return;
  }

  clearPdfRenderDebounce();
  stopPdfRenderTask();

  const clampedPage = Math.min(
    Number(pdfDocument.numPages),
    Math.max(1, Math.round(Number(pageNumber) || 1))
  );
  const pageChanged = clampedPage !== pdfPageNumber;
  if (clampedPage !== pdfPageNumber) {
    savePdfPageStrokeSnapshot(pdfPageNumber);
    pdfPageNumber = clampedPage;
    restoreCurrentStrokeState();
  } else {
    pdfPageNumber = clampedPage;
  }
  updatePdfNavigationUI();
  if (pageChanged) {
    scheduleSessionAutosave();
  }

  const token = ++pdfRenderToken;
  const statusName = loadedDocumentName || "PDF";
  setDocumentStatus(`${statusName}: rendering page...`);

  try {
    const page = await pdfDocument.getPage(clampedPage);
    if (token !== pdfRenderToken || !hasLoadedPdfDocument()) {
      return;
    }

    const baseViewport = page.getViewport({ scale: 1 });
    const maxWidth = Math.max(1, backgroundCanvas.width);
    const maxHeight = Math.max(1, backgroundCanvas.height);
    const fitScale = Math.min(maxWidth / baseViewport.width, maxHeight / baseViewport.height);
    const viewport = page.getViewport({ scale: fitScale });

    const rasterCanvas = document.createElement("canvas");
    rasterCanvas.width = Math.max(1, Math.floor(viewport.width));
    rasterCanvas.height = Math.max(1, Math.floor(viewport.height));

    const rasterContext = rasterCanvas.getContext("2d", { alpha: false });
    if (!rasterContext) {
      setDocumentStatus("Could not create a PDF rendering context.", "error");
      return;
    }
    rasterContext.imageSmoothingEnabled = true;
    rasterContext.imageSmoothingQuality = "high";

    pdfRenderTask = page.render({
      canvasContext: rasterContext,
      viewport
    });
    await pdfRenderTask.promise;

    if (token !== pdfRenderToken || !hasLoadedPdfDocument()) {
      return;
    }

    pdfPageRasterCanvas = rasterCanvas;
    renderBoardBackground();
    updatePdfNavigationUI();
    setDocumentStatus(`${statusName} (${pdfPageNumber}/${pdfDocument.numPages})`, "success");
  } catch (error) {
    if (error && error.name === "RenderingCancelledException") {
      return;
    }

    setDocumentStatus("Failed to render PDF page.", "error");
  } finally {
    if (token === pdfRenderToken) {
      pdfRenderTask = null;
    }
  }
}

async function exportAnnotatedPdf() {
  if (pdfExportInProgress) {
    return;
  }

  if (!hasLoadedPdfDocument()) {
    setDocumentStatus("Load a PDF first.", "warning");
    return;
  }

  if (!window.PDFLib || !window.PDFLib.PDFDocument) {
    setDocumentStatus("PDF export engine is unavailable. Refresh and try again.", "error");
    return;
  }

  saveCurrentStrokeState();
  pdfExportInProgress = true;
  updatePdfNavigationUI();

  const statusName = loadedDocumentName || "PDF";
  const totalPages = Math.max(1, Number(pdfDocument.numPages) || 1);
  const outputFileName = getAnnotatedPdfFileName();

  try {
    const exportWidth = Math.max(1, Math.floor(backgroundCanvas.width));
    const exportHeight = Math.max(1, Math.floor(backgroundCanvas.height));
    const boardColor = normalizeHexColor(boardColorInput.value) || "#ffffff";
    const outputPdf = await window.PDFLib.PDFDocument.create();

    const mergedCanvas = document.createElement("canvas");
    mergedCanvas.width = exportWidth;
    mergedCanvas.height = exportHeight;
    const mergedContext = mergedCanvas.getContext("2d", { alpha: false });
    if (!mergedContext) {
      throw new Error("Could not create output context.");
    }

    const annotationCanvas = document.createElement("canvas");
    annotationCanvas.width = exportWidth;
    annotationCanvas.height = exportHeight;
    const annotationContext = annotationCanvas.getContext("2d", { alpha: true });
    if (!annotationContext) {
      throw new Error("Could not create annotation context.");
    }

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      setDocumentStatus(`${statusName}: exporting ${pageNumber}/${totalPages}...`);

      mergedContext.setTransform(1, 0, 0, 1, 0, 0);
      mergedContext.globalCompositeOperation = "source-over";
      mergedContext.clearRect(0, 0, exportWidth, exportHeight);
      mergedContext.fillStyle = boardColor;
      mergedContext.fillRect(0, 0, exportWidth, exportHeight);

      await drawPdfPageToContext(pageNumber, mergedContext, exportWidth, exportHeight);

      annotationContext.setTransform(1, 0, 0, 1, 0, 0);
      annotationContext.globalCompositeOperation = "source-over";
      annotationContext.clearRect(0, 0, exportWidth, exportHeight);
      annotationContext.lineJoin = "round";
      annotationContext.lineCap = "round";

      const pageStrokes = pdfPageStrokeSnapshots.get(pageNumber) || [];
      for (const stroke of pageStrokes) {
        drawStrokePath(stroke, annotationContext);
      }

      annotationContext.globalCompositeOperation = "source-over";
      mergedContext.drawImage(annotationCanvas, 0, 0);

      const pageImageBytes = await canvasToJpegBytes(mergedCanvas);
      const embeddedImage = await outputPdf.embedJpg(pageImageBytes);
      const outputPage = outputPdf.addPage([exportWidth, exportHeight]);
      outputPage.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width: exportWidth,
        height: exportHeight
      });
    }

    const outputBytes = await outputPdf.save();
    const outputBlob = new Blob([outputBytes], { type: "application/pdf" });
    downloadBlobFile(outputBlob, outputFileName);
    setDocumentStatus(`${outputFileName} saved.`, "success");
  } catch (error) {
    setDocumentStatus("Failed to save annotated PDF.", "error");
  } finally {
    pdfExportInProgress = false;
    updatePdfNavigationUI();
  }
}

function schedulePdfPageRerender() {
  if (!hasLoadedPdfDocument()) {
    return;
  }

  clearPdfRenderDebounce();
  pdfRenderDebounceTimer = window.setTimeout(() => {
    pdfRenderDebounceTimer = null;
    renderPdfPage(pdfPageNumber);
  }, 120);
}

async function loadPdfFromFile(file) {
  if (pdfExportInProgress) {
    setDocumentStatus("Wait until export finishes.", "warning");
    return;
  }

  if (!configurePdfWorker()) {
    return;
  }

  const token = ++pdfLoadingToken;
  const fileName = file.name || "PDF";
  setDocumentStatus(`${fileName}: loading...`);

  try {
    const source = await file.arrayBuffer();
    if (token !== pdfLoadingToken) {
      return;
    }

    let nextDocument = null;
    let usedCompatibilityMode = false;
    const sourceBytes = new Uint8Array(source);
    let lastLoadError = null;

    const loadAttempts = [
      {},
      { disableWorker: true },
      { disableWorker: true, useWorkerFetch: false, isEvalSupported: false }
    ];

    for (let index = 0; index < loadAttempts.length; index += 1) {
      try {
        // pdf.js may detach transferred buffers, so each attempt gets a fresh copy.
        const loadingTask = window.pdfjsLib.getDocument({
          ...loadAttempts[index],
          data: sourceBytes.slice()
        });
        nextDocument = await loadingTask.promise;
        usedCompatibilityMode = index > 0;
        break;
      } catch (attemptError) {
        lastLoadError = attemptError;
      }
    }

    if (!nextDocument) {
      throw lastLoadError || new Error("PDF load failed.");
    }

    if (token !== pdfLoadingToken) {
      await releasePdfDocument(nextDocument);
      return;
    }

    saveCurrentStrokeState();
    const previousDocument = pdfDocument;
    clearPdfRenderDebounce();
    stopPdfRenderTask();

    pdfPageStrokeSnapshots.clear();
    pdfDocument = nextDocument;
    pdfPageNumber = 1;
    pdfPageRasterCanvas = null;
    loadedDocumentName = fileName;
    loadedPdfBytes = sourceBytes.slice();
    sessionPdfBytesDirty = true;
    restoreCurrentStrokeState();

    await renderPdfPage(1);
    if (usedCompatibilityMode) {
      setDocumentStatus(`${fileName}: loaded (compatibility mode).`, "warning");
    }
    if (pdfPageRasterCanvas) {
      closeDocumentPopup();
    }
    await releasePdfDocument(previousDocument);
    clearAllStrokeHistory();
    scheduleSessionAutosave();
  } catch (error) {
    if (token !== pdfLoadingToken) {
      return;
    }

    const reason = error && typeof error.message === "string"
      ? error.message.trim()
      : "";
    if (reason && /password/i.test(reason)) {
      setDocumentStatus("Password-protected PDF is not supported.", "warning");
    } else {
      const detail = reason ? ` (${reason.slice(0, 80)})` : "";
      setDocumentStatus(`Unable to open this PDF file. Try another file.${detail}`, "error");
    }
  } finally {
    updatePdfNavigationUI();
  }
}

async function handleDocumentInputChange(event) {
  if (pdfExportInProgress) {
    setDocumentStatus("Wait until export finishes.", "warning");
    event.target.value = "";
    return;
  }

  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) {
    return;
  }

  if (isPdfFile(file)) {
    await loadPdfFromFile(file);
    return;
  }

  if (isPptFile(file)) {
    setDocumentStatus("PPT/PPTX cannot be rendered directly. Convert to PDF and load again.", "warning");
    return;
  }

  setDocumentStatus("Unsupported file type. Choose PDF or PPT/PPTX.", "error");
}

function goToPreviousPdfPage() {
  if (pdfExportInProgress || sessionRestoreInProgress || !hasLoadedPdfDocument() || pdfPageNumber <= 1) {
    return;
  }

  renderPdfPage(pdfPageNumber - 1);
}

function goToNextPdfPage() {
  if (pdfExportInProgress || sessionRestoreInProgress || !hasLoadedPdfDocument() || pdfPageNumber >= Number(pdfDocument.numPages)) {
    return;
  }

  renderPdfPage(pdfPageNumber + 1);
}

function requestDocumentFileSelection() {
  if (pdfExportInProgress || sessionRestoreInProgress) {
    return;
  }

  if (!configurePdfWorker()) {
    return;
  }

  documentInput.value = "";

  try {
    documentInput.click();
    return;
  } catch (error) {
    // Fallback for runtimes that block synthetic click.
  }

  if (typeof documentInput.showPicker === "function") {
    try {
      documentInput.showPicker();
      return;
    } catch (error) {
      // ignore and surface unified error below.
    }
  }

  setDocumentStatus("Unable to open file picker. Try again.", "error");
}

function isEditableEventTarget(target) {
  if (!target) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = String(target.tagName || "").toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

function setCanvasSize() {
  const rect = canvas.getBoundingClientRect();
  const previousWidth = canvas.width;
  const previousHeight = canvas.height;
  const previousBackgroundWidth = backgroundCanvas.width;
  const previousBackgroundHeight = backgroundCanvas.height;

  pixelRatio = Math.min(quality.dprCap, Math.max(1, window.devicePixelRatio || 1));
  const nextWidth = Math.max(1, Math.floor(rect.width * pixelRatio));
  const nextHeight = Math.max(1, Math.floor(rect.height * pixelRatio));

  if (
    nextWidth === previousWidth
    && nextHeight === previousHeight
    && nextWidth === previousBackgroundWidth
    && nextHeight === previousBackgroundHeight
  ) {
    return;
  }

  backgroundCanvas.width = nextWidth;
  backgroundCanvas.height = nextHeight;
  canvas.width = nextWidth;
  canvas.height = nextHeight;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (previousWidth > 0 && previousHeight > 0) {
    scaleStoredStrokes(nextWidth / previousWidth, nextHeight / previousHeight);
    redrawAllStrokes();
    scheduleSessionAutosave();
  }

  renderBoardBackground();
  schedulePdfPageRerender();
}

function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY
  };
}

function getMidpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2
  };
}

function applyCurrentBrush() {
  ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
  ctx.strokeStyle = tool === "eraser" ? "rgba(0, 0, 0, 1)" : penColorInput.value;
  ctx.fillStyle = tool === "eraser" ? "rgba(0, 0, 0, 1)" : penColorInput.value;
  const width = tool === "eraser" ? Number(eraserWidthInput.value) : Number(lineWidthInput.value);
  ctx.lineWidth = Math.max(1, width * pixelRatio);
}

function smoothInputPoint(point, forceFull) {
  if (!filteredPoint || forceFull) {
    filteredPoint = point;
    return point;
  }

  const distance = Math.hypot(point.x - filteredPoint.x, point.y - filteredPoint.y);
  const speedBoost = Math.min(0.25, distance / (24 * pixelRatio));
  const alpha = Math.min(0.72, quality.inputSmoothing + speedBoost);

  filteredPoint = {
    x: filteredPoint.x + ((point.x - filteredPoint.x) * alpha),
    y: filteredPoint.y + ((point.y - filteredPoint.y) * alpha)
  };

  return filteredPoint;
}

function appendSmoothSegment(rawPoint, forceFull = false) {
  if (!lastPoint) {
    lastPoint = smoothInputPoint(rawPoint, forceFull);
    lastMidPoint = lastPoint;
    return false;
  }

  const targetPoint = smoothInputPoint(rawPoint, forceFull);
  const dx = targetPoint.x - lastPoint.x;
  const dy = targetPoint.y - lastPoint.y;
  const distance = Math.hypot(dx, dy);

  if (distance < 0.01) {
    return false;
  }

  if (!forceFull && distance < quality.minSegmentLength * pixelRatio) {
    return false;
  }

  const mid = getMidpoint(lastPoint, targetPoint);
  ctx.quadraticCurveTo(lastPoint.x, lastPoint.y, mid.x, mid.y);
  lastPoint = targetPoint;
  lastMidPoint = mid;
  if (activeStroke) {
    appendPointToStroke(activeStroke, targetPoint);
  }
  return true;
}

function requestDrawFrame() {
  if (frameRequested) {
    return;
  }

  frameRequested = true;
  window.requestAnimationFrame(processDrawFrame);
}

function enqueueEventPoints(event, forceFull) {
  const sourceEvents = typeof event.getCoalescedEvents === "function"
    ? event.getCoalescedEvents()
    : [event];

  for (const sourceEvent of sourceEvents) {
    pendingPoints.push({
      point: getCanvasPoint(sourceEvent),
      forceFull
    });
  }

  const pendingCount = pendingPoints.length - pendingHead;
  if (pendingCount > MAX_QUEUE_POINTS) {
    const overflow = pendingCount - MAX_QUEUE_POINTS;
    pendingHead += overflow;
  }

  requestDrawFrame();
}

function clearPendingPoints() {
  pendingPoints.length = 0;
  pendingHead = 0;
}

function processPendingPoints(maxPoints, frameBudgetMs) {
  if (pendingHead >= pendingPoints.length) {
    clearPendingPoints();
    return false;
  }

  applyCurrentBrush();

  let didStroke = false;
  let processedCount = 0;
  const startedAt = performance.now();

  ctx.beginPath();
  if (lastMidPoint) {
    ctx.moveTo(lastMidPoint.x, lastMidPoint.y);
  } else if (lastPoint) {
    ctx.moveTo(lastPoint.x, lastPoint.y);
  }

  while (pendingHead < pendingPoints.length && processedCount < maxPoints) {
    const item = pendingPoints[pendingHead];
    pendingHead += 1;
    processedCount += 1;

    if (appendSmoothSegment(item.point, item.forceFull)) {
      didStroke = true;
      hasStrokeMoved = true;
    }

    if ((performance.now() - startedAt) >= frameBudgetMs) {
      break;
    }
  }

  if (didStroke) {
    ctx.stroke();
  }

  if (pendingHead >= pendingPoints.length) {
    clearPendingPoints();
  }

  const elapsed = performance.now() - startedAt;
  frameCostAverage = frameCostAverage === 0
    ? elapsed
    : ((frameCostAverage * 0.9) + (elapsed * 0.1));

  return pendingHead < pendingPoints.length;
}

function processDrawFrame() {
  frameRequested = false;

  if (!drawing) {
    clearPendingPoints();
    return;
  }

  const hasMore = processPendingPoints(quality.maxPointsPerFrame, quality.frameBudgetMs);

  if (qualityLevel === "normal" && frameCostAverage > 7.5) {
    qualityLevel = "low";
    quality = QUALITY_PRESETS.low;
    if (!drawing) {
      setCanvasSize();
    } else {
      pendingQualityResize = true;
    }
    updateToolUI();
  }

  if (hasMore) {
    requestDrawFrame();
  }
}

function flushPendingPoints() {
  if (pendingHead >= pendingPoints.length) {
    clearPendingPoints();
    frameRequested = false;
    return;
  }

  processPendingPoints(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  frameRequested = false;
}

function startDrawing(event) {
  const point = getCanvasPoint(event);
  drawing = true;
  hasStrokeMoved = false;
  lastPoint = point;
  lastMidPoint = point;
  filteredPoint = point;
  clearPendingPoints();
  frameRequested = false;
  activeStroke = createStrokeRecord(tool === "eraser" ? "pixel-eraser" : "pen", point);

  applyCurrentBrush();
  canvas.setPointerCapture(event.pointerId);
  updateUndoRedoUI();
}

function draw(event) {
  if (!drawing) {
    return;
  }

  enqueueEventPoints(event, false);
}

function stopDrawing(event) {
  if (!drawing) {
    return;
  }

  if (event.type !== "pointercancel") {
    enqueueEventPoints(event, true);
  }
  flushPendingPoints();

  if (!hasStrokeMoved && lastPoint) {
    applyCurrentBrush();
    const dotWidth = tool === "eraser" ? Number(eraserWidthInput.value) : Number(lineWidthInput.value);
    ctx.beginPath();
    ctx.arc(lastPoint.x, lastPoint.y, Math.max(1, (dotWidth * pixelRatio) / 2), 0, Math.PI * 2);
    ctx.fill();
  }

  if (activeStroke && activeStroke.points.length > 0) {
    saveUndoSnapshotForCurrentContext();
    strokes.push(activeStroke);
    finalizeStrokeMutation();
  }

  drawing = false;
  hasStrokeMoved = false;
  lastPoint = null;
  lastMidPoint = null;
  filteredPoint = null;
  activeStroke = null;
  clearPendingPoints();
  frameRequested = false;

  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }

  if (pendingQualityResize) {
    setCanvasSize();
    pendingQualityResize = false;
  }

  updateUndoRedoUI();
}

function handlePointerDown(event) {
  if (tool === "strokeEraser") {
    startStrokeErasing(event);
    return;
  }

  startDrawing(event);
}

function handlePointerMove(event) {
  if (strokeEraserActive) {
    continueStrokeErasing(event);
    return;
  }

  if (drawing) {
    draw(event);
  }
}

function handlePointerEnd(event) {
  if (strokeEraserActive) {
    stopStrokeErasing(event);
  }

  if (drawing) {
    stopDrawing(event);
  }
}

function clearBoard() {
  if (strokes.length <= 0) {
    return;
  }

  saveUndoSnapshotForCurrentContext();
  strokes.length = 0;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  finalizeStrokeMutation();
}

function setBoardColor(color) {
  canvas.style.backgroundColor = "transparent";
  backgroundCanvas.style.backgroundColor = color;
}

penToolButton.addEventListener("click", () => {
  tool = "pen";
  closeEraserToolPopup();
  updateToolUI();
});

eraserToolButton.addEventListener("click", (event) => {
  event.stopPropagation();
  if (tool === "eraser" || tool === "strokeEraser") {
    setEraserToolPopupOpen(!isEraserToolPopupOpen());
    return;
  }

  tool = eraserMode;
  closeEraserToolPopup();
  updateToolUI();
});

pixelEraserModeButton.addEventListener("click", () => {
  applyEraserMode("eraser", true);
  tool = eraserMode;
  closeEraserToolPopup();
  updateToolUI();
});

strokeEraserModeButton.addEventListener("click", () => {
  applyEraserMode("strokeEraser", true);
  tool = eraserMode;
  closeEraserToolPopup();
  updateToolUI();
});

if (undoButton) {
  undoButton.addEventListener("click", () => {
    undoStrokeAction();
  });
}

if (redoButton) {
  redoButton.addEventListener("click", () => {
    redoStrokeAction();
  });
}

clearButton.addEventListener("click", clearBoard);
fullscreenToggleButton.addEventListener("click", toggleFullscreen);
if (overlayModeToggleButton) {
  overlayModeToggleButton.addEventListener("click", () => {
    toggleOverlayMode();
  });
}
openDocumentPopupButton.addEventListener("click", (event) => {
  event.stopPropagation();
  const open = !isDocumentPopupOpen();
  setDocumentPopupOpen(open);

  if (open) {
    closeBoardColorPopup();
    closeEraserToolPopup();
    closePresetHelp();
  }
});

documentLoadButton.addEventListener("click", requestDocumentFileSelection);
pdfPrevPageButton.addEventListener("click", goToPreviousPdfPage);
pdfNextPageButton.addEventListener("click", goToNextPdfPage);
if (exportAnnotatedPdfButton) {
  exportAnnotatedPdfButton.addEventListener("click", () => {
    exportAnnotatedPdf();
  });
}
removeDocumentButton.addEventListener("click", () => {
  unloadPdfDocument(true);
});

documentInput.addEventListener("change", handleDocumentInputChange);
openBoardColorPopupButton.addEventListener("click", (event) => {
  event.stopPropagation();
  setBoardColorPopupOpen(!isBoardColorPopupOpen());
});

documentPopup.addEventListener("pointerdown", (event) => {
  event.stopPropagation();
});

documentPopup.addEventListener("click", (event) => {
  event.stopPropagation();
});

boardColorPopup.addEventListener("click", (event) => {
  event.stopPropagation();
});

toolbarDragHandle.addEventListener("pointerdown", startToolbarDrag);
toolbarDragHandle.addEventListener("pointermove", moveToolbarDrag);
toolbarDragHandle.addEventListener("pointerup", endToolbarDrag);
toolbarDragHandle.addEventListener("pointercancel", endToolbarDrag);

eraserToolPopup.addEventListener("pointerdown", (event) => {
  event.stopPropagation();
});

eraserToolPopup.addEventListener("click", (event) => {
  event.stopPropagation();
});

presetHelpButton.addEventListener("click", (event) => {
  event.stopPropagation();
  setPresetHelpOpen(!isPresetHelpOpen());
});

presetHelpPopup.addEventListener("click", (event) => {
  event.stopPropagation();
});

penColorInput.addEventListener("input", () => {
  applyPenColor(penColorInput.value, true);
});

lineWidthInput.addEventListener("input", () => {
  if (lineWidthInput.value === "") {
    return;
  }
  applyPenWidth(lineWidthInput.value, true);
});

lineWidthInput.addEventListener("change", () => {
  applyPenWidth(lineWidthInput.value, true);
});

lineWidthInput.addEventListener("blur", () => {
  applyPenWidth(lineWidthInput.value, true);
});

lineWidthDecButton.addEventListener("click", () => {
  stepPenWidth(-1);
});

lineWidthIncButton.addEventListener("click", () => {
  stepPenWidth(1);
});

eraserWidthInput.addEventListener("input", () => {
  if (eraserWidthInput.value === "") {
    return;
  }
  applyEraserWidth(eraserWidthInput.value, true);
});

eraserWidthInput.addEventListener("change", () => {
  applyEraserWidth(eraserWidthInput.value, true);
});

eraserWidthInput.addEventListener("blur", () => {
  applyEraserWidth(eraserWidthInput.value, true);
});

eraserWidthDecButton.addEventListener("click", () => {
  stepEraserWidth(-1);
});

eraserWidthIncButton.addEventListener("click", () => {
  stepEraserWidth(1);
});

boardColorInput.addEventListener("input", (event) => {
  applyBoardColor(event.target.value, true);
});

canvas.addEventListener("pointerdown", handlePointerDown);
canvas.addEventListener("pointermove", handlePointerMove);
canvas.addEventListener("pointerup", handlePointerEnd);
canvas.addEventListener("pointercancel", handlePointerEnd);
canvas.addEventListener("pointerleave", (event) => {
  if (drawing && !canvas.hasPointerCapture(event.pointerId)) {
    stopDrawing(event);
  }
  if (strokeEraserActive && !canvas.hasPointerCapture(event.pointerId)) {
    stopStrokeErasing(event);
  }
});

window.addEventListener("resize", () => {
  handleViewportResize();
  syncFullscreenUiFromNativeWindow();
});
window.addEventListener("focus", () => {
  syncFullscreenUiFromNativeWindow();
});
document.addEventListener("fullscreenchange", () => {
  updateFullscreenButtons();
  handleViewportResize();
});
document.addEventListener("webkitfullscreenchange", () => {
  updateFullscreenButtons();
  handleViewportResize();
});
document.addEventListener("MSFullscreenChange", () => {
  updateFullscreenButtons();
  handleViewportResize();
});
document.addEventListener("pointerdown", (event) => {
  if (isDocumentPopupOpen() && !documentEditor.contains(event.target)) {
    closeDocumentPopup();
  }
  if (isBoardColorPopupOpen() && !boardColorEditor.contains(event.target)) {
    closeBoardColorPopup();
  }
  if (isEraserToolPopupOpen() && !eraserToolEditor.contains(event.target)) {
    closeEraserToolPopup();
  }
  if (isPresetHelpOpen() && !presetHelp.contains(event.target)) {
    closePresetHelp();
  }
});
document.addEventListener("keydown", (event) => {
  const editableTarget = isEditableEventTarget(event.target);
  const hasMeta = event.ctrlKey || event.metaKey;

  if (!editableTarget && hasMeta && !event.altKey && !event.repeat) {
    const key = String(event.key || "").toLowerCase();
    if (key === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        redoStrokeAction();
      } else {
        undoStrokeAction();
      }
      return;
    }

    if (key === "y") {
      event.preventDefault();
      redoStrokeAction();
      return;
    }
  }

  if (!editableTarget && event.key === "F8" && isOverlayModeSupported()) {
    event.preventDefault();
    toggleOverlayMode();
    return;
  }

  if (!editableTarget && hasLoadedPdfDocument()) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goToPreviousPdfPage();
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      goToNextPdfPage();
      return;
    }
  }

  if (event.key === "Escape") {
    if (isDocumentPopupOpen()) {
      closeDocumentPopup();
    }
    if (isBoardColorPopupOpen()) {
      closeBoardColorPopup();
    }
    if (isEraserToolPopupOpen()) {
      closeEraserToolPopup();
    }
    if (isPresetHelpOpen()) {
      closePresetHelp();
    }
  }
});

initToolbarLayout();
setCanvasSize();
initPresets();
initLastUsedSettings();
app.dataset.runtimePlatform = runtimePlatform;
closeDocumentPopup();
closeBoardColorPopup();
closeEraserToolPopup();
closePresetHelp();
setDocumentStatus("No document");
updatePdfNavigationUI();
updateFullscreenButtons();
syncFullscreenUiFromNativeWindow();
updateToolUI();
updateUndoRedoUI();
updateOverlayModeButton();
bootstrapRuntimeBridgeSync();
if (isLikelyTauriProtocol() && !isDesktopAppRuntime()) {
  setDocumentStatus("Desktop bridge not detected in this build. Rebuild Tauri app and run latest exe.", "warning");
}
restoreSessionState();

window.addEventListener("beforeunload", () => {
  if (sessionAutosaveTimer !== null) {
    window.clearTimeout(sessionAutosaveTimer);
    sessionAutosaveTimer = null;
  }
  persistSessionState();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden") {
    return;
  }

  if (sessionAutosaveTimer !== null) {
    window.clearTimeout(sessionAutosaveTimer);
    sessionAutosaveTimer = null;
  }
  persistSessionState();
});

