let closePenPresetOverflow = null;

function getCurrentPenPresetSnapshot() {
  return {
    color: normalizeHexColor(penColorInput.value) || DEFAULT_PEN_PRESETS[0].color,
    width: normalizeLineWidth(lineWidthInput.value),
    opacity: normalizePenOpacity(penOpacity, 1),
    type: currentPenType
  };
}

function isSamePenPreset(a, b) {
  if (!a || !b) {
    return false;
  }

  return a.color === b.color
    && Number(a.width) === Number(b.width)
    && Number(a.opacity) === Number(b.opacity)
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
  window.renderPenPaletteSettings?.();
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
  penOpacity = normalizePenOpacity(normalized.opacity, 1);
  if (penOpacityInput) penOpacityInput.value = String(Math.round(penOpacity * 100));
  if (persist) saveStoredOpacity(LAST_PEN_OPACITY_STORAGE_KEY, penOpacity);
  updatePenPresetSelection();
  window.renderPenPaletteSettings?.();
}

function saveCurrentPenPreset(index) {
  if (index < 0 || index >= penPresets.length) {
    return;
  }

  penPresets[index] = getCurrentPenPresetSnapshot();
  savePenPresets(PEN_PRESET_STORAGE_KEY, penPresets);
  renderPenPresets();
}

function addPenPreset(preset = {}) {
  const normalized = normalizePenPreset({
    color: preset.color || penColorInput.value,
    width: preset.width ?? 2,
    opacity: preset.opacity ?? penOpacity,
    type: preset.type || currentPenType
  }, DEFAULT_PEN_PRESETS[0]);
  penPresets.push(normalized);
  savePenPresets(PEN_PRESET_STORAGE_KEY, penPresets);
  renderPenPresets();
  return penPresets.length - 1;
}

function removePenPreset(index) {
  const normalizedIndex = Math.floor(Number(index));
  if (normalizedIndex < 0 || normalizedIndex >= penPresets.length) return false;
  penPresets.splice(normalizedIndex, 1);
  savePenPresets(PEN_PRESET_STORAGE_KEY, penPresets);
  renderPenPresets();
  return true;
}

