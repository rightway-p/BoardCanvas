const backgroundCanvas = document.getElementById("boardBackground");
const backgroundCtx = backgroundCanvas.getContext("2d");
const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const app = document.querySelector(".app");
const toolbar = document.querySelector(".toolbar");
const boardWrapper = document.querySelector(".board-wrapper");

const penToolButton = document.getElementById("penTool");
const overlayMouseModeToggleButton = document.getElementById("overlayMouseModeToggle");
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
const PDF_JS_SOURCES = [
  "./vendor/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
];
const PDF_LIB_SOURCES = [
  "./vendor/pdf-lib.min.js",
  "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js"
];
const PDF_WORKER_SOURCES = [
  "./vendor/pdf.worker.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
];

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
let boardColorBeforeOverlay = null;
let overlayMousePassthrough = false;
let overlayMouseTransitionInProgress = false;
let overlayMouseUiBypassActive = false;
let overlayMouseNativeIgnoreState = false;
let overlayMouseNativeQueue = Promise.resolve();
let overlayMouseTrackerTimer = null;
let overlayMousePollInFlight = false;
let overlayMousePollFailureCount = 0;
let overlayMouseToolbarRecoveryUntil = 0;
let overlaySurfaceStyleSnapshot = null;
let nativeFullscreenActive = false;
let nativeWindowMaximized = false;
let overlayMouseForwardOptionAvailable = null;
const runtimePlatform = detectRuntimePlatform();
const OVERLAY_MOUSE_POLL_INTERVAL_MS = 20;
const OVERLAY_MOUSE_POLL_MAX_FAILURES = 5;
const OVERLAY_MOUSE_HIT_PADDING_PX = 32;
const OVERLAY_MOUSE_RECOVERY_ZONE_PX = 96;
const OVERLAY_MOUSE_RECOVERY_HOLD_MS = 180;
const OVERLAY_HIDE_HOST_WITH_TOOLBAR_FALLBACK = false;
const RUNTIME_BUILD_TAG = "overlay-monitor-mouse-fallback-3";
const OVERLAY_WINDOW_LABEL = "overlay-canvas-window";
const OVERLAY_WINDOW_QUERY_KEY = "overlayWindow";
const OVERLAY_WINDOW_CLOSED_EVENT = "overlay-window-closed";
const MAX_RUNTIME_LOG_VALUE_LENGTH = 220;
const missingNativeWindowMethods = new Set();
let runtimeLogPathCache = "";
let runtimeLogPathRequested = false;
let runtimeLogQueue = Promise.resolve();
let overlayWindowListenerUnsubscribe = null;
const externalScriptLoadPromises = new Map();

