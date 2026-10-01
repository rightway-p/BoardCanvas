const DEV_SETTINGS_KEY = "board.v2.dev-settings.v1";
const DEV_DEFAULTS = { zoomHoldMs: 3000, presetHoldMs: 3000, movementThreshold: 12, zoomSensitivity: 0.008, showTouchOverlay: true };
let devSettings = { ...DEV_DEFAULTS };
let devMode = false;
let devTouch = null;
let devTouchTimer = null;
let devTicker = null;
const workReplacementManager = BoardState.createReplacementManager();
let activeDriveFileId = null;
let driveAuthenticated = false;

async function invokeDrive(command, args = {}) {
  const invoke = getTauriInvoke();
  if (!invoke) throw new Error("Google Drive는 데스크톱 앱에서 사용할 수 있습니다.");
  return invoke(command, args);
}
function formatDriveBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}
async function refreshDriveStatus() {
  const status = document.getElementById("driveStatus");
  const limit = document.getElementById("driveCacheLimit");
  try {
    const cache = await invokeDrive("drive_get_cache_status");
    limit.value = Math.round(cache.limitBytes / (1024 * 1024));
    document.getElementById("driveCacheLabel").textContent = `${formatDriveBytes(cache.usedBytes)} 사용 / ${formatDriveBytes(cache.limitBytes)} 한도`;
    if (driveAuthenticated) status.textContent = "Google Drive 연결됨";
    else if (status.textContent === "연결되지 않음") status.textContent = `Google Drive 미연결 · 캐시 ${formatDriveBytes(cache.usedBytes)} 사용`;
    return true;
  } catch (error) { status.textContent = error.message || "Drive 상태를 불러오지 못했습니다."; return false; }
}
async function loadDrivePdfList() {
  const status = document.getElementById("driveStatus"), list = document.getElementById("driveFileList");
  status.textContent = "PDF 목록 불러오는 중…"; list.replaceChildren();
  try {
    const files = []; let pageToken;
    do {
      const response = await invokeDrive("drive_list_pdfs", pageToken ? { pageToken } : {});
      files.push(...(response.files || [])); pageToken = response.nextPageToken || null;
    } while (pageToken);
    for (const file of files) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = `${file.name} · ${formatDriveBytes(file.size)}`;
      button.addEventListener("click", () => { void importDrivePdf(file); }); list.appendChild(button);
    }
    driveAuthenticated = true;
    status.textContent = `연결됨 · PDF ${files.length}개`;
    await refreshDriveStatus();
    status.textContent = `연결됨 · PDF ${files.length}개`;
  } catch (error) { status.textContent = error.message || "Drive PDF 목록을 불러오지 못했습니다."; }
}
async function importDrivePdf(file) {
  const status = document.getElementById("driveStatus"); status.textContent = `${file.name} 가져오기 대기 중…`;
  try {
    const imported = await requestBoardWorkReplacement(async () => {
      status.textContent = `${file.name} 다운로드 중…`;
      const result = await invokeDrive("drive_download_pdf", { fileId: file.id });
      if (!BoardState.isByteLengthWithinLimit(result.size, BoardState.MAX_PDF_BYTES) || !BoardState.isBase64WithinLimit(result.pdfBase64, BoardState.MAX_PDF_BYTES)) {
        throw new Error("PDF 파일은 256 MiB 이하만 가져올 수 있습니다.");
      }
      const bytes = Uint8Array.from(atob(result.pdfBase64), (character) => character.charCodeAt(0));
      if (!(await loadPdfFromFile(new File([bytes], result.name || file.name, { type: "application/pdf" })))) return false;
      try {
        await invokeDrive("drive_set_active_pdf", { fileId: result.fileId || file.id });
        activeDriveFileId = result.fileId || file.id;
      } catch (error) {
        setDocumentStatus(`${result.name || file.name}을 열었지만 캐시 상태를 갱신하지 못했습니다. ${error.message || ""}`, "warning");
      }
      return true;
    });
    if (imported) { status.textContent = `${file.name} 가져옴`; document.getElementById("driveDialog").classList.add("is-hidden"); closeDocumentPopup(); }
    else status.textContent = "가져오기가 취소되었거나 완료되지 않았습니다.";
  } catch (error) { status.textContent = error.message || "Drive PDF를 가져오지 못했습니다."; }
}
async function clearActiveDrivePin() {
  if (!getTauriInvoke()) { activeDriveFileId = null; return true; }
  try {
    await invokeDrive("drive_set_active_pdf", { fileId: null });
    activeDriveFileId = null;
    return true;
  } catch (error) {
    setDocumentStatus(`현재 작업을 열었지만 이전 Drive 파일을 캐시에서 해제하지 못했습니다. ${error.message || ""}`, "warning");
    return false;
  }
}
function openDriveDialog() {
  const dialog = document.getElementById("driveDialog"); dialog.classList.remove("is-hidden");
  void refreshDriveStatus();
}