function openPenPresetEditor(index, anchor) {
  const preset = penPresets[index];
  if (!preset) return;
  document.querySelector(".pen-preset-editor")?.remove();
  const editor = document.createElement("div");
  editor.className = "pen-preset-editor";
  editor.setAttribute("role", "dialog");
  editor.setAttribute("aria-label", `펜 프리셋 ${index + 1} 편집`);
  editor.innerHTML = `<label>색 <button data-color-open type="button" class="pen-editor-color-button">색 선택</button></label><label>굵기 <input data-width type="number" min="1" max="40" step="1" value="${preset.width}"></label><div><button data-cancel type="button">취소</button><button data-save type="button">저장</button></div>`;
  document.body.append(editor);
  const rect = anchor.getBoundingClientRect();
  const box = editor.getBoundingClientRect();
  editor.style.left = `${Math.max(8, Math.min(window.innerWidth - box.width - 8, rect.left))}px`;
  editor.style.top = `${Math.max(8, Math.min(window.innerHeight - box.height - 8, rect.bottom + 6))}px`;
  editor.querySelector("[data-cancel]").onclick = () => editor.remove();
  editor.querySelector("[data-color-open]").onclick = () => {
    window.openSharedPenPicker?.("palette", index, () => {
      const width = Math.max(1, Math.min(40, Math.round(Number(editor.querySelector("[data-width]")?.value) || penPresets[index].width)));
      penPresets[index] = { ...penPresets[index], width };
      savePenPresets(PEN_PRESET_STORAGE_KEY, penPresets);
      editor.remove(); renderPenPresets();
    });
  };
  editor.querySelector("[data-save]").onclick = () => {
    const width = Math.max(1, Math.min(40, Math.round(Number(editor.querySelector("[data-width]").value) || preset.width)));
    penPresets[index] = { ...penPresets[index], width };
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
  closePenPresetOverflow?.();

  penPresetsContainer.innerHTML = "";

  const extraButtons = [];
  penPresets.forEach((preset, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "color-preset pen-preset";
    button.style.backgroundColor = `rgba(${parseInt(preset.color.slice(1, 3), 16)}, ${parseInt(preset.color.slice(3, 5), 16)}, ${parseInt(preset.color.slice(5, 7), 16)}, ${normalizePenOpacity(preset.opacity, 1)})`;
    button.style.setProperty("--pen-line-size", `${Math.max(2, Math.min(12, preset.width))}px`);
    button.style.setProperty("--pen-line-color", getContrastColor(preset.color));
    button.setAttribute("aria-label", `pen preset ${index + 1}`);
    button.title = `탭: 적용 · 3초 누르기: 색/굵기/불투명도 편집`;
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
      closePenPresetOverflow?.();
    });

    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      saveCurrentPenPreset(index);
    });

    if (index >= 4) {
      button.hidden = true;
      extraButtons.push(button);
    } else {
      penPresetsContainer.appendChild(button);
    }
  });

  if (extraButtons.length > 0) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "color-preset pen-preset-more";
    more.textContent = "…";
    more.setAttribute("aria-label", "추가 팔레트 보기");
    more.title = "추가 팔레트 보기";
    more.addEventListener("click", () => {
      closePenPresetOverflow?.();
      const popup = document.createElement("div");
      popup.className = "pen-preset-overflow-popover";
      popup.setAttribute("role", "menu");
      extraButtons.forEach((source) => {
        source.hidden = false;
        source.setAttribute("role", "menuitem");
        popup.appendChild(source);
      });
      document.body.appendChild(popup);
      const rect = more.getBoundingClientRect();
      popup.style.left = `${Math.max(8, Math.min(window.innerWidth - popup.offsetWidth - 8, rect.left))}px`;
      popup.style.top = `${Math.max(8, Math.min(window.innerHeight - popup.offsetHeight - 8, rect.bottom + 6))}px`;
      const close = (event) => {
        if (event.type === "keydown" && event.key !== "Escape") return;
        if (event.type !== "keydown" && popup.contains(event.target)) return;
        extraButtons.forEach((button) => { button.hidden = true; penPresetsContainer.appendChild(button); });
        popup.remove(); more.setAttribute("aria-expanded", "false");
        document.removeEventListener("pointerdown", close, true); document.removeEventListener("keydown", close, true);
        closePenPresetOverflow = null;
      };
      closePenPresetOverflow = () => close({ type: "outside", target: document.body });
      document.addEventListener("pointerdown", close, true);
      document.addEventListener("keydown", close, true);
      more.setAttribute("aria-expanded", "true");
    });
    more.setAttribute("aria-expanded", "false");
    penPresetsContainer.appendChild(more);
  }

  updatePenPresetSelection();
  window.renderPenPaletteSettings?.();
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
  const initialPenOpacity = loadStoredOpacity(LAST_PEN_OPACITY_STORAGE_KEY, penOpacity);
  const initialEraserWidth = loadStoredEraserWidth(LAST_ERASER_WIDTH_STORAGE_KEY, eraserWidthInput.value);
  const initialEraserMode = loadStoredEraserMode(LAST_ERASER_MODE_STORAGE_KEY, eraserMode);
  const initialBoardColor = loadStoredColor(LAST_BOARD_COLOR_STORAGE_KEY, boardColorInput.value);

  applyPenColor(initialPenColor, false);
  applyPenWidth(initialPenWidth, false);
  penOpacity = initialPenOpacity;
  if (penOpacityInput) penOpacityInput.value = String(Math.round(penOpacity * 100));
  applyEraserWidth(initialEraserWidth, false);
  applyEraserMode(initialEraserMode, false);
  applyBoardColor(initialBoardColor, false);
}
