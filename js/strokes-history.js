function saveUndoSnapshotForCurrentContext() {
  if (typeof cancelHistoryTouchTaps === "function") cancelHistoryTouchTaps();
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
  if (typeof cancelHistoryTouchTaps === "function") cancelHistoryTouchTaps();
  if (pdfExportInProgress || drawing || strokeEraserActive || sessionRestoreInProgress) {
    return false;
  }

  const entry = getOrCreateStrokeHistoryEntry();
  if (entry.undo.length <= 0) {
    updateUndoRedoUI();
    if (typeof showBoardAction === "function") showBoardAction("되돌릴 작업이 없습니다");
    return false;
  }

  pushStrokeSnapshot(entry.redo, cloneStrokeCollection(strokes));
  const previousSnapshot = entry.undo.pop();
  replaceVisibleStrokes(previousSnapshot);
  saveCurrentStrokeState();
  scheduleSessionAutosave();
  updateUndoRedoUI();
  if (typeof showBoardAction === "function") showBoardAction("실행 취소");
  return true;
}

function redoStrokeAction() {
  if (typeof cancelHistoryTouchTaps === "function") cancelHistoryTouchTaps();
  if (pdfExportInProgress || drawing || strokeEraserActive || sessionRestoreInProgress) {
    return false;
  }

  const entry = getOrCreateStrokeHistoryEntry();
  if (entry.redo.length <= 0) {
    updateUndoRedoUI();
    if (typeof showBoardAction === "function") showBoardAction("다시 실행할 작업이 없습니다");
    return false;
  }

  pushStrokeSnapshot(entry.undo, cloneStrokeCollection(strokes));
  const nextSnapshot = entry.redo.pop();
  replaceVisibleStrokes(nextSnapshot);
  saveCurrentStrokeState();
  scheduleSessionAutosave();
  updateUndoRedoUI();
  if (typeof showBoardAction === "function") showBoardAction("다시 실행");
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
  if (typeof currentBoardPage === "function" && currentBoardPage()) {
    saveBoardPageView();
    if (hasLoadedPdfDocument() && pdfPageNumber > 0) savePdfPageStrokeSnapshot(pdfPageNumber);
    return;
  }
  if (hasLoadedPdfDocument()) {
    savePdfPageStrokeSnapshot(pdfPageNumber);
    return;
  }

  boardStrokeSnapshot = cloneStrokeCollection(strokes);
}

function restoreCurrentStrokeState() {
  if (typeof currentBoardPage === "function" && currentBoardPage()) {
    replaceVisibleStrokes(currentBoardPage().strokes || []);
    return;
  }
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
