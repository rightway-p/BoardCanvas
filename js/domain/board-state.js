(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BoardState = api;
})(typeof globalThis === "object" ? globalThis : window, function () {
  "use strict";

  const MAX_PDF_BYTES = 256 * 1024 * 1024;
  const MAX_SAVED_DOCUMENT_BYTES = 512 * 1024 * 1024;
  const MAX_WORK_FILE_BYTES = MAX_SAVED_DOCUMENT_BYTES;

  function isByteLengthWithinLimit(size, limit) {
    const bytes = Number(size);
    return Number.isFinite(bytes) && bytes >= 0 && bytes <= limit;
  }

  function base64DecodedByteLength(encodedLength, padding) {
    if (!Number.isSafeInteger(encodedLength) || encodedLength < 0 || encodedLength % 4 !== 0 || !Number.isInteger(padding) || padding < 0 || padding > 2 || padding > encodedLength) return null;
    return encodedLength * 3 / 4 - padding;
  }

  function isBase64WithinLimit(encoded, limit) {
    if (typeof encoded !== "string" || encoded.length > Math.ceil(limit / 3) * 4) return false;
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
    const decodedLength = base64DecodedByteLength(encoded.length, padding);
    return decodedLength !== null && decodedLength <= limit;
  }

  function createBlankPage(id, background = "#ffffff") {
    return { id, kind: "blank", background, strokes: [], view: null };
  }

  function createPageSequence(pdfPageCount) {
    const count = Math.max(0, Math.floor(Number(pdfPageCount) || 0));
    return count
      ? Array.from({ length: count }, (_, index) => ({ id: `pdf:${index + 1}`, kind: "pdf", pdfPage: index + 1, strokes: [], view: null, pdfWorldSize: null }))
      : [createBlankPage("blank:1")];
  }

  function canDeletePage(pages, index) {
    return Boolean(pages[index] && pages[index].kind === "blank" && pages.length > 1);
  }

  function applyStructureOperation(pages, operation, redo) {
    const page = pages[operation.index];
    if ((operation.action === "add" && !redo) || (operation.action === "delete" && redo)) {
      if (!page || page.kind !== "blank") return false;
      operation.page = structuredClone(page);
    }

    if (operation.action === "add") {
      if (redo) pages.splice(operation.index, 0, structuredClone(operation.page));
      else pages.splice(operation.index, 1);
    } else if (redo) {
      if (!canDeletePage(pages, operation.index)) return false;
      pages.splice(operation.index, 1);
    } else {
      if (!operation.page || operation.page.kind !== "blank") return false;
      pages.splice(operation.index, 0, structuredClone(operation.page));
    }
    return true;
  }

  function pointToWorld(point, camera) {
    return { x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale };
  }

  function zoomAt(camera, anchor, factor) {
    const scale = Math.max(0.2, Math.min(6, camera.scale * factor));
    const world = pointToWorld(anchor, camera);
    return { x: anchor.x - world.x * scale, y: anchor.y - world.y * scale, scale };
  }

  function canActivateZoomHold(elapsedMs, movement, threshold, durationMs) {
    return Number(elapsedMs) >= Number(durationMs) && Number(movement) <= Number(threshold);
  }

  function isActivePointer(activePointerId, eventPointerId) {
    return activePointerId !== null && activePointerId !== undefined && activePointerId === eventPointerId;
  }

  function normalizeTouchCalibration(value = {}) {
    const normalize = (key, fallback, min, max) => {
      const number = value[key];
      return typeof number === "number" && Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
    };
    return {
      panVectorTolerance: normalize("panVectorTolerance", 12, 1, 200),
      pinchActivationDistance: normalize("pinchActivationDistance", 12, 1, 200),
      pinchMinimumSeparation: normalize("pinchMinimumSeparation", 40, 8, 500),
    };
  }

  function measureTouchPair(initial, current, intent, thresholds) {
    const anchor = { x: (initial[0].x + initial[1].x) / 2, y: (initial[0].y + initial[1].y) / 2 };
    const midpoint = { x: (current[0].x + current[1].x) / 2, y: (current[0].y + current[1].y) / 2 };
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const vectorDifference = Math.hypot((current[0].x - initial[0].x) - (current[1].x - initial[1].x), (current[0].y - initial[0].y) - (current[1].y - initial[1].y));
    const midpointDisplacement = distance(midpoint, anchor);
    const initialSeparation = distance(initial[0], initial[1]), currentSeparation = distance(current[0], current[1]), spanDelta = currentSeparation - initialSeparation;
    const zoomAllowed = initialSeparation >= thresholds.pinchMinimumSeparation;
    const isPan = vectorDifference <= thresholds.panVectorTolerance && midpointDisplacement > 1;
    let classification = "대기";
    if ((intent === "auto" || intent === "pan") && isPan && (intent === "pan" || !zoomAllowed || Math.abs(spanDelta) < thresholds.pinchActivationDistance)) classification = intent === "pan" ? "이동 감지" : "pan";
    else if (intent !== "pan" && !zoomAllowed) classification = "초기 간격 부족";
    else if ((intent === "zoom-in" || intent === "auto") && spanDelta <= -thresholds.pinchActivationDistance) classification = intent === "zoom-in" ? "축소 감지" : "zoom-in";
    else if ((intent === "zoom-out" || intent === "auto") && spanDelta >= thresholds.pinchActivationDistance) classification = intent === "zoom-out" ? "확대 감지" : "zoom-out";
    else if (intent !== "pan" && Math.abs(spanDelta) >= thresholds.pinchActivationDistance) classification = "반대 방향";
    return { anchor, midpoint, midpointDisplacement, vectorDifference, initialSeparation, currentSeparation, spanDelta, classification };
  }

  function createTouchCalibrationTracker(intent, thresholds, startedAt = 0) {
    const points = new Map();
    let pair = null;
    let ended = false;
    let maxVectorDifference = 0;
    let maxAbsoluteSpanChange = 0;
    let current = null;
    const snapshot = (samplePeak = false) => {
      if (!pair) return null;
      const [first, second] = pair.ids.map((id) => points.get(id));
      const metrics = measureTouchPair(pair.initial, [first, second], intent, thresholds);
      if (samplePeak) {
        maxVectorDifference = Math.max(maxVectorDifference, metrics.vectorDifference);
        maxAbsoluteSpanChange = Math.max(maxAbsoluteSpanChange, Math.abs(metrics.spanDelta));
      }
      return current = { positions: [first, second].map((point) => ({ ...point })), ...metrics, maxVectorDifference, maxAbsoluteSpanChange };
    };
    return {
      pointerDown(id, point) {
        if (ended || points.has(id) || points.size >= 2) return false;
        points.set(id, { x: point.x, y: point.y });
        if (points.size === 2) {
          const ids = [...points.keys()], initial = ids.map((pointerId) => ({ ...points.get(pointerId) }));
          pair = { ids, initial };
          snapshot(true);
        }
        return true;
      },
      pointerMove(id, point) {
        if (ended || !points.has(id)) return null;
        points.set(id, { x: point.x, y: point.y });
        return snapshot(false);
      },
      sample() { return snapshot(true); },
      pointerUp(id, elapsedMs) {
        if (ended || !points.has(id)) return null;
        if (!pair) { ended = true; return null; }
        const metrics = snapshot(true);
        ended = true;
        return { intent, elapsedMs: Math.max(0, elapsedMs - startedAt), ...metrics };
      },
      cancel() { ended = true; points.clear(); pair = null; current = null; },
      getMetrics() { return current; },
      getActivePointerIds() { return [...points.keys()]; },
    };
  }

  function appendTouchCalibrationRecord(records, record, limit = 10) {
    return [...records, record].slice(-Math.max(1, Math.floor(limit)));
  }

  function applyTouchCalibrationRecord(settings, record) {
    const draft = { ...settings };
    if (record.intent === "pan") draft.panVectorTolerance = Math.max(1, Math.min(200, Math.round(record.maxVectorDifference)));
    else {
      draft.pinchActivationDistance = Math.max(1, Math.min(200, Math.round(record.maxAbsoluteSpanChange)));
      draft.pinchMinimumSeparation = Math.max(8, Math.min(500, Math.round(record.initialSeparation)));
    }
    return { ...draft, ...normalizeTouchCalibration(draft) };
  }

  function savePageState(pages, index, strokes, view) {
    const page = pages[index];
    if (!page) return false;
    page.strokes = structuredClone(strokes || []);
    page.view = view ? { ...view } : null;
    return true;
  }

  function pageForRender(pages, index) {
    if (!pages.length) return { index: 0, page: null };
    const currentIndex = Math.max(0, Math.min(pages.length - 1, Number(index) || 0));
    return { index: currentIndex, page: pages[currentIndex] };
  }

  function createReplacementManager() {
    let pending = null;
    return {
      hasPending() { return pending !== null; },
      request(action) {
        if (pending) return { accepted: false, promise: Promise.resolve(false) };
        let resolve;
        const promise = new Promise((settle) => { resolve = settle; });
        pending = { action, resolve, started: false };
        return { accepted: true, promise };
      },
      take() {
        if (!pending || pending.started) return null;
        pending.started = true;
        return pending;
      },
      settle(current, value) {
        if (!current || pending !== current) return false;
        pending = null;
        current.resolve(value);
        return true;
      },
      cancel() {
        if (!pending || pending.started) return false;
        return this.settle(pending, false);
      }
    };
  }

  return { MAX_PDF_BYTES, MAX_WORK_FILE_BYTES, MAX_SAVED_DOCUMENT_BYTES, isByteLengthWithinLimit, base64DecodedByteLength, isBase64WithinLimit, createBlankPage, createPageSequence, canDeletePage, applyStructureOperation, pointToWorld, zoomAt, canActivateZoomHold, isActivePointer, normalizeTouchCalibration, measureTouchPair, createTouchCalibrationTracker, appendTouchCalibrationRecord, applyTouchCalibrationRecord, savePageState, pageForRender, createReplacementManager };
});
