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
