function updateToolUI() {
  const mouseModeActive = overlayMousePassthrough;
  penToolButton.classList.toggle("is-active", !mouseModeActive && tool === "pen");
  const eraserSelected = tool === "eraser" || tool === "strokeEraser";
  eraserToolButton.classList.toggle("is-active", !mouseModeActive && eraserSelected);
  pixelEraserModeButton.classList.toggle("is-active", eraserMode === "eraser");
  strokeEraserModeButton.classList.toggle("is-active", eraserMode === "strokeEraser");
  const modeText = mouseModeActive
    ? "Mouse"
    : (tool === "pen"
      ? "Pen"
      : (tool === "eraser" ? "Eraser" : "StrokeEraser"));
  modeLabel.textContent = `Mode: ${modeText}${qualityLevel === "low" ? " | LowSpec" : ""}`;
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

  if (!(await ensurePdfExportEngineAvailable())) {
    return;
  }

  saveCurrentStrokeState();
  pdfExportInProgress = true;
  updatePdfNavigationUI();

  const hasPdf = hasLoadedPdfDocument();
  const statusName = hasPdf ? (loadedDocumentName || "PDF") : "Board";
  const totalPages = hasPdf ? Math.max(1, Number(pdfDocument.numPages) || 1) : 1;
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

      if (hasPdf) {
        await drawPdfPageToContext(pageNumber, mergedContext, exportWidth, exportHeight);
      }

      annotationContext.setTransform(1, 0, 0, 1, 0, 0);
      annotationContext.globalCompositeOperation = "source-over";
      annotationContext.clearRect(0, 0, exportWidth, exportHeight);
      annotationContext.lineJoin = "round";
      annotationContext.lineCap = "round";

      const pageStrokes = hasPdf
        ? (pdfPageStrokeSnapshots.get(pageNumber) || [])
        : boardStrokeSnapshot;
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

  if (!(await configurePdfWorker())) {
    return;
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

  try {
    const source = await file.arrayBuffer();
    if (token !== pdfLoadingToken) {
      queueRuntimeLog("pdf.load.canceled", { fileName, token, reason: "token-mismatch-before-open" });
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
    await releasePdfDocument(previousDocument);
    clearAllStrokeHistory();
    scheduleSessionAutosave();
  } catch (error) {
    if (token !== pdfLoadingToken) {
      queueRuntimeLog("pdf.load.canceled", { fileName, token, reason: "token-mismatch-on-error" });
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
    queueRuntimeLog("pdf.load.failed", {
      fileName,
      error: toRuntimeLogError(error),
      reason: trimRuntimeLogValue(reason || "")
    });
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
  if (overlayMousePassthrough) {
    return;
  }

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
  const normalized = normalizeHexColor(color);
  if (overlayMode) {
    backgroundCanvas.style.backgroundColor = "transparent";
    return;
  }
  backgroundCanvas.style.backgroundColor = normalized || color || "transparent";
}

