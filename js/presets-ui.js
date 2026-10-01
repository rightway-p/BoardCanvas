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
  if (typeof currentBoardPage === "function" && currentBoardPage()?.kind === "blank") currentBoardPage().background = normalized;
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

function openPenPresetEditor(index, anchor) {
  const preset = penPresets[index];
  if (!preset) return;
  document.querySelector(".pen-preset-editor")?.remove();
  const editor = document.createElement("div");
  editor.className = "pen-preset-editor";
  editor.setAttribute("role", "dialog");
  editor.setAttribute("aria-label", `펜 프리셋 ${index + 1} 편집`);
  editor.innerHTML = `<label>색 <input data-color type="color" value="${preset.color}"></label><label>굵기 <input data-width type="number" min="1" max="40" step="1" value="${preset.width}"></label><div><button data-cancel type="button">취소</button><button data-save type="button">저장</button></div>`;
  document.body.append(editor);
  const rect = anchor.getBoundingClientRect();
  const box = editor.getBoundingClientRect();
  editor.style.left = `${Math.max(8, Math.min(window.innerWidth - box.width - 8, rect.left))}px`;
  editor.style.top = `${Math.max(8, Math.min(window.innerHeight - box.height - 8, rect.bottom + 6))}px`;
  editor.querySelector("[data-cancel]").onclick = () => editor.remove();
  editor.querySelector("[data-save]").onclick = () => {
    const width = Math.max(1, Math.min(40, Math.round(Number(editor.querySelector("[data-width]").value) || preset.width)));
    const color = normalizeHexColor(editor.querySelector("[data-color]").value) || preset.color;
    penPresets[index] = { ...preset, color, width };
    savePenPresets(PEN_PRESET_STORAGE_KEY, penPresets);
    editor.remove(); renderPenPresets();
  };
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
    button.title = `탭: 적용 · 3초 누르기: 색/굵기 편집`;
    let holdTimer = null;
    let held = false;
    let holdStart = null;
    button.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary) return;
      held = false;
      holdStart = { x: event.clientX, y: event.clientY };
      if (button.setPointerCapture) button.setPointerCapture(event.pointerId);
      holdTimer = window.setTimeout(() => { held = true; button.classList.add("is-hold-editing"); openPenPresetEditor(index, button); }, (typeof devSettings === "object" ? devSettings.presetHoldMs : 3000));
    });
    button.addEventListener("pointermove", (event) => {
      if (!holdTimer || !holdStart || Math.hypot(event.clientX - holdStart.x, event.clientY - holdStart.y) <= ((typeof devSettings === "object" && devSettings.movementThreshold) || 12)) return;
      window.clearTimeout(holdTimer); holdTimer = null;
    });
    const finishHold = (event) => {
      window.clearTimeout(holdTimer); holdTimer = null; holdStart = null;
      if (button.hasPointerCapture && button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
      window.setTimeout(() => { button.classList.remove("is-hold-editing"); held = false; }, 0);
    };
    button.addEventListener("pointerup", finishHold);
    button.addEventListener("pointercancel", (event) => { finishHold(event); held = false; });

    button.addEventListener("click", (event) => {
      if (held) { held = false; return; }
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
    button.title = "탭: 적용 · Shift+탭/우클릭: 현재 배경색 저장";

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
