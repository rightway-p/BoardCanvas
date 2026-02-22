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
const clearButton = document.getElementById("clearButton");
const fullscreenToggleButton = document.getElementById("fullscreenToggle");

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
const TOOLBAR_DOCK_THRESHOLD = 88;

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
let activeStroke = null;
let strokeEraserActive = false;
let strokeEraserPointerId = null;
let strokeEraserLastPoint = null;
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
let loadedDocumentName = "";
let isPdfWorkerConfigured = false;

function getFullscreenElement() {
  return document.fullscreenElement
    || document.webkitFullscreenElement
    || document.msFullscreenElement
    || null;
}

function isFullscreenSupported() {
  return Boolean(
    document.fullscreenEnabled
    || document.webkitFullscreenEnabled
    || document.msFullscreenEnabled
  );
}

function updateFullscreenButtons() {
  const supported = isFullscreenSupported();
  const active = Boolean(getFullscreenElement());

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
  if (!isFullscreenSupported() || getFullscreenElement()) {
    return;
  }

  const target = document.documentElement;
  try {
    if (typeof target.requestFullscreen === "function") {
      await target.requestFullscreen();
      return;
    }

    if (typeof target.webkitRequestFullscreen === "function") {
      target.webkitRequestFullscreen();
      return;
    }

    if (typeof target.msRequestFullscreen === "function") {
      target.msRequestFullscreen();
    }
  } catch (error) {
    // Fullscreen request can fail if browser blocks it.
  }
}

async function exitFullscreen() {
  if (!getFullscreenElement()) {
    return;
  }

  try {
    if (typeof document.exitFullscreen === "function") {
      await document.exitFullscreen();
      return;
    }

    if (typeof document.webkitExitFullscreen === "function") {
      document.webkitExitFullscreen();
      return;
    }

    if (typeof document.msExitFullscreen === "function") {
      document.msExitFullscreen();
    }
  } catch (error) {
    // Ignore exit errors and keep UI in sync via fullscreenchange.
  }
}

function toggleFullscreen() {
  if (getFullscreenElement()) {
    exitFullscreen();
    return;
  }

  enterFullscreen();
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

function updatePdfNavigationUI() {
  const hasPdf = hasLoadedPdfDocument();
  const currentPage = hasPdf ? pdfPageNumber : 0;
  const totalPages = hasPdf ? Number(pdfDocument.numPages) : 0;

  pdfPrevPageButton.disabled = !hasPdf || currentPage <= 1;
  pdfNextPageButton.disabled = !hasPdf || currentPage >= totalPages;
  removeDocumentButton.disabled = !hasPdf;
  pdfPageIndicator.textContent = hasPdf
    ? `${currentPage} / ${totalPages}`
    : "- / -";
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

function drawStrokePath(stroke) {
  if (!stroke || !Array.isArray(stroke.points) || stroke.points.length === 0) {
    return;
  }

  const isPixelEraser = stroke.kind === "pixel-eraser";
  ctx.globalCompositeOperation = isPixelEraser ? "destination-out" : "source-over";
  ctx.strokeStyle = isPixelEraser ? "rgba(0, 0, 0, 1)" : stroke.color;
  ctx.fillStyle = isPixelEraser ? "rgba(0, 0, 0, 1)" : stroke.color;
  ctx.lineWidth = Math.max(1, Number(stroke.widthPx));

  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    ctx.beginPath();
    ctx.arc(point.x, point.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  const points = stroke.points;
  let previous = points[0];
  let previousMidpoint = previous;

  ctx.beginPath();
  ctx.moveTo(previousMidpoint.x, previousMidpoint.y);

  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    const midpoint = getMidpoint(previous, current);
    ctx.quadraticCurveTo(previous.x, previous.y, midpoint.x, midpoint.y);
    previous = current;
    previousMidpoint = midpoint;
  }

  ctx.stroke();
}

function redrawAllStrokes() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (const stroke of strokes) {
    drawStrokePath(stroke);
  }
}

function scaleStoredStrokes(scaleX, scaleY) {
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) {
    return;
  }

  const widthScale = (scaleX + scaleY) / 2;

  for (const stroke of strokes) {
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

  strokes.splice(index, 1);
  redrawAllStrokes();
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

  const sortedIndexes = Array.from(removedIndexes).sort((a, b) => b - a);
  for (const index of sortedIndexes) {
    strokes.splice(index, 1);
  }

  redrawAllStrokes();
  return true;
}

function startStrokeErasing(event) {
  strokeEraserActive = true;
  strokeEraserPointerId = event.pointerId;
  strokeEraserLastPoint = getCanvasPoint(event);
  eraseTopStrokeAtPoint(strokeEraserLastPoint);
  canvas.setPointerCapture(event.pointerId);
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
  strokeEraserPointerId = null;
  strokeEraserLastPoint = null;

  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
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
  clearPdfRenderDebounce();
  stopPdfRenderTask();
  pdfRenderToken += 1;
  pdfLoadingToken += 1;

  const previousDocument = pdfDocument;
  pdfDocument = null;
  pdfPageNumber = 1;
  pdfPageRasterCanvas = null;
  loadedDocumentName = "";

  renderBoardBackground();
  updatePdfNavigationUI();

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
  pdfPageNumber = clampedPage;
  updatePdfNavigationUI();

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

    const loadingTask = window.pdfjsLib.getDocument({
      data: source
    });
    const nextDocument = await loadingTask.promise;
    if (token !== pdfLoadingToken) {
      await releasePdfDocument(nextDocument);
      return;
    }

    const previousDocument = pdfDocument;
    clearPdfRenderDebounce();
    stopPdfRenderTask();

    pdfDocument = nextDocument;
    pdfPageNumber = 1;
    pdfPageRasterCanvas = null;
    loadedDocumentName = fileName;

    await renderPdfPage(1);
    if (pdfPageRasterCanvas) {
      closeDocumentPopup();
    }
    await releasePdfDocument(previousDocument);
  } catch (error) {
    if (token !== pdfLoadingToken) {
      return;
    }

    setDocumentStatus("Unable to open this PDF file. Try another file.", "error");
  } finally {
    updatePdfNavigationUI();
  }
}

async function handleDocumentInputChange(event) {
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
  if (!hasLoadedPdfDocument() || pdfPageNumber <= 1) {
    return;
  }

  renderPdfPage(pdfPageNumber - 1);
}

function goToNextPdfPage() {
  if (!hasLoadedPdfDocument() || pdfPageNumber >= Number(pdfDocument.numPages)) {
    return;
  }

  renderPdfPage(pdfPageNumber + 1);
}

function requestDocumentFileSelection() {
  documentInput.click();
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

  if (previousWidth > 0 && previousHeight > 0 && strokes.length > 0) {
    scaleStoredStrokes(nextWidth / previousWidth, nextHeight / previousHeight);
    redrawAllStrokes();
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
    strokes.push(activeStroke);
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
  strokes.length = 0;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
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

clearButton.addEventListener("click", clearBoard);
fullscreenToggleButton.addEventListener("click", toggleFullscreen);
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

window.addEventListener("resize", handleViewportResize);
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
  if (!isEditableEventTarget(event.target) && hasLoadedPdfDocument()) {
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
closeDocumentPopup();
closeBoardColorPopup();
closeEraserToolPopup();
closePresetHelp();
setDocumentStatus("No document");
updatePdfNavigationUI();
updateFullscreenButtons();
updateToolUI();

