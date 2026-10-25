let lastCanvasCssViewport = null;
const pdfRasterCache = new Map();
const pdfRasterLookup = new Map();
let pdfRasterCacheBytes = 0;
const PDF_RASTER_CACHE_LIMIT = 96 * 1024 * 1024;
const PDF_RASTER_CACHE_ENTRIES = 8;
const pdfDocumentCacheIds = new WeakMap();
let nextPdfDocumentCacheId = 1;
let pdfBackgroundRenderToken = 0;
let pdfBackgroundRenderTimer = null;
let pdfBackgroundRenderPromise = null;
let pdfBackgroundRenderTask = null;

function stopPdfBackgroundRenderTask() {
  if (!pdfBackgroundRenderTask || typeof pdfBackgroundRenderTask.cancel !== "function") return;
  try { pdfBackgroundRenderTask.cancel(); } catch (error) { /* The task may already be settled. */ }
}

function clearPdfRasterCache() {
  pdfRasterCache.clear();
  pdfRasterLookup.clear();
  pdfRasterCacheBytes = 0;
  pdfBackgroundRenderToken += 1;
  if (pdfBackgroundRenderTimer !== null) window.clearTimeout(pdfBackgroundRenderTimer);
  pdfBackgroundRenderTimer = null;
  stopPdfBackgroundRenderTask();
}

function pdfRasterCacheKey(documentRef, pageNumber, width, height, viewportWidth, viewportHeight) {
  if (!pdfDocumentCacheIds.has(documentRef)) pdfDocumentCacheIds.set(documentRef, nextPdfDocumentCacheId++);
  return `${pdfDocumentCacheIds.get(documentRef)}:${pageNumber}:${width}x${height}:${viewportWidth}x${viewportHeight}:${qualityLevel}`;
}

function getCachedPdfRaster(key) {
  const entry = pdfRasterCache.get(key);
  if (!entry) return null;
  pdfRasterCache.delete(key);
  pdfRasterCache.set(key, entry);
  return entry;
}

function cachePdfRaster(key, canvas, lookupKey, result) {
  const bytes = canvas.width * canvas.height * 4;
  if (bytes > PDF_RASTER_CACHE_LIMIT) return;
  if (pdfRasterCache.has(key)) pdfRasterCacheBytes -= pdfRasterCache.get(key).bytes;
  pdfRasterCache.delete(key);
  pdfRasterCache.set(key, { canvas, bytes, result });
  pdfRasterLookup.set(lookupKey, key);
  pdfRasterCacheBytes += bytes;
  while (pdfRasterCache.size > PDF_RASTER_CACHE_ENTRIES || pdfRasterCacheBytes > PDF_RASTER_CACHE_LIMIT) {
    const oldest = pdfRasterCache.keys().next().value;
    pdfRasterCacheBytes -= pdfRasterCache.get(oldest).bytes;
    pdfRasterCache.delete(oldest);
    for (const [lookupKey, rasterKey] of pdfRasterLookup) if (rasterKey === oldest) pdfRasterLookup.delete(lookupKey);
  }
}

