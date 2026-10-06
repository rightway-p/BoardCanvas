let lastCanvasCssViewport = null;

function updateToolUI() {
  const mouseModeActive = overlayMousePassthrough;
  penToolButton.classList.toggle("is-active", !mouseModeActive && tool === "pen" && !panMode);
  const eraserSelected = tool === "eraser" || tool === "strokeEraser";
  eraserToolButton.classList.toggle("is-active", !mouseModeActive && eraserSelected);
  pixelEraserModeButton.classList.toggle("is-active", eraserMode === "eraser");
  strokeEraserModeButton.classList.toggle("is-active", eraserMode === "strokeEraser");
  const modeText = mouseModeActive
    ? "Mouse"
    : (tool === "pen"
      ? "Pen"
      : (tool === "eraser" ? "Eraser" : "StrokeEraser"));
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
    const boardPage = typeof currentBoardPage === "function" ? currentBoardPage() : null;
    const storedSize = boardPage && boardPage.kind === "pdf" && boardPage.pdfPage === clampedPage ? boardPage.pdfWorldSize : null;
    const maxWidth = Math.max(1, storedSize && storedSize.width || backgroundCanvas.width);
    const maxHeight = Math.max(1, storedSize && storedSize.height || backgroundCanvas.height);
    const fitScale = Math.min(maxWidth / baseViewport.width, maxHeight / baseViewport.height);
    const viewport = page.getViewport({ scale: fitScale });

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

    pdfRenderTask = page.render({
      canvasContext: rasterContext,
      viewport
    });
    await pdfRenderTask.promise;

    if (token !== pdfRenderToken || !hasLoadedPdfDocument()) {
      return;
    }

    pdfPageRasterCanvas = rasterCanvas;
    if (boardPage && boardPage.kind === "pdf" && boardPage.pdfPage === clampedPage && !boardPage.pdfWorldSize) {
      boardPage.pdfWorldSize = { width: maxWidth, height: maxHeight };
    }
    if (boardPage && boardPage.kind === "pdf" && boardPage.pdfPage === clampedPage) {
      boardPage.pdfContentBounds = {
        x: (maxWidth - viewport.width) / 2,
        y: (maxHeight - viewport.height) / 2,
        width: viewport.width,
        height: viewport.height
      };
    }
    const initiallyFitted = typeof fitBoardPageAfterPdfRender === "function" && fitBoardPageAfterPdfRender(boardPage);
    const zoomAdjusted = !initiallyFitted && typeof enforcePdfZoomMinimum === "function" && enforcePdfZoomMinimum();
    if (!zoomAdjusted) renderBoardBackground();
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
    renderPdfPage(pdfPageNumber);
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

    pdfPageStrokeSnapshots.clear();
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

    await renderPdfPage(1);
    if (!pdfPageRasterCanvas) throw new Error("PDF page rendering failed.");
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
  pixelRatio = Math.min(quality.dprCap, Math.max(1, window.devicePixelRatio || 1));
  const wasFitted = typeof isCurrentBoardPageFitted === "function"
    && isCurrentBoardPageFitted(previousRect, previousPixelRatio);
  const nextWidth = Math.max(1, Math.floor(rect.width * pixelRatio));
  const nextHeight = Math.max(1, Math.floor(rect.height * pixelRatio));

  if (
    nextWidth === previousWidth
    && nextHeight === previousHeight
    && nextWidth === previousBackgroundWidth
    && nextHeight === previousBackgroundHeight
    && pixelRatio === previousPixelRatio
  ) {
    lastCanvasCssViewport = { width: rect.width, height: rect.height };
    if (typeof refitBoardPageAfterViewportResize === "function") {
      refitBoardPageAfterViewportResize(previousRect, previousPixelRatio);
    }
    if (typeof enforcePdfZoomMinimum === "function") enforcePdfZoomMinimum();
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
  const width = tool === "eraser" ? Number(eraserWidthInput.value) : Number(lineWidthInput.value);
  ctx.lineWidth = Math.max(1, width * pixelRatio);
}

function redrawVisibleStrokesWithActive() {
  redrawAllStrokes();
  if (!activeStroke) return;
  ctx.setTransform(boardCamera.scale, 0, 0, boardCamera.scale, pixelRatio * boardCamera.x, pixelRatio * boardCamera.y);
  drawStrokePath(activeStroke);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
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
  lastMidPoint = point;
  filteredPoint = point;
  clearPendingPoints();
  frameRequested = false;
  activeStroke = createStrokeRecord(tool === "eraser" ? "pixel-eraser" : "pen", point);

  ctx.setTransform(boardCamera.scale, 0, 0, boardCamera.scale, pixelRatio * boardCamera.x, pixelRatio * boardCamera.y);
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

  redrawAllStrokes();

  updateUndoRedoUI();
}

function handlePointerDown(event) {
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
    return;
  }

  saveUndoSnapshotForCurrentContext();
  strokes.length = 0;
  redrawAllStrokes();
  finalizeStrokeMutation();
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