function currentBoardPage() { return boardPageSequence[boardPageIndex] || null; }
function finishActiveBoardInput() {
  if (activePanPointerId !== null) endPanOrZoom({ pointerId: activePanPointerId });
  if (strokeEraserActive && strokeEraserPointerId !== null) stopStrokeErasing({ pointerId: strokeEraserPointerId });
  if (drawing && currentInputPointerId !== null) stopDrawing({ type: "pointercancel", pointerId: currentInputPointerId });
  currentInputPointerId = null;
}
function saveBoardPageView() {
  BoardState.savePageState(boardPageSequence, boardPageIndex, strokes, boardCamera);
}
function renderBoardPage(index = boardPageIndex) {
  if (!boardPageSequence.length) boardPageSequence = BoardState.createPageSequence(0);
  clearPdfRenderDebounce();
  pdfRenderToken += 1;
  stopPdfRenderTask();
  const target = BoardState.pageForRender(boardPageSequence, index);
  boardPageIndex = target.index;
  const page = target.page;
  if (page.kind === "blank" && !page.worldSize) page.worldSize = { width: backgroundCanvas.width, height: backgroundCanvas.height };
  pdfPageNumber = page.kind === "pdf" ? page.pdfPage : 0;
  boardCamera = page.view ? { ...page.view } : { x: 0, y: 0, scale: 1 };
  pdfPageRasterCanvas = null;
  if (page.kind === "blank") applyBoardColor(page.background || "#ffffff", false);
  restoreCurrentStrokeState();
  if (page.kind === "pdf") void renderPdfPage(page.pdfPage);
  else renderBoardBackground();
  applyBoardCamera();
  updateBoardSequenceUI();
  updateUndoRedoUI();
  scheduleSessionAutosave();
}
function updateBoardSequenceUI() {
  const label = `${boardPageIndex + 1} / ${boardPageSequence.length}`;
  pdfPageIndicator.textContent = label;
  if (toolbarPdfPageIndicator) {
    toolbarPdfPageIndicator.textContent = label;
    toolbarPdfPageIndicator.classList.toggle("is-empty", boardPageSequence.length <= 1);
  }
  pdfPrevPageButton.disabled = boardPageIndex <= 0 || pdfExportInProgress || sessionRestoreInProgress;
  pdfNextPageButton.disabled = boardPageIndex >= boardPageSequence.length - 1 || pdfExportInProgress || sessionRestoreInProgress;
  removeDocumentButton.disabled = !hasLoadedPdfDocument() || pdfExportInProgress || sessionRestoreInProgress;
  if (pageManager) pageManager.classList.toggle("is-hidden", !pageManagerOpen);
  renderPageList();
}
let pageManagerOpen = false;
function renderPageList() {
  if (!pageList) return;
  pageList.replaceChildren();
  boardPageSequence.forEach((page, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `page-entry${index === boardPageIndex ? " is-active" : ""}`;
    button.textContent = `${index + 1} · ${page.kind === "pdf" ? `PDF ${page.pdfPage}쪽` : "칠판"}`;
    button.addEventListener("click", () => { finishActiveBoardInput(); saveCurrentStrokeState(); saveBoardPageView(); renderBoardPage(index); });
    pageList.appendChild(button);
  });
  const active = currentBoardPage();
  deleteBlankPageButton.disabled = !active || active.kind !== "blank" || boardPageSequence.length <= 1;
  pageStructureUndoButton.disabled = pageStructureUndo.length === 0;
  pageStructureRedoButton.disabled = pageStructureRedo.length === 0;
}
function addBoardBlankPage() {
  if (pdfExportInProgress || sessionRestoreInProgress) return;
  finishActiveBoardInput();
  saveCurrentStrokeState(); saveBoardPageView();
  const index = boardPageIndex + 1;
  const page = BoardState.createBlankPage(`blank:${Date.now()}`);
  page.worldSize = { width: backgroundCanvas.width, height: backgroundCanvas.height };
  const op = { action: "add", index, page: structuredClone(page) };
  boardPageSequence.splice(index, 0, page);
  pageStructureUndo.push(op); pageStructureRedo.length = 0;
  renderBoardPage(index);
}
function deleteBoardBlankPage() {
  if (!BoardState.canDeletePage(boardPageSequence, boardPageIndex)) return;
  finishActiveBoardInput();
  saveCurrentStrokeState(); saveBoardPageView();
  const op = { action: "delete", index: boardPageIndex, page: null };
  BoardState.applyStructureOperation(boardPageSequence, op, true);
  pageStructureUndo.push(op); pageStructureRedo.length = 0;
  renderBoardPage(Math.max(0, boardPageIndex - 1));
}
function runPageStructureUndo(redo) {
  const from = redo ? pageStructureRedo : pageStructureUndo;
  const to = redo ? pageStructureUndo : pageStructureRedo;
  const op = from[from.length - 1];
  if (!op) return;
  finishActiveBoardInput();
  saveCurrentStrokeState(); saveBoardPageView();
  const oldIndex = boardPageIndex;
  if (!BoardState.applyStructureOperation(boardPageSequence, op, redo)) return;
  from.pop(); to.push(op);
  let next = oldIndex;
  if (op.action === "add") {
    if (redo && op.index <= oldIndex) next += 1;
    if (!redo && op.index < oldIndex) next -= 1;
  } else if (!redo) next = op.index;
  else if (op.index <= oldIndex) next = Math.max(0, oldIndex - 1);
  renderBoardPage(next);
}
function goToBoardPage(delta) {
  const next = boardPageIndex + delta;
  if (next < 0 || next >= boardPageSequence.length) return;
  finishActiveBoardInput();
  saveCurrentStrokeState(); saveBoardPageView(); renderBoardPage(next);
}
function applyBoardCamera() {
  if (boardWorld) boardWorld.style.transform = "none";
  renderBoardBackground();
  redrawAllStrokes();
}
function fitCurrentBoardPage() {
  const page = currentBoardPage();
  if (page && page.kind === "pdf" && page.pdfWorldSize) {
    const rect = boardWrapper.getBoundingClientRect();
    const width = page.pdfWorldSize.width / pixelRatio, height = page.pdfWorldSize.height / pixelRatio;
    const scale = Math.min(rect.width / width, rect.height / height);
    boardCamera = { x: (rect.width - width * scale) / 2, y: (rect.height - height * scale) / 2, scale };
  } else boardCamera = { x: 0, y: 0, scale: 1 };
  saveBoardPageView(); applyBoardCamera(); scheduleSessionAutosave();
}
function boardWorkSnapshot() {
  saveCurrentStrokeState(); saveBoardPageView();
  if (hasLoadedPdfDocument() && !(loadedPdfBytes instanceof Uint8Array)) throw new Error("원본 PDF가 복구되지 않아 작업 파일을 만들 수 없습니다. PDF를 다시 불러오세요.");
  return { format: "boardcanvas-work", version: 1, savedAt: Date.now(), name: loadedDocumentName, pdfBase64: loadedPdfBytes ? encodeBase64(loadedPdfBytes) : null, pageIndex: boardPageIndex, pages: boardPageSequence.map((page) => ({ ...page, strokes: cloneStrokeCollection(page.strokes || []), view: page.view ? { ...page.view } : null, pdfWorldSize: page.pdfWorldSize ? { ...page.pdfWorldSize } : null, worldSize: page.worldSize ? { ...page.worldSize } : null })) };
}
function encodeBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}
async function saveBoardWorkFile(requireVerified = false) {
  try {
    const data = new Blob([JSON.stringify(boardWorkSnapshot())], { type: "application/json" });
    if (!BoardState.isByteLengthWithinLimit(data.size, BoardState.MAX_SAVED_DOCUMENT_BYTES)) throw new Error("작업 파일은 512 MiB 이하만 저장할 수 있습니다. 필기량을 줄인 뒤 다시 저장해 주세요.");
    const fileName = `${(loadedDocumentName || "칠판").replace(/\.pdf$/i, "")}.boardwork`;
    const invoke = getTauriInvoke();
    if (invoke) {
      const bytes = new Uint8Array(await data.arrayBuffer());
      const result = await invoke("save_document_file", { suggestedName: fileName, contentsBase64: encodeBase64(bytes), kind: "work" });
      if (!result || result.saved !== true) { setDocumentStatus("저장을 취소했습니다.", "warning"); return false; }
      setDocumentStatus("작업 파일을 저장했습니다.", "success");
      return true;
    }
    if (typeof window.showSaveFilePicker === "function") {
      const handle = await window.showSaveFilePicker({ suggestedName: fileName, types: [{ description: "Board 작업 파일", accept: { "application/json": [".boardwork"] } }] });
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
      setDocumentStatus("작업 파일을 저장했습니다.", "success");
      return true;
    }
    if (requireVerified) {
      setDocumentStatus("이 환경에서는 저장 완료를 확인할 수 없어 현재 작업을 유지했습니다.", "error");
      return false;
    }
    downloadBlobFile(data, fileName);
    setDocumentStatus("작업 파일 다운로드를 요청했습니다. 파일이 저장됐는지 확인해 주세요.", "warning");
    return true;
  } catch (error) {
    setDocumentStatus(error.message || "작업 파일을 만들지 못했습니다.", "error");
    return false;
  }
}
function requestBoardWorkReplacement(action) {
  if (workReplacementManager.hasPending()) {
    setDocumentStatus("다른 작업을 열기 위한 확인이 진행 중입니다. 먼저 현재 대화상자에서 선택해 주세요.", "warning");
    return Promise.resolve(false);
  }
  finishActiveBoardInput();
  saveCurrentStrokeState();
  saveBoardPageView();
  const hasWork = hasLoadedPdfDocument() || boardPageSequence.length > 1 || boardPageSequence.some((page) => (page.strokes || []).length);
  const request = workReplacementManager.request(action);
  if (!request.accepted) {
    setDocumentStatus("다른 작업을 열기 위한 확인이 진행 중입니다. 먼저 현재 대화상자에서 선택해 주세요.", "warning");
    return request.promise;
  }
  if (!hasWork) {
    const pending = workReplacementManager.take();
    void (async () => {
      try {
        const result = await pending.action();
        if (result === false) throw new Error("새 작업을 열지 못해 현재 작업을 유지했습니다.");
        workReplacementManager.settle(pending, true);
      } catch (error) {
        setDocumentStatus(error.message || "새 작업을 열지 못했습니다.", "error");
        workReplacementManager.settle(pending, false);
      }
    })();
    return request.promise;
  }
  replaceWorkDialog.classList.remove("is-hidden");
  return request.promise;
}
async function runUpdaterCheck(userInitiated) {
  const status = document.getElementById("updateStatus");
  const invoke = getTauriInvoke();
  if (!invoke) { if (userInitiated) status.textContent = "데스크톱 앱에서만 업데이트를 확인할 수 있습니다."; return false; }
  try {
    const { configured } = await invoke("get_updater_status");
    if (!configured) { if (userInitiated) status.textContent = "업데이트 배포 설정이 아직 준비되지 않았습니다."; return false; }
    const updater = window.__TAURI__ && window.__TAURI__.updater;
    if (!updater || typeof updater.checkUpdate !== "function" || typeof updater.installUpdate !== "function") throw new Error("업데이트 기능을 이 앱에서 사용할 수 없습니다.");
    status.textContent = "업데이트 확인 중…";
    const result = await updater.checkUpdate();
    if (!result.shouldUpdate) { status.textContent = "최신 버전을 사용 중입니다."; return true; }
    const manifest = result.manifest || {};
    if (!window.confirm(`${manifest.version || "새 버전"} 업데이트를 설치할까요?`)) { status.textContent = "설치를 취소했습니다."; return true; }
    if (!(await persistSessionState())) throw new Error("작업 복구 데이터를 안전하게 저장하지 못해 설치를 중단했습니다.");
    status.textContent = "업데이트 설치 중…";
    await updater.installUpdate();
    status.textContent = "업데이트를 설치했습니다.";
    return true;
  } catch (error) {
    status.textContent = error && error.message ? error.message : "업데이트를 확인하지 못했습니다.";
    return false;
  }
}
async function finishBoardWorkReplacement(save) {
  const pending = workReplacementManager.take();
  replaceWorkDialog.classList.add("is-hidden");
  if (!pending) return;
  try { if (save && !(await saveBoardWorkFile(true))) { workReplacementManager.settle(pending, false); return; } const result = await pending.action(); if (result === false) throw new Error("새 작업을 열지 못해 현재 작업을 유지했습니다."); workReplacementManager.settle(pending, true); }
  catch (error) { setDocumentStatus(error.message || "새 작업을 열지 못했습니다.", "error"); workReplacementManager.settle(pending, false); }
}
async function openBoardWorkFile(file) {
  if (!file || !BoardState.isByteLengthWithinLimit(file.size, BoardState.MAX_WORK_FILE_BYTES)) throw new Error("작업 파일은 512 MiB 이하만 열 수 있습니다.");
  const state = JSON.parse(await file.text());
  if (!state || state.format !== "boardcanvas-work" || state.version !== 1 || !Array.isArray(state.pages) || !state.pages.length || state.pages.length > 1000) throw new Error("작업 파일 형식이 올바르지 않습니다.");
  const pages = state.pages.map((page, index) => {
    if (!page || (page.kind !== "pdf" && page.kind !== "blank")) throw new Error("작업 파일의 페이지 정보가 올바르지 않습니다.");
    const view = page.view;
    if (view && (![view.x, view.y, view.scale].every((value) => Number.isFinite(Number(value))) || Number(view.scale) <= 0)) throw new Error("작업 파일의 화면 위치 정보가 올바르지 않습니다.");
    const pdfPage = Number(page.pdfPage);
    if (page.kind === "pdf" && (!Number.isInteger(pdfPage) || pdfPage < 1)) throw new Error("작업 파일의 PDF 페이지 번호가 올바르지 않습니다.");
    const worldSize = page.worldSize && Number.isFinite(Number(page.worldSize.width)) && Number.isFinite(Number(page.worldSize.height)) ? { width: Math.max(1, Number(page.worldSize.width)), height: Math.max(1, Number(page.worldSize.height)) } : null;
    return { id: typeof page.id === "string" ? page.id.slice(0, 80) : `${page.kind}:${index + 1}`, kind: page.kind, ...(page.kind === "pdf" ? { pdfPage, pdfWorldSize: page.pdfWorldSize && Number.isFinite(Number(page.pdfWorldSize.width)) && Number.isFinite(Number(page.pdfWorldSize.height)) ? { width: Math.max(1, Number(page.pdfWorldSize.width)), height: Math.max(1, Number(page.pdfWorldSize.height)) } : null } : { background: normalizeHexColor(page.background) || "#ffffff", worldSize }), strokes: normalizeStrokeCollection(page.strokes), view: view ? { x: Number(view.x), y: Number(view.y), scale: Math.max(0.2, Math.min(6, Number(view.scale))) } : null };
  });
  const pdfPages = pages.filter((page) => page.kind === "pdf");
  if (state.pdfBase64 && !pdfPages.length) throw new Error("작업의 PDF 페이지 구성이 올바르지 않습니다.");
  if (!state.pdfBase64 && pdfPages.length) throw new Error("작업 파일에 연결된 PDF가 없습니다.");
  const rawPageIndex = Number(state.pageIndex);
  if (!Number.isInteger(rawPageIndex) || rawPageIndex < 0 || rawPageIndex >= pages.length) throw new Error("작업 파일의 현재 페이지 번호가 올바르지 않습니다.");
  let pdfBytes = null;
  if (state.pdfBase64) {
    if (!BoardState.isBase64WithinLimit(state.pdfBase64, BoardState.MAX_PDF_BYTES)) throw new Error("작업 파일 안의 PDF가 256 MiB 한도를 초과했거나 손상되었습니다.");
    try { pdfBytes = Uint8Array.from(atob(state.pdfBase64), (char) => char.charCodeAt(0)); }
    catch { throw new Error("작업 파일의 PDF 데이터가 손상되었습니다."); }
    if (!(await configurePdfWorker())) throw new Error("PDF 읽기를 준비하지 못했습니다.");
    let candidate;
    try {
      candidate = await window.pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;
      if (pdfPages.some((page) => page.pdfPage > Number(candidate.numPages))) throw new Error("작업에 PDF의 존재하지 않는 페이지가 포함되어 있습니다.");
    } catch (error) { throw new Error(error.message || "작업 파일의 PDF를 확인하지 못했습니다."); }
    finally { if (candidate) await candidate.destroy(); }
  }
  const apply = async () => {
    if (state.pdfBase64) {
      const fileName = `${String(state.name || "작업").replace(/[\\/:*?"<>|]+/g, "_")}.pdf`;
      if (!(await loadPdfFromFile(new File([pdfBytes], fileName, { type: "application/pdf" })))) return false;
      await clearActiveDrivePin();
    } else {
      if (pdfDocument) await unloadPdfDocument(false);
      await clearActiveDrivePin();
    }
    pages.forEach((page) => { if (page.kind === "pdf" && !page.pdfWorldSize) page.pdfWorldSize = { width: backgroundCanvas.width, height: backgroundCanvas.height }; if (page.kind === "blank" && !page.worldSize) page.worldSize = { width: backgroundCanvas.width, height: backgroundCanvas.height }; });
    boardPageSequence = pages;
    boardPageIndex = rawPageIndex;
    pageStructureUndo.length = 0; pageStructureRedo.length = 0; clearAllStrokeHistory();
    renderBoardPage(boardPageIndex); closeDocumentPopup(); scheduleSessionAutosave();
  };
  return requestBoardWorkReplacement(apply);
}
function updateBoardViewport() {
  if (!toolbar || !boardWrapper || toolbarLayout.placement === "floating") {
    boardWrapper.style.inset = "0"; setCanvasSize(); return;
  }
  const appRect = app.getBoundingClientRect(), rect = toolbar.getBoundingClientRect();
  if (toolbarLayout.placement === "top") boardWrapper.style.inset = `${Math.ceil(rect.bottom - appRect.top)}px 0 0`;
  else if (toolbarLayout.placement === "bottom") boardWrapper.style.inset = `0 0 ${Math.ceil(appRect.bottom - rect.top)}px`;
  else if (toolbarLayout.placement === "left") boardWrapper.style.inset = `0 0 0 ${Math.ceil(rect.right - appRect.left)}px`;
  else if (toolbarLayout.placement === "right") boardWrapper.style.inset = `0 ${Math.ceil(appRect.right - rect.left)}px 0 0`;
  setCanvasSize();
}
function setPanMode(enabled) {
  if (Boolean(enabled) !== panMode) finishActiveBoardInput();
  panMode = Boolean(enabled);
  if (panMode) tool = "pen";
  pageModeToggleButton.setAttribute("aria-pressed", String(panMode));
  pageModeToggleButton.classList.toggle("is-active", panMode);
  pageModeToggleButton.setAttribute("aria-label", panMode ? "패닝 모드 (눌러 펜으로 돌아가기)" : "펜 모드 (눌러 패닝 전환)");
  pageModeToggleButton.title = panMode ? "패닝 중 · 눌러 펜으로 돌아가기" : "펜 / 패닝 전환";
  pageModeToggleButton.classList.toggle("is-pan-mode", panMode);
  pageModeToggleButton.innerHTML = panMode
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12V5a1.5 1.5 0 0 1 3 0v6-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v8-4a1.5 1.5 0 0 1 3 0v7c0 4-2 6-6 6h-2c-2 0-3.5-1-5-3l-3-4a1.5 1.5 0 0 1 2-2z"></path></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4.2-1.1L19 8.1 15.9 5 5.1 15.8 4 20z"></path><path d="M14.8 6.1l3.1 3.1"></path></svg>';
  updateToolUI();
}
function startPanOrZoomHold(event) {
  if (!panMode || !event.isPrimary || currentInputPointerId !== null) return false;
  currentInputPointerId = event.pointerId;
  activePanPointerId = event.pointerId;
  const start = { x: event.clientX, y: event.clientY, camera: { ...boardCamera }, started: false };
  pendingZoomHold = start;
  canvas.setPointerCapture(event.pointerId);
  devTouch = { x: event.clientX, y: event.clientY, start: performance.now() };
  if (devMode && devSettings.showTouchOverlay) { showDevTouch(); devTicker = window.setInterval(showDevTouch, 50); }
  window.clearTimeout(devTouchTimer);
  devTouchTimer = window.setTimeout(() => {
    if (pendingZoomHold !== start || !BoardState.canActivateZoomHold(performance.now() - devTouch.start, 0, devSettings.movementThreshold, devSettings.zoomHoldMs)) return;
    start.started = true;
    zoomGesture = { startY: start.y, baseScale: boardCamera.scale, baseCamera: { ...boardCamera }, anchor: canvasPointFromClient(start.x, start.y) };
    showZoomCue(start.x, start.y);
  }, devSettings.zoomHoldMs);
  return true;
}
function canvasPointFromClient(clientX, clientY) {
  const rect = boardWrapper.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}