function updateToolUI() {
  if (typeof refreshBoardFeedback === "function") refreshBoardFeedback();
  const mouseModeActive = overlayMousePassthrough;
  penToolButton.classList.toggle("is-active", !mouseModeActive && tool === "pen" && !panMode);
  const eraserSelected = tool === "eraser" || tool === "strokeEraser";
  eraserToolButton.classList.toggle("is-active", !mouseModeActive && eraserSelected);
  pixelEraserModeButton.classList.toggle("is-active", eraserMode === "eraser");
  strokeEraserModeButton.classList.toggle("is-active", eraserMode === "strokeEraser");
  const modeText = mouseModeActive
    ? "마우스"
    : (tool === "pen"
      ? "펜"
      : (tool === "eraser" ? "지우개" : "획 지우개"));
  modeLabel.textContent = `모드: ${panMode ? "패닝" : modeText}${qualityLevel === "low" ? " | LowSpec" : ""}`;
  if (overlayMousePassthrough) {
    canvas.style.cursor = "default";
    return;
  }

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

  backgroundCtx.save();
  backgroundCtx.setTransform(boardCamera.scale, 0, 0, boardCamera.scale, pixelRatio * boardCamera.x, pixelRatio * boardCamera.y);
  backgroundCtx.imageSmoothingEnabled = true;
  backgroundCtx.imageSmoothingQuality = "high";
  backgroundCtx.drawImage(pdfPageRasterCanvas, 0, 0);
  backgroundCtx.restore();
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

  if (typeof finishActiveBoardInput === "function") finishActiveBoardInput();
  saveCurrentStrokeState();
  clearPdfRenderDebounce();
  stopPdfRenderTask();
  if (typeof cancelPendingBoardPageRender === "function") cancelPendingBoardPageRender();
  clearPdfRasterCache();
  pdfRenderToken += 1;
  pdfLoadingToken += 1;

  const previousDocument = pdfDocument;
  pdfDocument = null;
  pdfPageNumber = 1;
  boardPageSequence = BoardState.createPageSequence(0);
  boardPageIndex = 0;
  pageStructureUndo.length = 0;
  pageStructureRedo.length = 0;
  boardCamera = { x: 0, y: 0, scale: 1 };
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

async function renderPdfPage(pageNumber, options = {}) {
  if (!hasLoadedPdfDocument()) {
    return null;
  }

  if (options.foreground !== false) {
    pdfBackgroundRenderToken += 1;
    if (pdfBackgroundRenderTimer !== null) window.clearTimeout(pdfBackgroundRenderTimer);
    pdfBackgroundRenderTimer = null;
    stopPdfBackgroundRenderTask();
    clearPdfRenderDebounce();
    stopPdfRenderTask();
  }

  const clampedPage = Math.min(
    Number(pdfDocument.numPages),
    Math.max(1, Math.round(Number(pageNumber) || 1))
  );
  const documentRef = pdfDocument;
  const backgroundToken = pdfBackgroundRenderToken;
  const token = options.foreground === false ? pdfRenderToken : ++pdfRenderToken;
  const statusName = loadedDocumentName || "PDF";
  let renderTask = null;

  try {
    const boardPage = options.boardPage || (typeof currentBoardPage === "function" ? currentBoardPage() : null);
    const storedSize = boardPage && boardPage.kind === "pdf" && boardPage.pdfPage === clampedPage ? boardPage.pdfWorldSize : null;
    const maxWidth = Math.max(1, storedSize && storedSize.width || backgroundCanvas.width);
    const maxHeight = Math.max(1, storedSize && storedSize.height || backgroundCanvas.height);
    if (!pdfDocumentCacheIds.has(documentRef)) pdfDocumentCacheIds.set(documentRef, nextPdfDocumentCacheId++);
    const lookupKey = `${pdfDocumentCacheIds.get(documentRef)}:${clampedPage}:${maxWidth}x${maxHeight}:${qualityLevel}`;
    const cachedKey = pdfRasterLookup.get(lookupKey);
    if (cachedKey) {
      const cached = getCachedPdfRaster(cachedKey);
      if (cached) return cached.result;
      pdfRasterLookup.delete(lookupKey);
    }
    const page = await documentRef.getPage(clampedPage);
    if (documentRef !== pdfDocument || (options.foreground === false ? backgroundToken !== pdfBackgroundRenderToken : token !== pdfRenderToken)) return null;
    const baseViewport = page.getViewport({ scale: 1 });
    const fitScale = Math.min(maxWidth / baseViewport.width, maxHeight / baseViewport.height);
    const viewport = page.getViewport({ scale: fitScale });
    const key = pdfRasterCacheKey(documentRef, clampedPage, maxWidth, maxHeight, viewport.width, viewport.height);

    const rasterCanvas = document.createElement("canvas");
    rasterCanvas.width = maxWidth;
    rasterCanvas.height = maxHeight;

    const rasterContext = rasterCanvas.getContext("2d", { alpha: true });
    if (!rasterContext) {
      setDocumentStatus("Could not create a PDF rendering context.", "error");
      return;
    }
    rasterContext.imageSmoothingEnabled = true;
    rasterContext.imageSmoothingQuality = "high";
    rasterContext.translate((maxWidth - viewport.width) / 2, (maxHeight - viewport.height) / 2);

    renderTask = page.render({
      canvasContext: rasterContext,
      viewport
    });
    if (options.foreground !== false) pdfRenderTask = renderTask;
    else pdfBackgroundRenderTask = renderTask;
    await renderTask.promise;

    if (documentRef !== pdfDocument || (options.foreground === false ? backgroundToken !== pdfBackgroundRenderToken : token !== pdfRenderToken)) return null;
    const result = { raster: rasterCanvas, pageNumber: clampedPage, maxWidth, maxHeight, contentBounds: { x: (maxWidth - viewport.width) / 2, y: (maxHeight - viewport.height) / 2, width: viewport.width, height: viewport.height }, page, key };
    cachePdfRaster(key, rasterCanvas, lookupKey, result);
    return result;
  } catch (error) {
    if (error && error.name === "RenderingCancelledException") {
      return null;
    }
    setDocumentStatus("Failed to render PDF page.", "error");
    throw error;
  } finally {
    if (token === pdfRenderToken) {
      pdfRenderTask = null;
    }
    if (options.foreground === false && pdfBackgroundRenderTask === renderTask) pdfBackgroundRenderTask = null;
  }
}

function presentPdfPage(result, boardPage = null) {
  if (!result) return false;
  if (pdfPageNumber !== result.pageNumber) {
    savePdfPageStrokeSnapshot(pdfPageNumber);
    pdfPageNumber = result.pageNumber;
    restoreCurrentStrokeState();
    scheduleSessionAutosave();
  }
  pdfPageRasterCanvas = result.raster;
  boardPage = boardPage || (typeof currentBoardPage === "function" ? currentBoardPage() : null);
  if (boardPage && boardPage.kind === "pdf" && boardPage.pdfPage === result.pageNumber) {
    if (!boardPage.pdfWorldSize) boardPage.pdfWorldSize = { width: result.maxWidth, height: result.maxHeight };
    boardPage.pdfContentBounds = result.contentBounds;
  }
  const initiallyFitted = typeof fitBoardPageAfterPdfRender === "function" && fitBoardPageAfterPdfRender(boardPage);
  const zoomAdjusted = !initiallyFitted && typeof enforcePdfZoomMinimum === "function" && enforcePdfZoomMinimum();
  if (!zoomAdjusted) renderBoardBackground();
  updatePdfNavigationUI();
  if (typeof markBoardPagePresented === "function") markBoardPagePresented();
  setDocumentStatus(`${loadedDocumentName || "PDF"} (${pdfPageNumber}/${pdfDocument.numPages})`, "success");
  return true;
}

function schedulePdfBackgroundRenders() {
  if (pdfBackgroundRenderTimer !== null) window.clearTimeout(pdfBackgroundRenderTimer);
  const token = ++pdfBackgroundRenderToken;
  const documentRef = pdfDocument;
  const center = pdfPageNumber;
  const candidates = [center - 1, center + 1].filter((number) => number >= 1 && number <= Number(documentRef && documentRef.numPages));
  let offset = 0;
  const next = () => {
    if (token !== pdfBackgroundRenderToken || documentRef !== pdfDocument || offset >= candidates.length) return;
    const number = candidates[offset++];
    const boardPage = Array.isArray(boardPageSequence)
      ? boardPageSequence.find((page) => page.kind === "pdf" && page.pdfPage === number)
      : null;
    pdfBackgroundRenderPromise = renderPdfPage(number, { foreground: false, boardPage }).catch(() => null).finally(() => {
      pdfBackgroundRenderPromise = null;
      if (token === pdfBackgroundRenderToken && documentRef === pdfDocument) pdfBackgroundRenderTimer = window.setTimeout(next, 0);
    });
  };
  if (pdfBackgroundRenderPromise) pdfBackgroundRenderPromise.finally(() => {
    if (token === pdfBackgroundRenderToken && documentRef === pdfDocument) pdfBackgroundRenderTimer = window.setTimeout(next, 0);
  });
  else pdfBackgroundRenderTimer = window.setTimeout(next, 0);
}

async function exportAnnotatedPdf(options = {}) {
  if (pdfExportInProgress) {
    return;
  }

  if (!window.BoardExport || !window.PDFLib) { setDocumentStatus("PDF 내보내기 기능을 불러오지 못했습니다.", "error"); return; }
  saveCurrentStrokeState();
  pdfExportInProgress = true;
  updatePdfNavigationUI();

  const outputFileName = getAnnotatedPdfFileName();

  try {
    const outputBytes = await window.BoardExport.exportSequence({ pages: boardPageSequence.map((page) => ({ ...page, strokes: cloneStrokeCollection(page.strokes || []) })), pdfBytes: loadedPdfBytes, PDFLib: window.PDFLib, includeOutsideInk: Boolean(options.includeOutsideInk), includeBlankPages: Boolean(options.includeBlankPages), drawStrokePath });
    if (!BoardState.isByteLengthWithinLimit(outputBytes && outputBytes.byteLength, BoardState.MAX_SAVED_DOCUMENT_BYTES)) throw new Error("PDF 내보내기 결과는 512 MiB 이하만 저장할 수 있습니다. 판서 영역을 줄인 뒤 다시 내보내세요.");
    const invoke = getTauriInvoke();
    if (invoke) {
      let binary = "";
      const bytes = new Uint8Array(outputBytes);
      for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      const result = await invoke("save_document_file", { suggestedName: outputFileName, contentsBase64: btoa(binary), kind: "pdf" });
      setDocumentStatus(result && result.saved === true ? `${outputFileName} 저장 완료` : "PDF 저장을 취소했습니다.", result && result.saved === true ? "success" : "warning");
      return;
    }
    const outputBlob = new Blob([outputBytes], { type: "application/pdf" });
    downloadBlobFile(outputBlob, outputFileName);
    setDocumentStatus(`${outputFileName} 다운로드를 요청했습니다. 파일 저장 여부를 확인해 주세요.`, "warning");
  } catch (error) {
    setDocumentStatus(error && error.message ? error.message : "판서 PDF를 만들지 못했습니다.", "error");
  } finally {
    pdfExportInProgress = false;
    updatePdfNavigationUI();
  }
}

function schedulePdfPageRerender() {
  if (!hasLoadedPdfDocument() || (typeof currentBoardPage === "function" && currentBoardPage()?.kind !== "pdf")) {
    return;
  }

  clearPdfRenderDebounce();
  pdfRenderDebounceTimer = window.setTimeout(() => {
    pdfRenderDebounceTimer = null;
    if (typeof currentBoardPage === "function" && currentBoardPage()?.kind !== "pdf") return;
    if (typeof pendingBoardPageTarget === "number" && typeof renderBoardPage === "function") {
      renderBoardPage(pendingBoardPageTarget);
      return;
    }
    renderPdfPage(pdfPageNumber).then((result) => presentPdfPage(result)).catch(() => {});
  }, 120);
}

async function loadPdfFromFile(file) {
  if (pdfExportInProgress) {
    setDocumentStatus("Wait until export finishes.", "warning");
    return false;
  }

  if (!BoardState.isByteLengthWithinLimit(file && file.size, BoardState.MAX_PDF_BYTES)) {
    setDocumentStatus("PDF 파일은 256 MiB 이하만 불러올 수 있습니다.", "error");
    return false;
  }

  if (!(await configurePdfWorker())) {
    return false;
  }

  const token = ++pdfLoadingToken;
  const fileName = file.name || "PDF";
  setDocumentStatus(`${fileName}: loading...`);
  queueRuntimeLog("pdf.load.start", {
    fileName,
    fileSize: Number.isFinite(file.size) ? file.size : null,
    fileType: trimRuntimeLogValue(file.type || "", 120),
    token
  });

  let replacementBackup = null;
  try {
    const source = await file.arrayBuffer();
    if (token !== pdfLoadingToken) {
      queueRuntimeLog("pdf.load.canceled", { fileName, token, reason: "token-mismatch-before-open" });
      return false;
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
        queueRuntimeLog("pdf.load.attempt.failed", {
          fileName,
          attempt: index + 1,
          options: sanitizeRuntimeLogDetails(loadAttempts[index]),
          error: toRuntimeLogError(attemptError)
        });
      }
    }

    if (!nextDocument) {
      throw lastLoadError || new Error("PDF load failed.");
    }

    if (token !== pdfLoadingToken) {
      await releasePdfDocument(nextDocument);
      queueRuntimeLog("pdf.load.canceled", { fileName, token, reason: "token-mismatch-after-open" });
      return false;
    }

    saveCurrentStrokeState();
    const previousDocument = pdfDocument;
    replacementBackup = {
      document: previousDocument,
      pageNumber: pdfPageNumber,
      sequence: structuredClone(boardPageSequence),
      index: boardPageIndex,
      camera: { ...boardCamera },
      raster: pdfPageRasterCanvas,
      name: loadedDocumentName,
      bytes: loadedPdfBytes && loadedPdfBytes.slice(),
      dirty: sessionPdfBytesDirty,
      boardStrokes: cloneStrokeCollection(boardStrokeSnapshot),
      strokes: cloneStrokeCollection(strokes),
      pageSnapshots: new Map(Array.from(pdfPageStrokeSnapshots, ([page, value]) => [page, cloneStrokeCollection(value)])),
      history: new Map(Array.from(strokeHistoryByContext, ([key, entry]) => [key, { undo: entry.undo.map(cloneStrokeCollection), redo: entry.redo.map(cloneStrokeCollection) }]))
    };
    clearPdfRenderDebounce();
    stopPdfRenderTask();
    if (typeof cancelPendingBoardPageRender === "function") cancelPendingBoardPageRender();

    pdfPageStrokeSnapshots.clear();
    clearPdfRasterCache();
    pdfDocument = nextDocument;
    pdfPageNumber = 1;
    boardPageSequence = BoardState.createPageSequence(Number(nextDocument.numPages));
      boardPageSequence.forEach((page) => { page.strokes = []; page.pdfWorldSize = { width: backgroundCanvas.width, height: backgroundCanvas.height }; });
    boardPageIndex = 0;
    pageStructureUndo.length = 0;
    pageStructureRedo.length = 0;
    boardCamera = { x: 0, y: 0, scale: 1 };
    pdfPageRasterCanvas = null;
    loadedDocumentName = fileName;
    loadedPdfBytes = sourceBytes.slice();
    sessionPdfBytesDirty = true;
    restoreCurrentStrokeState();

    const firstPage = await renderPdfPage(1);
    if (!firstPage || !presentPdfPage(firstPage, boardPageSequence[0])) throw new Error("PDF page rendering failed.");
    queueRuntimeLog("pdf.load.success", {
      fileName,
      pages: Number.isFinite(nextDocument.numPages) ? nextDocument.numPages : null,
      compatibilityMode: usedCompatibilityMode
    });
    if (usedCompatibilityMode) {
      setDocumentStatus(`${fileName}: loaded (compatibility mode).`, "warning");
    }
    if (pdfPageRasterCanvas) {
      closeDocumentPopup();
    }
    clearAllStrokeHistory();
    scheduleSessionAutosave();
    schedulePdfBackgroundRenders();
    replacementBackup = null;
    await releasePdfDocument(previousDocument);
    return true;
  } catch (error) {
    if (replacementBackup) {
      const failedDocument = pdfDocument;
      stopPdfRenderTask();
      pdfRenderToken += 1;
      pdfDocument = replacementBackup.document;
      pdfPageNumber = replacementBackup.pageNumber;
      boardPageSequence = replacementBackup.sequence;
      boardPageIndex = replacementBackup.index;
      boardCamera = replacementBackup.camera;
      pdfPageRasterCanvas = replacementBackup.raster;
      loadedDocumentName = replacementBackup.name;
      loadedPdfBytes = replacementBackup.bytes;
      sessionPdfBytesDirty = replacementBackup.dirty;
      boardStrokeSnapshot = replacementBackup.boardStrokes;
      pdfPageStrokeSnapshots.clear();
      for (const [page, value] of replacementBackup.pageSnapshots) pdfPageStrokeSnapshots.set(page, value);
      strokeHistoryByContext.clear();
      for (const [key, value] of replacementBackup.history) strokeHistoryByContext.set(key, value);
      replaceVisibleStrokes(replacementBackup.strokes);
      renderBoardBackground();
      if (typeof applyBoardCamera === "function") applyBoardCamera();
      replacementBackup = null;
      if (failedDocument && failedDocument !== pdfDocument) await releasePdfDocument(failedDocument);
    }
    if (token !== pdfLoadingToken) {
      queueRuntimeLog("pdf.load.canceled", { fileName, token, reason: "token-mismatch-on-error" });
      return false;
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
    queueRuntimeLog("pdf.load.failed", {
      fileName,
      error: toRuntimeLogError(error),
      reason: trimRuntimeLogValue(reason || "")
    });
    return false;
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
    requestBoardWorkReplacement(async () => {
      const loaded = await loadPdfFromFile(file);
      if (loaded && typeof clearActiveDrivePin === "function") await clearActiveDrivePin();
      return loaded;
    });
    return;
  }

  if (isPptFile(file)) {
    setDocumentStatus("PPT/PPTX cannot be rendered directly. Convert to PDF and load again.", "warning");
    return;
  }

  setDocumentStatus("Unsupported file type. Choose PDF or PPT/PPTX.", "error");
}

function goToPreviousPdfPage() {
  if (typeof goToBoardPage === "function") goToBoardPage(-1);
}

function goToNextPdfPage() {
  if (typeof goToBoardPage === "function") goToBoardPage(1);
}

async function requestDocumentFileSelection() {
  if (pdfExportInProgress || sessionRestoreInProgress) {
    return;
  }

  if (!(await configurePdfWorker())) {
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
  const rect = boardWrapper.getBoundingClientRect();
  const previousWidth = canvas.width;
  const previousHeight = canvas.height;
  const previousBackgroundWidth = backgroundCanvas.width;
  const previousBackgroundHeight = backgroundCanvas.height;

  const previousPixelRatio = pixelRatio;
  const previousRect = lastCanvasCssViewport || { width: previousWidth / previousPixelRatio, height: previousHeight / previousPixelRatio };
  const nextPixelRatio = Math.min(quality.dprCap, Math.max(1, window.devicePixelRatio || 1));
  const wasFitted = typeof isCurrentBoardPageFitted === "function"
    && isCurrentBoardPageFitted(previousRect, previousPixelRatio);
  const nextWidth = Math.max(1, Math.floor(rect.width * nextPixelRatio));
  const nextHeight = Math.max(1, Math.floor(rect.height * nextPixelRatio));

  if (
    nextWidth === previousWidth
    && nextHeight === previousHeight
    && nextWidth === previousBackgroundWidth
    && nextHeight === previousBackgroundHeight
    && nextPixelRatio === previousPixelRatio
  ) {
    lastCanvasCssViewport = { width: rect.width, height: rect.height };
    if (typeof refitBoardPageAfterViewportResize === "function") {
      refitBoardPageAfterViewportResize(previousRect, previousPixelRatio);
    }
    if (typeof enforcePdfZoomMinimum === "function") enforcePdfZoomMinimum();
    return;
  }

  pendingQualityResize = false;
  if (typeof finishActiveBoardInput === "function") finishActiveBoardInput();
  pixelRatio = nextPixelRatio;

  backgroundCanvas.width = nextWidth;
  backgroundCanvas.height = nextHeight;
  canvas.width = nextWidth;
  canvas.height = nextHeight;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (previousWidth > 0 && previousHeight > 0) {
    if (previousPixelRatio > 0 && previousPixelRatio !== pixelRatio) {
      scaleStoredStrokes(pixelRatio / previousPixelRatio, pixelRatio / previousPixelRatio);
    }
    redrawAllStrokes();
    scheduleSessionAutosave();
  }

  renderBoardBackground();
  schedulePdfPageRerender();
  lastCanvasCssViewport = { width: rect.width, height: rect.height };
  if (previousPixelRatio !== pixelRatio) {
    if (wasFitted && typeof fitCurrentBoardPage === "function") fitCurrentBoardPage(false);
  } else if (typeof refitBoardPageAfterViewportResize === "function") {
    refitBoardPageAfterViewportResize(previousRect, previousPixelRatio);
  }
  if (typeof enforcePdfZoomMinimum === "function") enforcePdfZoomMinimum();
}

function getCanvasPoint(event) {
  const rect = boardWrapper.getBoundingClientRect();
  const screenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const worldPoint = BoardState.pointToWorld(screenPoint, boardCamera);

  return {
    x: worldPoint.x * pixelRatio,
    y: worldPoint.y * pixelRatio
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
  ctx.strokeStyle = tool === "eraser" ? "rgba(0, 0, 0, 1)" : strokeRgba(penColorInput.value, penOpacity);
  ctx.fillStyle = tool === "eraser" ? "rgba(0, 0, 0, 1)" : strokeRgba(penColorInput.value, penOpacity);
  const width = tool === "eraser" ? Number(eraserWidthInput.value) * pixelRatio : activeStroke?.widthPx;
  ctx.lineWidth = tool === "eraser" ? Math.max(1, width) : (Number.isFinite(width) && width > 0 ? width : 1);
}

function redrawVisibleStrokesWithActive() {
  redrawAllStrokes();
  if (!activeStroke) return;
  ctx.setTransform(boardCamera.scale, 0, 0, boardCamera.scale, pixelRatio * boardCamera.x, pixelRatio * boardCamera.y);
  drawStrokePath(activeStroke);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function appendRawPoint(rawPoint) {
  if (!lastPoint) {
    lastPoint = rawPoint;
    return false;
  }
  if (rawPoint.x === lastPoint.x && rawPoint.y === lastPoint.y) return false;
  ctx.lineTo(rawPoint.x, rawPoint.y);
  lastPoint = rawPoint;
  if (activeStroke) {
    appendPointToStroke(activeStroke, rawPoint);
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

function enqueueEventPoints(event) {
  const coalesced = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
  const sourceEvents = coalesced && coalesced.length ? Array.from(coalesced) : [event];
  if (event.type === "pointerup") {
    const last = sourceEvents[sourceEvents.length - 1];
    if (!last || last.clientX !== event.clientX || last.clientY !== event.clientY) sourceEvents.push(event);
  }

  for (const sourceEvent of sourceEvents) {
    pendingPoints.push({
      point: getCanvasPoint(sourceEvent)
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

  ctx.setTransform(boardCamera.scale, 0, 0, boardCamera.scale, pixelRatio * boardCamera.x, pixelRatio * boardCamera.y);
  applyCurrentBrush();

  let didStroke = false;
  let processedCount = 0;
  const startedAt = performance.now();

  ctx.beginPath();
  if (lastPoint) {
    ctx.moveTo(lastPoint.x, lastPoint.y);
  }

  while (pendingHead < pendingPoints.length && processedCount < maxPoints) {
    const item = pendingPoints[pendingHead];
    pendingHead += 1;
    processedCount += 1;

    if (appendRawPoint(item.point)) {
      didStroke = true;
      hasStrokeMoved = true;
    }

    if ((performance.now() - startedAt) >= frameBudgetMs) {
      break;
    }
  }

  if (didStroke) {
    ctx.stroke();
    if (tool === "pen" && penOpacity < 1) redrawVisibleStrokesWithActive();
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
  clearPendingPoints();
  frameRequested = false;
  activeStroke = createStrokeRecord(tool === "eraser" ? "pixel-eraser" : "pen", point);

  ctx.setTransform(boardCamera.scale, 0, 0, boardCamera.scale, pixelRatio * boardCamera.x, pixelRatio * boardCamera.y);
  applyCurrentBrush();
  canvas.setPointerCapture(event.pointerId);
  redrawVisibleStrokesWithActive();
  updateUndoRedoUI();
}

function draw(event) {
  if (!drawing) {
    return;
  }

  enqueueEventPoints(event);
}

function stopDrawing(event) {
  if (!drawing) {
    return;
  }

  if (event.type !== "pointercancel") {
    enqueueEventPoints(event);
  }
  flushPendingPoints();

  if (!hasStrokeMoved && lastPoint) {
    ctx.setTransform(boardCamera.scale, 0, 0, boardCamera.scale, pixelRatio * boardCamera.x, pixelRatio * boardCamera.y);
    applyCurrentBrush();
    ctx.beginPath();
    const dotWidth = tool === "eraser" ? Math.max(1, Number(eraserWidthInput.value) * pixelRatio) : activeStroke.widthPx;
    ctx.arc(lastPoint.x, lastPoint.y, dotWidth / 2, 0, Math.PI * 2);
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

  redrawAllStrokes();

  updateUndoRedoUI();
}

function discardDrawingForTouchTakeover() {
  if (!drawing) return false;
  drawing = false;
  hasStrokeMoved = false;
  lastPoint = null;
  activeStroke = null;
  clearPendingPoints();
  frameRequested = false;
  currentInputPointerId = null;
  redrawAllStrokes();
  updateUndoRedoUI();
  return true;
}

function handlePointerDown(event) {
  if (event.boardTouchHandled) return;
  if (overlayMousePassthrough) {
    return;
  }
  if (panMode || !event.isPrimary || currentInputPointerId !== null) return;
  currentInputPointerId = event.pointerId;

  if (tool === "strokeEraser") {
    startStrokeErasing(event);
    return;
  }

  startDrawing(event);
}

function handlePointerMove(event) {
  if (event.boardTouchHandled) return;
  if (!BoardState.isActivePointer(currentInputPointerId, event.pointerId)) return;
  if (strokeEraserActive) {
    continueStrokeErasing(event);
    return;
  }

  if (drawing) {
    draw(event);
  }
}

function handlePointerEnd(event) {
  if (event.boardTouchHandled) return;
  if (!BoardState.isActivePointer(currentInputPointerId, event.pointerId)) return;
  if (strokeEraserActive) {
    stopStrokeErasing(event);
  }

  if (drawing) {
    stopDrawing(event);
  }
  if (currentInputPointerId === event.pointerId) currentInputPointerId = null;
}

function clearBoard() {
  if (strokes.length <= 0) {
    if (typeof showBoardAction === "function") showBoardAction("지울 내용이 없습니다");
    return;
  }

  saveUndoSnapshotForCurrentContext();
  strokes.length = 0;
  redrawAllStrokes();
  finalizeStrokeMutation();
  if (typeof showBoardAction === "function") showBoardAction("현재 페이지를 지웠습니다");
}

function setBoardColor(color) {
  canvas.style.backgroundColor = "transparent";
  const normalized = normalizeHexColor(color);
  if (overlayMode) {
    backgroundCanvas.style.backgroundColor = "transparent";
    return;
  }
  backgroundCanvas.style.backgroundColor = normalized || color || "transparent";
}

