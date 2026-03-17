function detectLowSpecDevice() {
  const cores = Number(navigator.hardwareConcurrency || 4);
  const memory = Number(navigator.deviceMemory || 4);
  return cores <= 2 || memory <= 2;
}

function normalizeHexColor(color) {
  if (typeof color !== "string") {
    return "";
  }

  const normalized = color.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : "";
}

function normalizeWidth(width, inputElement) {
  const min = Number(inputElement.min || 1);
  const max = Number(inputElement.max || 40);
  const numeric = Number(width);
  if (!Number.isFinite(numeric)) {
    return min;
  }

  const rounded = Math.round(numeric);
  return Math.min(max, Math.max(min, rounded));
}

function normalizeLineWidth(width) {
  return normalizeWidth(width, lineWidthInput);
}

function normalizeEraserWidth(width) {
  return normalizeWidth(width, eraserWidthInput);
}

function normalizeEraserMode(mode, fallbackMode = "eraser") {
  if (mode === "eraser" || mode === "strokeEraser") {
    return mode;
  }

  return fallbackMode;
}

function getContrastColor(hex) {
  const value = normalizeHexColor(hex);
  if (!value) {
    return "#ffffff";
  }

  const red = Number.parseInt(value.slice(1, 3), 16);
  const green = Number.parseInt(value.slice(3, 5), 16);
  const blue = Number.parseInt(value.slice(5, 7), 16);
  const luminance = (0.299 * red) + (0.587 * green) + (0.114 * blue);
  return luminance >= 160 ? "#202020" : "#f5f5f5";
}

function clonePenPreset(preset) {
  return {
    color: preset.color,
    width: preset.width,
    type: preset.type
  };
}

function normalizePenPreset(value, fallbackPreset) {
  const fallback = fallbackPreset || DEFAULT_PEN_PRESETS[0];

  if (typeof value === "string") {
    const color = normalizeHexColor(value) || fallback.color;
    return {
      color,
      width: fallback.width,
      type: fallback.type
    };
  }

  if (!value || typeof value !== "object") {
    return clonePenPreset(fallback);
  }

  const color = normalizeHexColor(value.color) || fallback.color;
  const width = normalizeLineWidth(value.width ?? fallback.width);
  const type = (typeof value.type === "string" && value.type.trim())
    ? value.type.trim()
    : fallback.type;

  return { color, width, type };
}

function loadColorPresets(storageKey, defaults) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [...defaults];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== defaults.length) {
      return [...defaults];
    }

    const normalized = parsed.map(normalizeHexColor);
    if (normalized.some((color) => color === "")) {
      return [...defaults];
    }

    return normalized;
  } catch (error) {
    return [...defaults];
  }
}

function saveColorPresets(storageKey, colors) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(colors));
  } catch (error) {
    // localStorage unavailable: skip persistence.
  }
}

function loadPenPresets(storageKey, defaults) {
  const fallback = defaults.map(clonePenPreset);

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return fallback;
    }

    const normalized = defaults.map((defaultPreset, index) => {
      return normalizePenPreset(parsed[index], defaultPreset);
    });

    return normalized;
  } catch (error) {
    return fallback;
  }
}

function savePenPresets(storageKey, presets) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(presets));
  } catch (error) {
    // localStorage unavailable: skip persistence.
  }
}

function loadStoredColor(storageKey, fallbackColor) {
  const normalizedFallback = normalizeHexColor(fallbackColor);
  try {
    const raw = window.localStorage.getItem(storageKey);
    const normalized = normalizeHexColor(raw);
    return normalized || normalizedFallback;
  } catch (error) {
    return normalizedFallback;
  }
}

function saveStoredColor(storageKey, color) {
  const normalized = normalizeHexColor(color);
  if (!normalized) {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, normalized);
  } catch (error) {
    // localStorage unavailable: skip persistence.
  }
}

function loadStoredLineWidth(storageKey, fallbackWidth) {
  const normalizedFallback = normalizeLineWidth(fallbackWidth);
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return normalizedFallback;
    }
    return normalizeLineWidth(parsed);
  } catch (error) {
    return normalizedFallback;
  }
}

function saveStoredLineWidth(storageKey, width) {
  const normalized = normalizeLineWidth(width);
  try {
    window.localStorage.setItem(storageKey, String(normalized));
  } catch (error) {
    // localStorage unavailable: skip persistence.
  }
}

function loadStoredEraserWidth(storageKey, fallbackWidth) {
  const normalizedFallback = normalizeEraserWidth(fallbackWidth);
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return normalizedFallback;
    }
    return normalizeEraserWidth(parsed);
  } catch (error) {
    return normalizedFallback;
  }
}

function saveStoredEraserWidth(storageKey, width) {
  const normalized = normalizeEraserWidth(width);
  try {
    window.localStorage.setItem(storageKey, String(normalized));
  } catch (error) {
    // localStorage unavailable: skip persistence.
  }
}

function loadStoredEraserMode(storageKey, fallbackMode) {
  const normalizedFallback = normalizeEraserMode(fallbackMode);
  try {
    const raw = window.localStorage.getItem(storageKey);
    return normalizeEraserMode(raw, normalizedFallback);
  } catch (error) {
    return normalizedFallback;
  }
}

function saveStoredEraserMode(storageKey, mode) {
  const normalized = normalizeEraserMode(mode);
  try {
    window.localStorage.setItem(storageKey, normalized);
  } catch (error) {
    // localStorage unavailable: skip persistence.
  }
}
