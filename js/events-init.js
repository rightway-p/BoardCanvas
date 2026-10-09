penToolButton.addEventListener("click", async () => {
  if (overlayMousePassthrough) {
    await setOverlayMousePassthrough(false, {
      announce: false,
      restoreFocus: true
    });
  }
  closeEraserToolPopup();
  if (tool === "eraser" || tool === "strokeEraser") {
    setPanMode(false);
    tool = "pen";
  } else {
    setPanMode(!panMode);
  }
  updateToolUI();
});

eraserToolButton.addEventListener("click", async (event) => {
  event.stopPropagation();
  if (overlayMousePassthrough) {
    await setOverlayMousePassthrough(false, {
      announce: false,
      restoreFocus: true
    });
  }
  if (tool === "eraser" || tool === "strokeEraser") {
    setEraserToolPopupOpen(!isEraserToolPopupOpen());
    placeToolbarPopup(eraserToolButton, eraserToolPopup);
    return;
  }

  setPanMode(false);
  tool = eraserMode;
  closeEraserToolPopup();
  updateToolUI();
});

pixelEraserModeButton.addEventListener("click", async () => {
  if (overlayMousePassthrough) {
    await setOverlayMousePassthrough(false, {
      announce: false,
      restoreFocus: true
    });
  }
  setPanMode(false);
  applyEraserMode("eraser", true);
  tool = eraserMode;
  closeEraserToolPopup();
  updateToolUI();
});

strokeEraserModeButton.addEventListener("click", async () => {
  if (overlayMousePassthrough) {
    await setOverlayMousePassthrough(false, {
      announce: false,
      restoreFocus: true
    });
  }
  setPanMode(false);
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
if (overlayMouseModeToggleButton) {
  overlayMouseModeToggleButton.addEventListener("click", () => {
    toggleOverlayMouseMode();
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
    selectSettingsCategory("documents");
  }
});
document.getElementById("closeSettingsButton").addEventListener("click", closeDocumentPopup);
documentPopup.addEventListener("click", (event) => {
  if (event.target === documentPopup) closeDocumentPopup();
});

documentLoadButton.addEventListener("click", requestDocumentFileSelection);
removeDocumentButton.addEventListener("click", () => {
  void unloadPdfDocument(true).then(() => clearActiveDrivePin());
});

documentInput.addEventListener("change", handleDocumentInputChange);
openBoardColorPopupButton.addEventListener("click", (event) => {
  event.stopPropagation();
  setBoardColorPopupOpen(!isBoardColorPopupOpen());
  placeToolbarPopup(openBoardColorPopupButton, boardColorPopup);
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

if (penOpacityInput) {
  penOpacityInput.addEventListener("input", () => {
    penOpacity = normalizePenOpacity(Number(penOpacityInput.value) / 100, 1);
    saveStoredOpacity(LAST_PEN_OPACITY_STORAGE_KEY, penOpacity);
    updatePenPresetSelection();
    window.renderPenPaletteSettings?.();
  });
}

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

// Prevent default context menu on canvas (block right-click menu)
canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});
document.addEventListener("mousemove", (event) => {
  syncOverlayMouseBypassWithPointerEvent(event);
}, { passive: true });

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
  syncOverlayMouseBypassWithPointerEvent(event);
  if (document.getElementById("penColorPicker")?.open || document.getElementById("releaseNotesDialog")?.open) return;
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
  const developerSettings = document.getElementById("developerSettings");
  if (developerSettings && !developerSettings.hidden) return;
  if (document.getElementById("penColorPicker")?.open || document.getElementById("releaseNotesDialog")?.open) return;
  if (isDocumentPopupOpen()) {
    if (event.key === "Tab") {
      const focusable = [...documentPopup.querySelectorAll("button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])")]
        .filter((element) => !element.hidden && !element.closest("[hidden], .is-hidden")
          && element.getAttribute("aria-hidden") !== "true" && element.getClientRects().length > 0);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (!first) { event.preventDefault(); document.getElementById("closeSettingsButton").focus(); return; }
      if (!focusable.includes(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); return; }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); return; }
    }
    const key = String(event.key || "").toLowerCase();
    if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(key)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (["F7", "F8", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
  }
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

  if (!editableTarget && event.key === "F7" && isOverlayMouseModeSupported()) {
    event.preventDefault();
    toggleOverlayMouseMode();
    return;
  }

  if (!editableTarget && typeof boardPageSequence !== "undefined" && boardPageSequence.length > 1) {
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      goToPreviousPdfPage();
      return;
    }

    if (event.key === "ArrowRight" || event.key ==="ArrowUp") {
      event.preventDefault();
      goToNextPdfPage();
      return;
    }
  }

  if (event.key === "Escape") {
    if (typeof pageManagerOpen !== "undefined" && pageManagerOpen) { event.preventDefault(); openPageManager(false); return; }
    if (isDocumentPopupOpen()) {
      event.preventDefault();
      closeDocumentPopup();
      return;
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

setupRuntimeErrorLogging();
void primeRuntimeLogPath();
void installOverlayWindowClosedListener();
queueRuntimeLog("runtime.start", {
  runtimePlatform,
  protocol: String((window.location && window.location.protocol) || ""),
  tauriDetected: Boolean(window.__TAURI__),
  buildTag: RUNTIME_BUILD_TAG
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
  setDocumentStatus("Desktop bridge not detected. Running in compatibility mode.", "warning");
}
queueRuntimeLog("runtime.ui.ready", {
  desktopRuntime: isDesktopAppRuntime(),
  overlaySupported: isOverlayModeSupported()
});
window.boardRestorePromise = restoreSessionState();

if (isDedicatedOverlayWindow()) {
  window.setTimeout(() => {
    if (!overlayMode && !overlayTransitionInProgress && isOverlayModeSupported()) {
      void enterOverlayMode();
    }
  }, 40);
}

window.addEventListener("beforeunload", () => {
  if (isDedicatedOverlayWindow()) {
    void emitTauriRuntimeEvent(OVERLAY_WINDOW_CLOSED_EVENT, {
      source: OVERLAY_WINDOW_LABEL,
      reason: "beforeunload"
    });
  }
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

