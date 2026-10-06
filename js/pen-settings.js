(() => {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
  const normalizeHex = value => /^#[0-9a-f]{6}$/i.test(String(value).trim()) ? String(value).trim().toLowerCase() : null;
  const rgba = (hex, opacity) => {
    const value = hex.slice(1);
    return `rgba(${parseInt(value.slice(0, 2), 16)},${parseInt(value.slice(2, 4), 16)},${parseInt(value.slice(4, 6), 16)},${clamp(opacity, 0, 1)})`;
  };
  const hsvFromHex = hex => {
    const rgb = [0, 2, 4].map(i => parseInt(hex.slice(1 + i, 3 + i), 16) / 255);
    const max = Math.max(...rgb), min = Math.min(...rgb), d = max - min;
    let h = 0;
    if (d) h = max === rgb[0] ? 60 * (((rgb[1] - rgb[2]) / d) % 6) : max === rgb[1] ? 60 * ((rgb[2] - rgb[0]) / d + 2) : 60 * ((rgb[0] - rgb[1]) / d + 4);
    return { h: (h + 360) % 360, s: max ? d / max * 100 : 0, v: max * 100 };
  };
  const hexFromHsv = (h, s, v) => {
    s /= 100; v /= 100;
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return `#${rgb.map(value => Math.round((value + m) * 255).toString(16).padStart(2, "0")).join("")}`;
  };
  let pickerTarget = null;
  let pickerCallback = null;
  let pickerCloseCallback = null;
  let pickerDraft = { color: "#111111", opacity: 1, hsv: hsvFromHex("#111111") };
  const pickerElements = () => ({ dialog: document.getElementById("penColorPicker"), sv: document.getElementById("penPickerSv"), cursor: document.getElementById("penPickerCursor"), hue: document.getElementById("penPickerHue"), hex: document.getElementById("penPickerHex"), opacity: document.getElementById("penPickerOpacity"), opacityValue: document.getElementById("penPickerOpacityValue"), preview: document.getElementById("penPickerPreview") });
  function updatePicker() {
    const el = pickerElements();
    if (!el.dialog) return;
    el.hue.value = String(pickerDraft.hsv.h);
    el.hex.value = pickerDraft.color;
    el.opacity.value = String(Math.round((1 - pickerDraft.opacity) * 100));
    el.opacityValue.value = `${el.opacity.value}%`;
    el.sv.style.background = `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,transparent),hsl(${pickerDraft.hsv.h} 100% 50%)`;
    el.cursor.style.left = `${pickerDraft.hsv.s}%`;
    el.cursor.style.top = `${100 - pickerDraft.hsv.v}%`;
    el.preview.style.setProperty("--pen-picker-rgba", rgba(pickerDraft.color, pickerDraft.opacity));
  }
  function openPicker(target, index, onApplied = null) {
    pickerTarget = { type: target, index };
    pickerCallback = typeof onApplied === "function" ? onApplied : null;
    const source = target === "current" ? { color: penColorInput.value, opacity: penOpacity } : penPresets[index];
    pickerDraft = { color: source.color, opacity: normalizePenOpacity(source.opacity, 1), hsv: hsvFromHex(source.color) };
    updatePicker();
    pickerElements().dialog.showModal();
  }
  function openExternalPicker(options = {}) {
    pickerTarget = { type: "external", index: -1 };
    pickerCallback = typeof options.onApply === "function" ? () => options.onApply({ color: pickerDraft.color, opacity: pickerDraft.opacity }) : null;
    pickerCloseCallback = typeof options.onClose === "function" ? options.onClose : null;
    const color = normalizeHex(options.color) || "#111111";
    pickerDraft = { color, opacity: normalizePenOpacity(options.opacity, 1), hsv: hsvFromHex(color) };
    updatePicker();
    pickerElements().dialog.showModal();
  }
  function applyPicker() {
    if (!pickerTarget) return;
    if (pickerTarget.type === "external") {
      const callback = pickerCallback;
      pickerTarget = null; pickerCallback = null; pickerCloseCallback = null;
      pickerElements().dialog.close();
      callback?.();
      return;
    }
    if (pickerTarget.type === "current") {
      applyPenColor(pickerDraft.color, true);
      penOpacity = pickerDraft.opacity;
      if (penOpacityInput) penOpacityInput.value = String(Math.round(penOpacity * 100));
      saveStoredOpacity(LAST_PEN_OPACITY_STORAGE_KEY, penOpacity);
      updatePenPresetSelection();
    } else if (penPresets[pickerTarget.index]) {
      penPresets[pickerTarget.index] = { ...penPresets[pickerTarget.index], color: pickerDraft.color, opacity: pickerDraft.opacity };
      savePenPresets(PEN_PRESET_STORAGE_KEY, penPresets);
      renderPenPresets();
    }
    const callback = pickerCallback;
    pickerTarget = null;
    pickerCallback = null;
    pickerElements().dialog.close();
    renderPaletteSettings();
    callback?.();
  }
  function renderPaletteSettings() {
    const currentButton = document.getElementById("openPenColorButton");
    if (currentButton) {
      currentButton.textContent = "";
      currentButton.style.backgroundImage = `linear-gradient(${rgba(penColorInput.value, penOpacity)},${rgba(penColorInput.value, penOpacity)}),conic-gradient(#d8dee7 25%,#fff 0 50%,#d8dee7 0 75%,#fff 0)`;
      currentButton.style.backgroundSize = "auto,8px 8px";
      currentButton.setAttribute("aria-label", `현재 펜 색 선택 ${penColorInput.value}`);
    }
    const mount = document.getElementById("penPaletteSettingsContent");
    if (!mount) return;
    mount.innerHTML = "";
    const root = document.createElement("div");
    root.className = "pen-palette-settings";
    const list = document.createElement("div");
    list.className = "pen-palette-list";
    penPresets.forEach((preset, index) => {
      const item = document.createElement("div");
      item.className = "pen-palette-item";
      const swatch = document.createElement("button");
      swatch.className = "pen-palette-swatch";
      swatch.type = "button";
      swatch.style.setProperty("--pen-swatch-rgba", rgba(preset.color, normalizePenOpacity(preset.opacity, 1)));
      swatch.setAttribute("aria-label", `팔레트 ${index + 1} 적용`);
      swatch.addEventListener("click", () => { applyPenPreset(preset, true); renderPaletteSettings(); });
      const width = document.createElement("input");
      width.type = "number"; width.min = "1"; width.max = "40"; width.step = "1"; width.value = String(preset.width); width.setAttribute("aria-label", `팔레트 ${index + 1} 굵기`);
      width.addEventListener("change", () => { penPresets[index] = { ...penPresets[index], width: Math.max(1, Math.min(40, Math.round(Number(width.value) || preset.width))) }; savePenPresets(PEN_PRESET_STORAGE_KEY, penPresets); renderPenPresets(); renderPaletteSettings(); });
      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "편집";
      edit.addEventListener("click", () => openPicker("palette", index));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "삭제";
      remove.addEventListener("click", () => { removePenPreset(index); renderPaletteSettings(); });
      item.append(swatch, width, edit, remove);
      list.append(item);
    });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "document-action-button";
    add.textContent = "+ 색 추가";
    add.addEventListener("click", () => { addPenPreset({ color: penColorInput.value, width: 2, opacity: penOpacity }); renderPaletteSettings(); });
    const current = document.createElement("p");
    current.className = "document-status";
    current.textContent = `현재 펜 ${penColorInput.value} · ${lineWidthInput.value}px · 불투명도 ${Math.round(penOpacity * 100)}%`;
    root.append(list, add, current);
    mount.append(root);
  }
  function init() {
    document.getElementById("openPenColorButton")?.addEventListener("click", () => openPicker("current", -1));
    const el = pickerElements();
    document.getElementById("cancelPenPicker")?.addEventListener("click", () => { const close = pickerCloseCallback; pickerCloseCallback = null; pickerTarget = null; pickerCallback = null; el.dialog.close(); close?.(); });
    el.dialog?.addEventListener("cancel", (event) => { event.preventDefault(); const close = pickerCloseCallback; pickerCloseCallback = null; pickerTarget = null; pickerCallback = null; el.dialog.close(); close?.(); });
    document.getElementById("applyPenPicker")?.addEventListener("click", applyPicker);
    el.hue?.addEventListener("input", event => { pickerDraft.hsv.h = Number(event.target.value); pickerDraft.color = hexFromHsv(pickerDraft.hsv.h, pickerDraft.hsv.s, pickerDraft.hsv.v); updatePicker(); });
    el.hex?.addEventListener("change", event => { const color = normalizeHex(event.target.value); if (color) { pickerDraft.color = color; pickerDraft.hsv = hsvFromHex(color); updatePicker(); } else event.target.value = pickerDraft.color; });
    el.opacity?.addEventListener("input", event => { pickerDraft.opacity = 1 - clamp(event.target.value, 0, 100) / 100; updatePicker(); });
    el.sv?.addEventListener("pointerdown", event => { const rect = el.sv.getBoundingClientRect(); pickerDraft.hsv.s = clamp((event.clientX - rect.left) / rect.width * 100, 0, 100); pickerDraft.hsv.v = clamp((1 - (event.clientY - rect.top) / rect.height) * 100, 0, 100); pickerDraft.color = hexFromHsv(pickerDraft.hsv.h, pickerDraft.hsv.s, pickerDraft.hsv.v); updatePicker(); });
    window.renderPenPaletteSettings = renderPaletteSettings;
    window.openSharedPenPicker = openPicker;
    window.BoardPenColorPicker = { open: openExternalPicker };
    window.BoardSetupPalette = {
      read: () => penPresets.map((preset) => ({ ...preset })),
      open: () => { openDocumentPopupButton?.click(); if (typeof selectSettingsCategory === "function") selectSettingsCategory("pen"); renderPaletteSettings(); }
    };
    renderPaletteSettings();
  }
  window.setTimeout(init, 0);
})();