function continuePanOrZoom(event) {
  if (activePanPointerId !== event.pointerId || !pendingZoomHold) return false;
  const dx = event.clientX - pendingZoomHold.x, dy = event.clientY - pendingZoomHold.y;
  if (!pendingZoomHold.started && Math.hypot(dx, dy) > devSettings.movementThreshold) {
    window.clearTimeout(devTouchTimer); devTouchTimer = null; pendingZoomHold.started = false;
  }
  if (pendingZoomHold.started && zoomGesture) {
    const factor = Math.exp((zoomGesture.startY - event.clientY) * devSettings.zoomSensitivity);
    boardCamera = BoardState.zoomAt(zoomGesture.baseCamera || pendingZoomHold.camera, zoomGesture.anchor, factor);
  } else {
    boardCamera = { ...pendingZoomHold.camera, x: pendingZoomHold.camera.x + dx, y: pendingZoomHold.camera.y + dy };
  }
  applyBoardCamera();
  if (devMode) { devTouch.x = event.clientX; devTouch.y = event.clientY; showDevTouch(event.clientX, event.clientY); }
  return true;
}
function endPanOrZoom(event) {
  if (activePanPointerId !== event.pointerId) return false;
  window.clearTimeout(devTouchTimer); devTouchTimer = null;
  window.clearInterval(devTicker); devTicker = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  activePanPointerId = null; currentInputPointerId = null; pendingZoomHold = null; zoomGesture = null;
  hideZoomCue(); hideDevTouch();
  saveBoardPageView(); scheduleSessionAutosave();
  return true;
}
function showZoomCue(x, y) {
  let cue = document.getElementById("zoomCue");
  if (!cue) { cue = document.createElement("div"); cue.id = "zoomCue"; cue.className = "zoom-cue"; boardWrapper.append(cue); }
  cue.style.left = `${x - boardWrapper.getBoundingClientRect().left}px`; cue.style.top = `${y - boardWrapper.getBoundingClientRect().top}px`; cue.textContent = "위로 확대 · 아래로 축소"; cue.hidden = false;
}
function hideZoomCue() { const cue = document.getElementById("zoomCue"); if (cue) cue.hidden = true; }
function showDevTouch(x = devTouch && devTouch.x, y = devTouch && devTouch.y) {
  if (!devTouch || !devMode || !devSettings.showTouchOverlay) return;
  let mark = document.getElementById("devTouchMark");
  if (!mark) { mark = document.createElement("div"); mark.id = "devTouchMark"; mark.className = "dev-touch-mark"; boardWrapper.append(mark); }
  const rect = boardWrapper.getBoundingClientRect(); mark.style.left = `${x - rect.left}px`; mark.style.top = `${y - rect.top}px`; mark.hidden = false;
  mark.style.setProperty("--dev-radius", `${devSettings.movementThreshold}px`);
  mark.textContent = `${Math.max(0, Math.ceil(devSettings.zoomHoldMs - (performance.now() - devTouch.start)))} ms`;
}
function hideDevTouch() { const mark = document.getElementById("devTouchMark"); if (mark) mark.hidden = true; }
function openPageManager(open) { pageManagerOpen = open; pageManager.classList.toggle("is-hidden", !open); renderPageList(); }
function placeCurrentPenPopup() {
  if (currentPenPopup.classList.contains("is-hidden")) return;
  const trigger = currentPenButton.getBoundingClientRect();
  currentPenPopup.style.position = "fixed";
  const placement = ["top", "bottom", "left", "right"].find((value) => app.classList.contains(`toolbar-placement-${value}`)) || "left";
  const width = currentPenPopup.offsetWidth, height = currentPenPopup.offsetHeight;
  const left = placement === "right" ? trigger.left - width - 8 : placement === "left" ? trigger.right + 8 : trigger.left;
  const top = placement === "top" ? trigger.bottom + 8 : placement === "bottom" ? trigger.top - height - 8 : trigger.top;
  currentPenPopup.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, left))}px`;
  currentPenPopup.style.top = `${Math.max(8, Math.min(window.innerHeight - height - 8, top))}px`;
}
function placeToolbarPopup(triggerElement, popup) {
  if (popup.classList.contains("is-hidden")) return;
  const rect = triggerElement.getBoundingClientRect();
  const placement = ["top", "bottom", "left", "right"].find((value) => app.classList.contains(`toolbar-placement-${value}`)) || "left";
  popup.style.position = "fixed";
  const width = popup.offsetWidth, height = popup.offsetHeight;
  const preferredLeft = placement === "right" ? rect.left - width - 8 : placement === "left" ? rect.right + 8 : rect.left;
  const preferredTop = placement === "top" ? rect.bottom + 8 : placement === "bottom" ? rect.top - height - 8 : rect.top;
  popup.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, preferredLeft))}px`;
  popup.style.top = `${Math.max(8, Math.min(window.innerHeight - height - 8, preferredTop))}px`;
}
function openDeveloperSettings() {
  const panel = document.getElementById("developerSettings");
  if (!panel) return;
  panel.hidden = false; devMode = true; renderDeveloperSettings();
}
function renderDeveloperSettings() {
  const panel = document.getElementById("developerSettings");
  if (!panel) return;
  panel.innerHTML = `<header><strong>개발자 옵션 · 시험용</strong><button type="button" data-dev-close>끄기</button></header><label><input data-dev-overlay type="checkbox" ${devSettings.showTouchOverlay ? "checked" : ""}> 터치 위치·허용 반경·유지 시간 표시</label><label>줌 유지 시간 <input data-key="zoomHoldMs" type="range" min="1000" max="5000" step="100" value="${devSettings.zoomHoldMs}"><output>${devSettings.zoomHoldMs}ms</output></label><label>프리셋 편집 유지 시간 <input data-key="presetHoldMs" type="range" min="1000" max="5000" step="100" value="${devSettings.presetHoldMs}"><output>${devSettings.presetHoldMs}ms</output></label><label>움직임 허용 <input data-key="movementThreshold" type="range" min="3" max="40" step="1" value="${devSettings.movementThreshold}"><output>${devSettings.movementThreshold}px</output></label><label>줌 민감도 <input data-key="zoomSensitivity" type="range" min="0.002" max="0.02" step="0.001" value="${devSettings.zoomSensitivity}"><output>${devSettings.zoomSensitivity}</output></label><footer><button type="button" data-dev-default>기본값</button><button type="button" data-dev-cancel>취소</button><button type="button" data-dev-save>저장</button></footer>`;
  panel.querySelector("[data-dev-overlay]").addEventListener("change", (event) => { devSettings.showTouchOverlay = event.target.checked; if (!event.target.checked) { window.clearInterval(devTicker); hideDevTouch(); } });
  panel.querySelectorAll("input[data-key]").forEach((input) => input.addEventListener("input", () => { devSettings[input.dataset.key] = Number(input.value); input.nextElementSibling.value = `${input.value}${input.dataset.key === "movementThreshold" ? "px" : input.dataset.key.includes("Hold") ? "ms" : ""}`; }));
  panel.querySelector("[data-dev-default]").onclick = () => { devSettings = { ...DEV_DEFAULTS }; renderDeveloperSettings(); };
  panel.querySelector("[data-dev-cancel]").onclick = () => { devSettings = JSON.parse(window.localStorage.getItem(DEV_SETTINGS_KEY) || "null") || { ...DEV_DEFAULTS }; closeDeveloperSettings(); };
  panel.querySelector("[data-dev-save]").onclick = () => { window.localStorage.setItem(DEV_SETTINGS_KEY, JSON.stringify(devSettings)); closeDeveloperSettings(); };
  panel.querySelector("[data-dev-close]").onclick = () => { devSettings = JSON.parse(window.localStorage.getItem(DEV_SETTINGS_KEY) || "null") || { ...DEV_DEFAULTS }; closeDeveloperSettings(); };
}
function closeDeveloperSettings() { const panel = document.getElementById("developerSettings"); if (panel) panel.hidden = true; devMode = false; hideDevTouch(); }
function initVersionTap() {
  let count = 0, timer = null;
  const version = document.getElementById("appVersion"); if (!version) return;
  document.getElementById("appInfoButton").addEventListener("click", () => document.getElementById("appInfoPopup").classList.toggle("is-hidden"));
  document.getElementById("checkUpdateButton").addEventListener("click", () => { void runUpdaterCheck(true); });
  version.addEventListener("click", () => { count += 1; window.clearTimeout(timer); timer = window.setTimeout(() => { count = 0; }, 1500); if (count >= 7) { count = 0; openDeveloperSettings(); } });
}
function initBoard201Ui() {
  try { devSettings = { ...DEV_DEFAULTS, ...(JSON.parse(window.localStorage.getItem(DEV_SETTINGS_KEY) || "{}")) }; } catch { devSettings = { ...DEV_DEFAULTS }; }
  pageModeToggleButton.addEventListener("click", () => setPanMode(!panMode));
  currentPenButton.addEventListener("click", (event) => { event.stopPropagation(); currentPenPopup.classList.toggle("is-hidden"); currentPenButton.setAttribute("aria-expanded", String(!currentPenPopup.classList.contains("is-hidden"))); placeCurrentPenPopup(); });
  currentPenPopup.addEventListener("pointerdown", (event) => event.stopPropagation());
  pageManagerButton.addEventListener("click", () => openPageManager(true));
  closePageManagerButton.addEventListener("click", () => openPageManager(false));
  addBlankPageButton.addEventListener("click", addBoardBlankPage);
  deleteBlankPageButton.addEventListener("click", deleteBoardBlankPage);
  pageStructureUndoButton.addEventListener("click", () => runPageStructureUndo(false));
  pageStructureRedoButton.addEventListener("click", () => runPageStructureUndo(true));
  fitPageButton.addEventListener("click", fitCurrentBoardPage);
  saveBoardWorkButton.addEventListener("click", () => { void saveBoardWorkFile(); });
  openBoardWorkButton.addEventListener("click", () => { boardWorkInput.value = ""; boardWorkInput.click(); });
  boardWorkInput.addEventListener("change", async () => {
    const file = boardWorkInput.files && boardWorkInput.files[0]; boardWorkInput.value = "";
    if (!file) return;
    try { await openBoardWorkFile(file); } catch (error) { setDocumentStatus(error.message || "작업 파일을 열 수 없습니다.", "error"); }
  });
  saveAndReplaceButton.addEventListener("click", () => { void finishBoardWorkReplacement(true); });
  discardAndReplaceButton.addEventListener("click", () => { void finishBoardWorkReplacement(false); });
  cancelReplaceButton.addEventListener("click", () => { workReplacementManager.cancel(); replaceWorkDialog.classList.add("is-hidden"); documentInput.value = ""; });
  document.getElementById("appInfoPopup").addEventListener("click", (event) => event.stopPropagation());
  pdfPrevPageButton.addEventListener("click", () => goToBoardPage(-1));
  pdfNextPageButton.addEventListener("click", () => goToBoardPage(1));
  canvas.addEventListener("pointerdown", (event) => { if (panMode) { event.preventDefault(); startPanOrZoomHold(event); } });
  canvas.addEventListener("pointermove", (event) => { if (panMode && activePanPointerId === event.pointerId) { event.preventDefault(); continuePanOrZoom(event); } });
  canvas.addEventListener("pointerup", (event) => { if (panMode) endPanOrZoom(event); });
  canvas.addEventListener("pointercancel", (event) => { if (panMode) endPanOrZoom(event); });
  window.addEventListener("resize", updateBoardViewport);
  window.addEventListener("resize", placeCurrentPenPopup);
  const observer = new ResizeObserver(updateBoardViewport); observer.observe(toolbar);
  initVersionTap();
  if (window.BoardRemote) {
    window.BoardRemote.configure({ actions: [
      { id: "previousPage", label: "이전 페이지", run: () => goToBoardPage(-1) },
      { id: "nextPage", label: "다음 페이지", run: () => goToBoardPage(1) },
      { id: "undoInk", label: "필기 취소", run: undoStrokeAction },
      { id: "redoInk", label: "필기 다시 실행", run: redoStrokeAction },
      { id: "togglePenPan", label: "펜 / 패닝 전환", run: () => setPanMode(!panMode) },
      { id: "addBlankPage", label: "칠판 페이지 추가", run: addBoardBlankPage }
    ], showHint: (message) => setDocumentStatus(message, "warning") });
    document.getElementById("remoteSettingsButton").addEventListener("click", () => window.BoardRemote.openSettings());
  }
  document.getElementById("driveSettingsButton").addEventListener("click", openDriveDialog);
  document.getElementById("closeDriveDialog").addEventListener("click", () => document.getElementById("driveDialog").classList.add("is-hidden"));
  document.getElementById("driveConnectButton").addEventListener("click", async () => {
    const status = document.getElementById("driveStatus"); status.textContent = "Google 계정 연결 중…";
    try { await invokeDrive("drive_authenticate"); driveAuthenticated = true; await loadDrivePdfList(); }
    catch (error) { status.textContent = error.message || "Google Drive에 연결하지 못했습니다."; }
  });
  document.getElementById("driveSignOutButton").addEventListener("click", async () => {
    try { await invokeDrive("drive_sign_out"); driveAuthenticated = false; document.getElementById("driveStatus").textContent = "연결 해제됨"; document.getElementById("driveFileList").replaceChildren(); }
    catch (error) { document.getElementById("driveStatus").textContent = error.message || "연결을 해제하지 못했습니다."; }
  });
  document.getElementById("driveCacheLimit").addEventListener("change", async (event) => {
    try { const status = await invokeDrive("drive_set_cache_limit", { bytes: Number(event.target.value) * 1024 * 1024 }); document.getElementById("driveCacheLabel").textContent = `${formatDriveBytes(status.usedBytes)} 사용 / ${formatDriveBytes(status.limitBytes)} 한도`; }
    catch (error) { document.getElementById("driveStatus").textContent = error.message || "캐시 한도를 변경하지 못했습니다."; void refreshDriveStatus(); }
  });
  exportAnnotatedPdfButton.addEventListener("click", () => document.getElementById("exportDialog").classList.remove("is-hidden"));
  document.getElementById("cancelExportButton").addEventListener("click", () => document.getElementById("exportDialog").classList.add("is-hidden"));
  document.getElementById("confirmExportButton").addEventListener("click", async () => {
    const options = { includeOutsideInk: document.getElementById("exportOutsideInk").checked, includeBlankPages: document.getElementById("exportBlankPages").checked };
    document.getElementById("exportDialog").classList.add("is-hidden");
    await exportAnnotatedPdf(options);
  });
  if (!document.getElementById("developerSettings")) { const panel = document.createElement("section"); panel.id = "developerSettings"; panel.className = "developer-settings"; panel.hidden = true; toolbar.append(panel); }
  if (!hasLoadedPdfDocument() && boardPageSequence.length === 1 && boardPageSequence[0].kind === "blank" && !(boardPageSequence[0].strokes || []).length && boardStrokeSnapshot.length) boardPageSequence[0].strokes = cloneStrokeCollection(boardStrokeSnapshot);
  window.requestBoardWorkReplacement = requestBoardWorkReplacement;
  window.loadBoardWorkFile = openBoardWorkFile;
  const restorePromise = window.boardRestorePromise || Promise.resolve();
  void restorePromise.then(() => {
    boardPageSequence.forEach((page) => { if (page.kind === "pdf" && !page.pdfWorldSize) page.pdfWorldSize = { width: backgroundCanvas.width, height: backgroundCanvas.height }; if (page.kind === "blank" && !page.worldSize) page.worldSize = { width: backgroundCanvas.width, height: backgroundCanvas.height }; });
    renderBoardPage(boardPageIndex);
    updateBoardViewport();
    return runUpdaterCheck(false);
  });
  applyBoardCamera(); updateBoardViewport(); renderBoardPage(boardPageIndex);
}
initBoard201Ui();
