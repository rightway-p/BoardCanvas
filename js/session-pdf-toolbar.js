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

  if (tone === "warning" || tone === "error") {
    queueRuntimeLog("status", { tone, message });
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
    exportAnnotatedPdfButton.disabled = controlsLocked;
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

function getPreferredPdfWorkerSource() {
  // Desktop builds package local worker. Web builds should prefer CDN fallback.
  if (isDesktopAppRuntime()) {
    return PDF_WORKER_SOURCES[0];
  }
  return PDF_WORKER_SOURCES[1] || PDF_WORKER_SOURCES[0];
}

function loadExternalScript(sourceUrl) {
  const normalizedUrl = String(sourceUrl || "").trim();
  if (!normalizedUrl) {
    return Promise.reject(new Error("Invalid script URL."));
  }

  const existingPromise = externalScriptLoadPromises.get(normalizedUrl);
  if (existingPromise) {
    return existingPromise;
  }

  const loader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = normalizedUrl;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error(`Failed to load script: ${normalizedUrl}`));
    document.head.appendChild(script);
  });

  externalScriptLoadPromises.set(normalizedUrl, loader);
  return loader;
}

async function ensureGlobalScriptLoaded(sourceList, availabilityCheck, logPrefix) {
  if (availabilityCheck()) {
    return true;
  }

  for (const source of sourceList) {
    try {
      await loadExternalScript(source);
      if (availabilityCheck()) {
        queueRuntimeLog(`${logPrefix}.loaded`, { source });
        return true;
      }
    } catch (error) {
      queueRuntimeLog(`${logPrefix}.load-failed`, {
        source,
        error: toRuntimeLogError(error)
      });
    }
  }

  return availabilityCheck();
}

async function ensurePdfJsEngineAvailable() {
  const available = await ensureGlobalScriptLoaded(
    PDF_JS_SOURCES,
    () => Boolean(window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions),
    "pdf.engine"
  );

  if (!available) {
    setDocumentStatus("PDF engine is unavailable. Refresh and try again.", "error");
  }

  return available;
}

async function ensurePdfExportEngineAvailable() {
  const available = await ensureGlobalScriptLoaded(
    PDF_LIB_SOURCES,
    () => Boolean(window.PDFLib && window.PDFLib.PDFDocument),
    "pdf.export.engine"
  );

  if (!available) {
    setDocumentStatus("PDF export engine is unavailable. Refresh and try again.", "error");
  }

  return available;
}

async function configurePdfWorker() {
  if (isPdfWorkerConfigured) {
    return true;
  }

  if (!(await ensurePdfJsEngineAvailable())) {
    return false;
  }

  window.pdfjsLib.GlobalWorkerOptions.workerSrc = getPreferredPdfWorkerSource();
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

