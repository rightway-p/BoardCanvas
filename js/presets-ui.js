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
