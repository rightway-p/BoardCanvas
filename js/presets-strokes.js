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

