(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BoardInteractionFeedback = api;
})(typeof globalThis === "object" ? globalThis : window, function () {
  "use strict";

  function create({ root, canvas, document, window, getState }) {
    const toast = document.createElement("div");
    toast.className = "board-action-feedback";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.setAttribute("aria-atomic", "true");
    const cursor = document.createElement("div");
    cursor.className = "board-eraser-preview";
    cursor.setAttribute("aria-hidden", "true");
    const center = document.createElement("span");
    cursor.append(center);
    const label = document.createElement("div");
    label.className = "board-eraser-label";
    label.setAttribute("aria-hidden", "true");
    toast.hidden = cursor.hidden = label.hidden = true;
    root.append(toast, cursor, label);
    let timer = null, pointer = null;
    const modeOf = state => state.passthrough ? "mouse" : state.panMode ? "pan" : state.tool;
    let lastMode = modeOf(getState());
    const modeLabels = { pen: "펜", eraser: "지우개", strokeEraser: "획 지우개", pan: "패닝", mouse: "마우스" };

    function notify(message, duration = 1400) {
      if (!message) return;
      if (timer !== null) window.clearTimeout(timer);
      toast.textContent = message;
      toast.hidden = false;
      timer = window.setTimeout(() => { toast.hidden = true; timer = null; }, duration);
    }
    function hideCursor() {
      pointer = null;
      cursor.hidden = label.hidden = true;
      canvas.classList.toggle("has-eraser-preview", false);
    }
    function refresh() {
      const state = getState(), mode = modeOf(state);
      if (mode !== lastMode) {
        lastMode = mode;
        if (modeLabels[mode]) notify(modeLabels[mode]);
      }
      const rect = root.getBoundingClientRect();
      const x = pointer ? pointer.x - rect.left : -1, y = pointer ? pointer.y - rect.top : -1;
      const diameter = state.worldDiameter * state.scale / state.pixelRatio;
      const visible = Boolean(pointer && (mode === "eraser" || mode === "strokeEraser")
        && (state.ownerId === null || state.ownerId === pointer.id)
        && x >= 0 && y >= 0 && x <= rect.width && y <= rect.height && Number.isFinite(diameter) && diameter > 0);
      cursor.hidden = !visible;
      label.hidden = !visible || pointer.type !== "touch";
      canvas.classList.toggle("has-eraser-preview", visible);
      if (!visible) return;
      cursor.setAttribute("data-kind", mode);
      Object.assign(cursor.style, { left: `${x}px`, top: `${y}px`, width: `${diameter}px`, height: `${diameter}px` });
      if (!label.hidden) {
        label.textContent = `${modeLabels[mode]} · ${Math.round(diameter * 10) / 10}px`;
        const above = y - Math.max(36, diameter / 2 + 12);
        label.style.left = `${Math.max(70, Math.min(rect.width - 70, x))}px`;
        label.style.top = `${above < 30 ? y + Math.max(36, diameter / 2 + 12) : above}px`;
        label.style.transform = above < 30 ? "translate(-50%, 0)" : "translate(-50%, -100%)";
      }
    }
    function track(event) {
      const state = getState();
      if (!event.isPrimary || (state.ownerId !== null && event.pointerId !== state.ownerId)) return;
      pointer = { id: event.pointerId, type: event.pointerType, x: event.clientX, y: event.clientY };
      refresh();
    }
    function end(event) {
      if (pointer?.id !== event.pointerId) return;
      if (event.pointerType === "touch" || event.type !== "pointerup") hideCursor();
      else track(event);
    }
    for (const type of ["pointerenter", "pointermove", "pointerdown"]) canvas.addEventListener(type, track, true);
    for (const type of ["pointerup", "pointercancel", "lostpointercapture", "pointerleave"]) canvas.addEventListener(type, end, true);
    window.addEventListener("blur", hideCursor);
    window.addEventListener("resize", hideCursor);
    document.addEventListener("visibilitychange", () => { if (document.hidden) hideCursor(); });
    return { notify, refresh, hideCursor };
  }

  return { create };
});

function showBoardAction(message, duration) {
  window.BoardFeedback?.notify(message, duration);
}
function refreshBoardFeedback() {
  window.BoardFeedback?.refresh();
}
function hideBoardFeedbackCursor() {
  window.BoardFeedback?.hideCursor();
}
