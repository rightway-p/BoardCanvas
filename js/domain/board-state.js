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

  return { MAX_PDF_BYTES, MAX_WORK_FILE_BYTES, MAX_SAVED_DOCUMENT_BYTES, isByteLengthWithinLimit, base64DecodedByteLength, isBase64WithinLimit, createBlankPage, createPageSequence, canDeletePage, applyStructureOperation, pointToWorld, zoomAt, canActivateZoomHold, isActivePointer, savePageState, pageForRender, createReplacementManager };
});
